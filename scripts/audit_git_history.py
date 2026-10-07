"""Audit every Git object reachable from public branches/tags for sensitive material.

This complements check_publication.py, which protects the current tree. The history
audit deliberately prints only object ids and paths/categories, never matched
secret/PII values.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import check_publication as boundary  # noqa: E402

MAX_TEXT_BLOB = 8 * 1024 * 1024

SSN_PATTERN = re.compile(rb"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)")
PHONE_PATTERN = re.compile(
    rb"(?<!\d)(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?!\d)"
)
VIN_CONTEXT_PATTERN = re.compile(
    rb"(?i)\bvin(?:\s*(?:number|no\.?|#|:|-))?\s*[A-HJ-NPR-Z0-9]{17}\b"
)
RO_CONTEXT_PATTERN = re.compile(
    rb"(?i)\b(?:repair\s+order|ro)\s*(?:number|no\.?|#|:|-)\s*\d{4,10}\b"
)
DEALER_CODE_PATTERN = re.compile(
    rb"(?i)\bdealer[ _-]?code\s*(?:=|:|#|-)?\s*\d{3,10}\b"
)
EMAIL_PATTERN = re.compile(
    rb"(?i)\b[A-Z0-9._%+-]+@(?:[A-Z0-9-]+\.)+[A-Z]{2,}\b"
)
SAFE_EMAIL_SUFFIXES = (
    b"@example.com",
    b"@example.org",
    b"@users.noreply.github.com",
    b"@noreply.github.com",
)

def run(*args: str, input_bytes: bytes | None = None) -> bytes:
    return subprocess.check_output(args, cwd=ROOT, input=input_bytes)


def reachable_objects() -> list[tuple[str, str]]:
    rows = []
    for raw in run("git", "rev-list", "--objects", "--all").splitlines():
        line = raw.decode("utf-8", "surrogateescape")
        oid, _, path = line.partition(" ")
        rows.append((oid, path))
    return rows


def object_types(oids: list[str]) -> dict[str, tuple[str, int]]:
    if not oids:
        return {}
    payload = ("\n".join(oids) + "\n").encode()
    output = run(
        "git", "cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)",
        input_bytes=payload,
    )
    result: dict[str, tuple[str, int]] = {}
    for line in output.decode().splitlines():
        oid, kind, size = line.split()
        result[oid] = (kind, int(size))
    return result


def text_like(data: bytes) -> bool:
    if b"\x00" in data[:8192]:
        return False
    sample = data[:8192]
    if not sample:
        return True
    bad = sum(1 for b in sample if b < 9 or 13 < b < 32)
    return bad / len(sample) < 0.02


def pii_categories(data: bytes) -> list[str]:
    categories = []
    if SSN_PATTERN.search(data):
        categories.append("possible SSN")
    if PHONE_PATTERN.search(data):
        categories.append("possible phone number")
    if VIN_CONTEXT_PATTERN.search(data):
        categories.append("VIN-like value with VIN context")
    if RO_CONTEXT_PATTERN.search(data):
        categories.append("repair-order number with RO context")
    if DEALER_CODE_PATTERN.search(data):
        categories.append("dealer code")
    emails = [m.group(0).lower() for m in EMAIL_PATTERN.finditer(data)]
    unsafe_emails = [e for e in emails if not e.endswith(SAFE_EMAIL_SUFFIXES)]
    if unsafe_emails:
        categories.append("non-example email address")
    return categories


def scan_blob(oid: str, path: str, size: int) -> list[str]:
    findings = []
    if path and boundary.blocked_path(path):
        findings.append("blocked historical path")
    if size > MAX_TEXT_BLOB:
        return findings
    data = run("git", "cat-file", "blob", oid)
    if boundary.blocked_content(data):
        findings.append("blocked secret/target content")
    if text_like(data):
        findings.extend(pii_categories(data))
    return findings


def scan_commit_messages() -> list[tuple[str, str]]:
    findings = []
    for oid in run("git", "rev-list", "--all").decode().splitlines():
        message = run("git", "show", "-s", "--format=%B", oid)
        for category in pii_categories(message):
            findings.append((oid, "commit message: " + category))
        if boundary.PRIVATE_KEY_PATTERN.search(message) or boundary.TOKEN_PATTERN.search(message):
            findings.append((oid, "commit message: secret-like material"))
    return findings


def main() -> int:
    objects = reachable_objects()
    types = object_types([oid for oid, _ in objects])
    findings: list[tuple[str, str, str]] = []
    blob_count = 0

    for oid, path in objects:
        kind, size = types.get(oid, ("", 0))
        if kind != "blob":
            continue
        blob_count += 1
        for category in scan_blob(oid, path, size):
            findings.append((oid, path or "(path unavailable)", category))

    message_findings = scan_commit_messages()

    print(
        f"History audit scanned {blob_count} reachable blobs and "
        f"{len(run('git','rev-list','--all').decode().splitlines())} commits."
    )

    if findings or message_findings:
        print("History audit found material that requires review:")
        for oid, path, category in findings:
            print(f"- {category}: {path} [{oid[:12]}]")
        for oid, category in message_findings:
            print(f"- {category} [{oid[:12]}]")
        raise SystemExit(
            f"History audit failed: {len(findings) + len(message_findings)} finding(s). "
            "Matched values are intentionally not printed."
        )

    print("History audit passed: no blocked historical paths, secret patterns, or contextual PII indicators found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
