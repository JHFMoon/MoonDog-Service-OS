#!/usr/bin/env python3
"""Conservative, redacted Git-history data-boundary audit. Never prints matches."""
import collections
import re
import subprocess
import sys

def git(*args, input=None):
    return subprocess.run(["git", *args], input=input, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, check=True).stdout

# --all includes local/remote branches and tags; commits removed from refs or
# deleted artifacts are not recoverable through this scan.
objects = git("rev-list", "--objects", "--all").decode("utf-8", "replace").splitlines()
patterns = {
    "private_key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "provider_token": re.compile(rb"(?i)(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sk_live_[A-Za-z0-9]{16,})"),
    "credential_assignment": re.compile(rb"(?im)^.{0,100}(?:password|client_secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['\"]?[A-Za-z0-9+/=_-]{16,}"),
    "email_address": re.compile(rb"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b"),
    "vin_candidate": re.compile(rb"\b[A-HJ-NPR-Z0-9]{17}\b"),
}
restricted = re.compile(r"(?i)(?:^|/)(?:workspace|customers?|employees?|backups?|reports?|exports?|repair.orders?|store.data|operational.data|files to learn|drop reports here)(?:/|$)|\.(?:xlsx?|csv|pdf|docx?|pptx?|log|bak|zip)$")
counts = collections.Counter()
blobs = {}
for line in objects:
    oid, _, path = line.partition(" ")
    if path and restricted.search(path):
        counts["restricted_path"] += 1
    if oid in blobs:
        continue
    blobs[oid] = True
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
print("Git history objects inspected:", len(blobs))
print("Redacted candidate categories (counts only):")
for kind in sorted(counts):
    print(f"  {kind}: {counts[kind]}")
if counts:
    print("REVIEW REQUIRED: candidates detected; no sensitive values were printed.")
    sys.exit(1)
print("No candidate matches; manual review of releases, artifacts and deleted refs still required.")
