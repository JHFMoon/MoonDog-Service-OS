#!/usr/bin/env python3
"""Conservative, redacted Git-history data-boundary audit. Never prints matches."""
import collections
import os
import re
import subprocess
import sys

def git(*args, input=None):
    return subprocess.run(["git", *args], input=input, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, check=True).stdout

objects = git("rev-list", "--objects", "--all").decode("utf-8", "replace").splitlines()

patterns = {
    "private_key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "provider_token": re.compile(rb"(?i)(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sk_live_[A-Za-z0-9]{16,})"),
    "credential_assignment": re.compile(rb"(?im)^.{0,100}(?:password|client_secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['\"]?[A-Za-z0-9+/=_-]{16,}"),
}
email_rx = re.compile(rb"(?i)\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b")
vin_rx = re.compile(rb"\b[A-HJ-NPR-Z0-9]{17}\b")
safe_email_domains = {
    b"users.noreply.github.com",
    b"example.com",
    b"example.org",
    b"example.net",
}
restricted = re.compile(r"(?i)(?:^|/)(?:workspace|customers?|employees?|backups?|reports?|exports?|repair.orders?|store.data|operational.data|files to learn|drop reports here)(?:/|$)|\.(?:xlsx?|csv|pdf|docx?|pptx?|log|bak|zip)$")

vin_values = {**{str(i): i for i in range(10)}}
for letters, values in [
    ("ABCDEFGH", range(1, 9)),
    ("JKLMNPR", [1, 2, 3, 4, 5, 7, 9]),
    ("STUVWXYZ", [2, 3, 4, 5, 6, 7, 8, 9]),
]:
    vin_values.update(dict(zip(letters, values)))
vin_weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]

def valid_vin(raw):
    try:
        vin = raw.decode("ascii")
        total = sum(vin_values[ch] * weight for ch, weight in zip(vin, vin_weights))
    except (KeyError, UnicodeDecodeError):
        return False
    check = "X" if total % 11 == 10 else str(total % 11)
    return vin[8] == check

def unsafe_email_matches(data):
    for match in email_rx.finditer(data):
        if match.group(1).lower() not in safe_email_domains:
            yield match

counts = collections.Counter()
safe_counts = collections.Counter()
blobs = set()

for line in objects:
    oid, _, path = line.partition(" ")
    if path and restricted.search(path):
        counts["restricted_path"] += 1
    if oid in blobs:
        continue
    blobs.add(oid)
    if git("cat-file", "-t", oid).strip() != b"blob":
        continue
    size = int(git("cat-file", "-s", oid))
    if size > 15_000_000:
        counts["oversize_uninspected_blob"] += 1
        continue
    data = git("cat-file", "blob", oid)
    for kind, rx in patterns.items():
        if rx.search(data):
            counts[kind] += 1
    emails = list(unsafe_email_matches(data))
    if emails:
        counts["email_address"] += 1
    elif email_rx.search(data):
        safe_counts["known_public_or_synthetic_email"] += 1
    if any(valid_vin(m.group(0)) for m in vin_rx.finditer(data)):
        counts["valid_vin"] += 1

# Commit identity metadata is part of public history too.
commit_emails = git("log", "--all", "--format=%ae%n%ce").splitlines()
for email in commit_emails:
    m = email_rx.fullmatch(email.strip())
    if not m:
        continue
    if m.group(1).lower() in safe_email_domains:
        safe_counts["known_public_commit_email"] += 1
    else:
        counts["commit_identity_email"] += 1

print("Git history objects inspected:", len(blobs), flush=True)
print("Audit scope: all reachable refs and commit identity metadata; findings are redacted.", flush=True)
print("Redacted candidate categories (counts only):")
for kind in sorted(counts):
    print(f"  {kind}: {counts[kind]}")
for kind in sorted(safe_counts):
    print(f"  allowed_{kind}: {safe_counts[kind]}")

summary = [
    "## Public history audit",
    "",
    f"Reachable objects inspected: {len(blobs)}",
    "",
    "| Candidate category | Count |",
    "|---|---:|",
]
summary += [f"| {kind} | {counts[kind]} |" for kind in sorted(counts)]
summary.append("")
summary.append("**Review required** — candidate matches are not proof of exposure." if counts else "No blocking candidates detected within the scanned scope.")
if safe_counts:
    summary += ["", "Known public/synthetic matches were allowlisted and counted separately."]

if os.environ.get("GITHUB_STEP_SUMMARY"):
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as report:
        report.write("\n".join(summary) + "\n")

if counts:
    print("REVIEW REQUIRED: candidates detected; no sensitive values were printed.")
    sys.exit(1)

print("No blocking candidate matches; release assets, Actions artifacts and deleted refs still require separate review.")
