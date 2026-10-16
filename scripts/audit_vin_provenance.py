#!/usr/bin/env python3
"""Local-only, redacted investigation of Git-history VIN candidates.

This does not clear, bypass or change the blocking public-history audit.
The opt-in report stores blob IDs and safe metadata, never matched values.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess

VIN_RX = re.compile(rb"\b[A-HJ-NPR-Z0-9]{17}\b")
MAX_BLOB_BYTES = 15_000_000
WEIGHTS = (8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2)
VALUES = {str(n): n for n in range(10)}
for letters, weights in (
    ("ABCDEFGH", (1, 2, 3, 4, 5, 6, 7, 8)),
    ("JKLMNPR", (1, 2, 3, 4, 5, 7, 9)),
    ("STUVWXYZ", (2, 3, 4, 5, 6, 7, 8, 9)),
):
    VALUES.update(zip(letters, weights))


def valid_vin(raw: bytes) -> bool:
    try:
        code = raw.decode("ascii")
        total = sum(VALUES[ch] * weight for ch, weight in zip(code, WEIGHTS))
    except (UnicodeDecodeError, KeyError):
        return False
    return code[8] == ("X" if total % 11 == 10 else str(total % 11))


def git(repo: Path, *args: str) -> bytes:
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=True,
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    ).stdout


def path_category(path: str) -> str:
    first = path.split("/", 1)[0].lower()
    return first if first in {"tests", "scripts", "docs", "assets", "src", "updates", "distribution", "vendor", ".github"} else "other"


def inspect(repo: Path) -> dict:
    candidates = []
    visited = set()
    checked = 0
    oversize = 0
    for row in git(repo, "rev-list", "--objects", "--all").decode("utf-8", "replace").splitlines():
        oid, _, path = row.partition(" ")
        if oid in visited:
            continue
        visited.add(oid)
        if git(repo, "cat-file", "-t", oid).strip() != b"blob":
            continue
        checked += 1
        size = int(git(repo, "cat-file", "-s", oid))
        if size > MAX_BLOB_BYTES:
            oversize += 1
            continue
        data = git(repo, "cat-file", "blob", oid)
        positions = [m.start() for m in VIN_RX.finditer(data) if valid_vin(m.group(0))]
        if not positions:
            continue
        # Context clues are explicitly NOT evidence of synthetic origin.
        marker_count = sum(bool(re.search(rb"(?i)\b(?:synthetic|fixture|mock|dummy|test)\b", data[max(0, pos - 160):pos + 177])) for pos in positions)
        candidates.append({
            "blob_sha": oid,
            "path_category": path_category(path),
            "valid_vin_occurrences": len(positions),
            "fixture_context_clues": marker_count,
            "line_numbers": [data.count(b"\n", 0, pos) + 1 for pos in positions],
            "classification": "UNVERIFIED_REQUIRES_PRIVATE_REVIEW",
        })
    return {
        "scope": "all reachable Git-history blobs",
        "checked_blobs": checked,
        "oversize_uninspected_blobs": oversize,
        "candidate_blobs": len(candidates),
        "candidates": sorted(candidates, key=lambda item: item["blob_sha"]),
        "note": "Context clues are not proof of safety. No identifiers or source lines are included.",
    }


def private_write(output: Path, repo: Path, payload: dict) -> None:
    # Never leave investigation metadata in source control.
    out = output.resolve()
    root = repo.resolve()
    if out == root or root in out.parents:
        raise ValueError("Private investigation report must be outside the repository")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(str(out), flags, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(payload, stream, indent=2, sort_keys=True)
        stream.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--private-report", type=Path)
    args = parser.parse_args()
    data = inspect(args.repo)
    # Standard output deliberately contains counts only.
    print(f"Git blobs checked: {data['checked_blobs']}")
    print(f"Uninspected oversized blobs: {data['oversize_uninspected_blobs']}")
    print(f"Unclassified VIN-candidate blobs: {data['candidate_blobs']}")
    if args.private_report:
        private_write(args.private_report, args.repo, data)
        print("Redacted detailed report saved outside repository (owner-readable only).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
