#!/usr/bin/env python3
"""Fail-closed risk and scoped preservation-proof decisions for Beta changes.

A complete PR file list and exact-head Publication Check / Clean Install Proof
are required separately. These checks reduce data-loss risk but cannot
guarantee that every possible failure is covered.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys

BETA_PACKAGE = re.compile(r"updates/packages/moondog-0\.10\.18-beta\.[0-9]+\.json\Z")
NON_EXECUTABLE_METADATA = {"CHANGELOG.md", "README.md", "updates/manifest.json"}
PROTECTED_DOCUMENTS = {
    "docs/RELEASE-AUTHORIZATION.md", "docs/RELEASE-PROCESS.md",
    "docs/DATA-PRESERVATION-FIRST-BETA-POLICY.md", "docs/DATA-BOUNDARY.md",
    "docs/SOURCE-OF-TRUTH.md", "docs/ROADMAP-ACCEPTANCE-MATRIX.md",
    "docs/SOURCE-AUTHORITY-INVENTORY.md", "docs/ISSUE-CLOSEOUT-EVIDENCE.json",
}
CRITICAL_PRESERVATION_TESTS = frozenset({
    "tests/durable-write-fault-matrix.test.cjs",
    "tests/open-ro-save-failure-does-not-advance.test.cjs",
    "tests/open-ro-edit-save-roundtrip.test.cjs",
    "tests/restore-safety-durable-source.test.cjs",
    "tests/sapr-zero-day-history-comparison.test.cjs",
    "tests/supervisor-workbook-recovery.test.cjs",
    "tests/workspace-history-isolation.test.cjs",
    "tests/write-authority-recovery-conflicts.test.cjs",
    "tests/local-target-boundary.test.cjs",
    "tests/source-boundary.test.cjs",
    "tests/manifest-cdn-bypass.test.cjs",
    "tests/automatic-diagnostics-disabled.test.cjs",
})
PROTECTED_TESTS = {
    "tests/test_guarded_merge_policy.py", "tests/test_pipeline_guard.py",
    "tests/test_security_workflows.py", "tests/test_check_publication.py",
    "tests/test_public_audit_history.py", "tests/test_beta_change_risk.py",
}
PROTECTED_RUNTIME = frozenset({
    "assets/moondog-write-authority.js",
    "assets/maintenance.js",
    "assets/maintenance-tests.js",
})
CSS_NETWORK = re.compile(
    r"@import|@font-face|url\s*\(|image-set\s*\(|expression\s*\(|"
    r"-moz-binding|behavior\s*:|(?:https?|data|javascript)\s*:|\\",
    re.IGNORECASE,
)


def path_risk(path: str, change: dict) -> str:
    if not isinstance(path, str) or not path or "\\" in path or any(
        part in {"", ".", ".."} for part in path.split("/")
    ):
        return "protected"
    if path.startswith((".github/", "scripts/", "distribution/")) or path in {
        ".gitattributes", ".gitignore", "SECURITY.md",
    } or path in PROTECTED_DOCUMENTS or path in PROTECTED_TESTS or path in CRITICAL_PRESERVATION_TESTS or path in PROTECTED_RUNTIME or path.startswith("assets/moondog-update-"):
        return "protected"
    if path in NON_EXECUTABLE_METADATA or BETA_PACKAGE.fullmatch(path):
        return "metadata"
    if path.startswith("docs/") and path.endswith(".md"):
        return "routine"
    if path.endswith(".css") and (
        path.startswith("assets/") or path == "src/meeting-presenter.css"
    ):
        patch = change.get("patch")
        # Missing or truncated CSS diff is NOT evidence of a safe edit.
        if change.get("status") != "modified" or not isinstance(patch, str) or not patch:
            return "protected"
        for line in patch.splitlines():
            if line.startswith("+") and not line.startswith("+++"):
                if CSS_NETWORK.search(line[1:]):
                    return "protected"
        return "routine"
    if path.startswith(("tests/", "assets/", "src/", "updates/")) or path.endswith(
        (".js", ".cjs", ".mjs", ".html", ".json")
    ):
        return "data-affecting"
    return "protected"


def classify(changes: list[dict]) -> str:
    """Never permit unknown scope or changes to the safety machinery."""
    if not isinstance(changes, list) or not changes:
        return "protected"
    kinds = []
    substantive = False
    for item in changes:
        if not isinstance(item, dict) or item.get("status") not in {
            "added", "removed", "modified", "renamed", "copied", "changed",
        }:
            return "protected"
        if item["status"] == "removed" and str(item.get("filename", "")).startswith("tests/"):
            return "protected"
        names = [item.get("filename")]
        if item["status"] in {"renamed", "copied"}:
            names.append(item.get("previous_filename"))
        for name in names:
            kind = path_risk(name, item)
            kinds.append(kind)
            if kind != "metadata":
                substantive = True
    if "protected" in kinds:
        return "protected"
    if not substantive:
        return "protected"
    if "data-affecting" in kinds:
        return "data-affecting"
    return "routine"


def has_scoped_preservation_proof(changes: list[dict]) -> bool:
    """Require focused executed source-bound synthetic regression evidence.

    This is an eligibility gate, not a claim that static inspection can prove
    correctness. The exact-head test run and its broader data-integrity suite
    are still mandatory.
    """
    files = {item["filename"]: item for item in changes}
    runtime_paths = [
        path for path in files
        if (path.startswith(("assets/", "src/")) and path.endswith((".js", ".mjs", ".json")))
        or path.endswith(".html")
    ]
    # Unknown operational JSON payload changes cannot bypass review merely
    # because they are not JavaScript or HTML.
    if any(
        path.startswith("updates/") and path not in NON_EXECUTABLE_METADATA
        and not BETA_PACKAGE.fullmatch(path)
        for path in files
    ):
        return False
    if not runtime_paths:
        return True
    eligible = []
    for path, item in files.items():
        if not (path.startswith("tests/") and path.count("/") == 1
                and path.endswith(".test.cjs")
                and re.search(r"(?i)(?:ro|import|history|source|data|durab|backup|recover|preserv|integrity|storage|state|roundtrip|migration|write)", path)
                and item.get("status") in {"added", "modified"}
                and path not in CRITICAL_PRESERVATION_TESTS):
            continue
        patch = item.get("patch")
        if not isinstance(patch, str):
            continue
        added = "\n".join(line[1:] for line in patch.splitlines()
                          if line.startswith("+") and not line.startswith("+++"))
        # Tests must exercise real production source, not only a mock or an
        # unrelated assertion with an RO-looking filename.
        if not re.search(r"\b(?:readFileSync|require)\s*\(", added):
            continue
        if not re.search(r"\b(?:before|prior|original|snapshot)\b", added, re.IGNORECASE):
            continue
        if not re.search(r"\b(?:after|saved|restored|current)\b", added, re.IGNORECASE):
            continue
        if not re.search(r"\bassert\.(?:deepEqual|strictEqual|equal)\s*\(", added):
            continue
        eligible.append(added)
    return all(any(path in test for test in eligible) for path in runtime_paths)


def merge_decision(changes: list[dict]) -> str:
    """Return automatic, review-required, or protected; CI gates remain separate."""
    risk = classify(changes)
    if risk == "protected":
        return "protected"
    if risk == "routine" or has_scoped_preservation_proof(changes):
        return "automatic"
    return "review-required"


def main() -> int:
    if len(sys.argv) not in {2, 5}:
        print("Expected PR files JSON; optional --decision --expected NUMBER", file=sys.stderr)
        return 2
    if len(sys.argv) == 5 and (sys.argv[2] != "--decision" or sys.argv[3] != "--expected"):
        return 2
    try:
        content = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
        if not isinstance(content, list) or not content:
            raise ValueError("missing change list")
        if len(sys.argv) == 5 and len(content) != int(sys.argv[4]):
            raise ValueError("incomplete PR file list")
        result = merge_decision(content) if len(sys.argv) == 5 else classify(content)
    except (OSError, ValueError, TypeError):
        print("Unable to validate complete PR scope; refusing review bypass", file=sys.stderr)
        return 2
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
