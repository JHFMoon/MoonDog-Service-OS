#!/usr/bin/env python3
"""Print the authoritative MoonDog roadmap progress without changing closure rules."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/ROADMAP-ACCEPTANCE-MATRIX.md"
EVIDENCE = ROOT / "docs/ISSUE-CLOSEOUT-EVIDENCE.json"
MANIFEST = ROOT / "updates/manifest.json"
DEFERRED = frozenset({212})
HEADER = re.compile(r"^## #([1-9]\d*)\b")
CRITERION = re.compile(r"^\|\s*([1-9]\d*-\d{2})\s*\|")


def collect(text):
    found = {}
    current = None
    for line in text.splitlines():
        match = HEADER.match(line)
        if match:
            current = int(match.group(1))
            found.setdefault(current, {})
            continue
        match = CRITERION.match(line)
        if not match:
            continue
        key = match.group(1)
        if current is None or not key.startswith(str(current) + "-"):
            raise ValueError("Criterion outside its issue: " + key)
        if key in found[current]:
            raise ValueError("Duplicate criterion: " + key)
        # The final table column is authoritative, not an incidental mention.
        status = line.strip().strip("|").split("|")[-1]
        found[current][key] = bool(re.search(r"\*\*VERIFIED COMPLETE\*\*", status))
    return found


def main():
    matrix = collect(MATRIX.read_text(encoding="utf-8"))
    registry = json.loads(EVIDENCE.read_text(encoding="utf-8"))["issues"]
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    matrix_issues = set(matrix)
    registry_issues = {int(issue) for issue in registry}
    if matrix_issues != registry_issues:
        raise ValueError("Roadmap issue mismatch: matrix only "
                         + str(sorted(matrix_issues - registry_issues))
                         + "; registry only "
                         + str(sorted(registry_issues - matrix_issues)))
    print("MoonDog roadmap — Beta " + manifest["beta"]["version"])
    print("Issue | Verified | Remaining | Proof records | Status")
    verified_total = total = 0
    for issue, criteria in matrix.items():
        if not criteria:
            raise ValueError("Missing matrix entry for issue #" + str(issue))
        verified = sum(criteria.values())
        supplied = registry.get(str(issue), {}).get("criteria", {})
        matched = sum(1 for key in criteria if key in supplied and criteria[key])
        remaining = len(criteria) - verified
        status = "DEFERRED" if issue in DEFERRED else (
            "READY FOR CLOSURE REVIEW" if remaining == 0 else "OPEN REQUIREMENTS")
        if issue not in DEFERRED:
            verified_total += verified
            total += len(criteria)
        print(f"#{issue} | {verified}/{len(criteria)} | {remaining} | "
              f"{matched}/{verified} credited | {status}")
    print(f"ACTIVE TOTAL | {verified_total}/{total} | {total - verified_total} remaining")
    print("Proof-record counts are informational, not independent proof of valid CI.")
    print("This report does not mutate GitHub, declare issues closed, or waive branch protections.")


if __name__ == "__main__":
    main()
