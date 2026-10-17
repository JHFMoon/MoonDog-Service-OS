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
    "provider_token": re.compile(rb"(?i)(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[0-9A-Za-z-]{20,}|npm_[0-9A-Za-z]{20,}|sk_live_[A-Za-z0-9]{16,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})"),
    "credential_assignment": re.compile(rb"(?im)^.{0,100}(?:password|client_secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['\"]?[A-Za-z0-9+/=_-]{16,}"),
}
email_rx = re.compile(rb"(?i)\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b")
vin_rx = re.compile(rb"\b[A-HJ-NPR-Z0-9]{17}\b")
ssn_rx = re.compile(rb"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)")
safe_email_addresses = {b"web-flow@github.com", b"noreply@github.com"}
safe_email_domains = {
    b"users.noreply.github.com",
    b"noreply.github.com",
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
        if match.group(1).lower() not in safe_email_domains and match.group(0).lower() not in safe_email_addresses:
            yield match

# Reviewed individually on 2026-10-16: seven synthetic Paste & Learn test
# blob versions and four synthetic browser smoke-test blob versions.
# The two newer smoke blobs were created by PR #181 performance-test commits
# before its synthetic VIN fixture was assembled dynamically at runtime.
# This exempts only these exact immutable blob contents from VIN alerts;
# unrelated credential, email, path and other sensitive-data checks remain active.
VETTED_SYNTHETIC_VIN_BLOB_SHA1 = frozenset({
    "0414723d60df03155223972a018a6687e0adb7dc",
    "57542df983462586df6b85a98af2d4ffd6e5e5d9",
    "64037ec104d17efa7ea4a98d6e6e463336d618b4",
    "6457921ada76620cb1af1540c1885cdccf8a0da0",
    "70683a459eb59ff0f706aa6291448a704c31030a",
    "795d7744bfbd898b8a90bfb260d79f9475be0c6a",
    "91df695ca2c0cf0a23ba6ffadfd99179c5c317a5",
    "5118ea8c5385a764f9fb888e7681f696103200c4",
    "b1e6d7b6de41481160dfb54c8b4222c0476dc1a2",
    "bbb2b16de4b66c6efe0b5e9417a3ab96ca5962cd",
    "c725dce8e13b38a548594a1c5ce3b3ace379ee44",
})
counts = collections.Counter()
safe_counts = collections.Counter()
diagnostic_counts = collections.Counter()
blobs = set()

def scan_payload(data, prefix="", approved_synthetic_vin_blob=False):
    key = (lambda name: f"{prefix}_{name}" if prefix else name)
    for kind, rx in patterns.items():
        if rx.search(data):
            counts[key(kind)] += 1
    emails = list(unsafe_email_matches(data))
    if emails:
        counts[key("email_address")] += 1
    elif email_rx.search(data):
        safe_counts[key("known_public_or_synthetic_email")] += 1
    if any(valid_vin(m.group(0)) for m in vin_rx.finditer(data)):
        if approved_synthetic_vin_blob and not prefix:
            safe_counts["vetted_synthetic_vin_blob"] += 1
        else:
            counts[key("valid_vin")] += 1
    if ssn_rx.search(data):
        counts[key("ssn_candidate")] += 1

for line in objects:
    oid, _, path = line.partition(" ")
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
    scan_payload(data, approved_synthetic_vin_blob=oid in VETTED_SYNTHETIC_VIN_BLOB_SHA1)

# Enumerate complete tree snapshots, not just git rev-list --objects names.
# The latter prints only one possible pathname for a blob reused at many paths.
# Deduplicate paths across commits to avoid multiplying findings by commit count.
seen_paths = set()
for commit_id in git("rev-list", "--all").splitlines():
    for raw_path in git("ls-tree", "-r", "-z", "--name-only", commit_id.decode("ascii")).split(b"\x00"):
        if not raw_path or raw_path in seen_paths:
            continue
        seen_paths.add(raw_path)
        pathname = raw_path.decode("utf-8", "replace")
        if restricted.search(pathname):
            counts["restricted_path"] += 1
        scan_payload(raw_path, "path")

# Commit messages, annotated tag messages, and identity metadata are part of
# public history too; scan them without printing values.
for message in git("log", "--all", "--format=%B%x00").split(b"\x00"):
    if message.strip():
        scan_payload(message, "commit_message")

for message in git("for-each-ref", "refs/tags", "--format=%(contents)%00").split(b"\x00"):
    if message.strip():
        scan_payload(message, "tag_message")

commit_emails = git("log", "--all", "--format=%ae%n%ce").splitlines()
commit_email_providers = collections.Counter()
candidate_commit_addresses = set()
candidate_commit_domains = set()
personal_domains = {
    b"gmail.com", b"googlemail.com", b"yahoo.com", b"hotmail.com",
    b"outlook.com", b"live.com", b"icloud.com", b"aol.com",
}
for email in commit_emails:
    email = email.strip().lower()
    m = email_rx.fullmatch(email)
    if not m:
        continue
    domain = m.group(1).lower()
    if domain in safe_email_domains or email in safe_email_addresses:
        safe_counts["known_public_commit_email"] += 1
    else:
        counts["commit_identity_email"] += 1
        candidate_commit_addresses.add(email)
        candidate_commit_domains.add(domain)
        commit_email_providers[
            "personal_provider" if domain in personal_domains else "other_domain"
        ] += 1
diagnostic_counts["distinct_candidate_commit_email_addresses"] = len(candidate_commit_addresses)
diagnostic_counts["distinct_candidate_commit_email_domains"] = len(candidate_commit_domains)
for provider, total in commit_email_providers.items():
    diagnostic_counts["candidate_commit_email_" + provider + "_entries"] = total

print("Git history objects inspected:", len(blobs), "distinct historical paths:", len(seen_paths), flush=True)
print("Audit scope: reachable blobs/paths, commit and tag messages, and commit identities; findings are redacted.", flush=True)
print("Redacted candidate categories (counts only):")
for kind in sorted(counts):
    print(f"  {kind}: {counts[kind]}")
for kind in sorted(safe_counts):
    print(f"  allowed_{kind}: {safe_counts[kind]}")
for kind in sorted(diagnostic_counts):
    print(f"  diagnostic_{kind}: {diagnostic_counts[kind]}")

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

status_path = os.environ.get("PUBLIC_HISTORY_AUDIT_STATUS")
if status_path:
    import json
    with open(status_path, "w", encoding="utf-8") as report:
        json.dump({"counts": dict(counts), "diagnostics": dict(diagnostic_counts), "objects": len(blobs)}, report, sort_keys=True)

if counts:
    print("REVIEW REQUIRED: candidates detected; no sensitive values were printed.")
    sys.exit(1)

print("No blocking candidate matches; release assets, Actions artifacts and deleted refs still require separate review.")
