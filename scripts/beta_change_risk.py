#!/usr/bin/env python3
"""Fail-closed Beta PR risk classification for the trusted merge workflow.

This deliberately does not certify data preservation. Data-affecting or unknown
changes retain the existing exact-head review requirement until a separate
trusted no-loss proof gate is implemented.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys

BETA_PACKAGE = re.compile(r"updates/packages/moondog-0\.10\.18-beta\.[0-9]+\.json\Z")
NON_EXECUTABLE_METADATA = {"CHANGELOG.md", "README.md", "updates/manifest.json"}
PROTECTED_DOCUMENTS = {
    "docs/RELEASE-AUTHORIZATION.md",
    "docs/RELEASE-PROCESS.md",
    "docs/DATA-PRESERVATION-FIRST-BETA-POLICY.md",
    "docs/DATA-BOUNDARY.md",
    "docs/SOURCE-OF-TRUTH.md",
    "docs/ROADMAP-ACCEPTANCE-MATRIX.md",
    "docs/SOURCE-AUTHORITY-INVENTORY.md",
    "docs/ISSUE-CLOSEOUT-EVIDENCE.json",
}
PROTECTED_TESTS = {
    "tests/test_guarded_merge_policy.py",
    "tests/test_pipeline_guard.py",
    "tests/test_security_workflows.py",
    "tests/test_check_publication.py",
    "tests/test_public_audit_history.py",
    "tests/test_beta_change_risk.py",
}
# New/unproven external-resource CSS is *not* routine: a stylesheet can create
# a cross-origin request despite containing no JavaScript.
CSS_NETWORK = re.compile(
    r"@import|@font-face|url\s*\(|image-set\s*\(|expression\s*\(|"
    r"-moz-binding|behavior\s*:|(?:https?|data|javascript)\s*:|\\\\",
    re.IGNORECASE,
)


def path_risk(path: str, change: dict) -> str:
    if not isinstance(path, str) or not path or "\\" in path or any(part in {"", ".", ".."} for part in path.split("/")):
        return "protected"
    if path.startswith((".github/", "scripts/", "distribution/")) or path in (
        ".gitattributes", ".gitignore", "SECURITY.md"
    ):
        return "protected"
    if path in PROTECTED_DOCUMENTS or path in PROTECTED_TESTS:
        return "protected"
    if path in NON_EXECUTABLE_METADATA or BETA_PACKAGE.fullmatch(path):
        return "metadata"
    if path.startswith("docs/") and path.endswith(".md"):
        return "routine"
    if path.endswith(".css") and (
        path.startswith("assets/") or path == "src/meeting-presenter.css"
    ):
        patch = change.get("patch")
        # A missing/truncated patch or replacement is not proof of safe CSS.
        if change.get("status") != "modified" or not isinstance(patch, str) or not patch:
            return "data-affecting"
        for line in patch.splitlines():
            if line.startswith("+") and not line.startswith("+++"):
                if CSS_NETWORK.search(line[1:]):
                    return "data-affecting"
        return "routine"
    if path.startswith(("tests/", "assets/", "src/", "updates/")) or path.endswith(
        (".js", ".cjs", ".mjs", ".html", ".json")
    ):
        return "data-affecting"
    return "protected"


def classify(changes: list[dict]) -> str:
    """Only an explicit proven-safe scope can bypass the review sign-off."""
    if not isinstance(changes, list) or not changes:
        return "protected"
    kinds = []
    substantive = False
    for item in changes:
        if not isinstance(item, dict) or item.get("status") not in {
            "added", "removed", "modified", "renamed", "copied", "changed"
        }:
            return "protected"
        names = [item.get("filename")]
        if item.get("status") in {"renamed", "copied"}:
            names.append(item.get("previous_filename"))
        for name in names:
            kind = path_risk(name, item)
            kinds.append(kind)
            if kind != "metadata":
                substantive = True
    if "protected" in kinds:
        return "protected"
    if "data-affecting" in kinds or not substantive:
        return "data-affecting"
    return "routine"


def main() -> int:
    if len(sys.argv) != 2:
        print("Expected JSON file of complete GitHub PR file changes", file=sys.stderr)
        return 2
    try:
        content = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
        if not isinstance(content, list):
            raise ValueError("not a list")
        result = classify(content)
    except (OSError, ValueError, TypeError):
        print("Cannot classify changes; refusing automatic review bypass", file=sys.stderr)
        return 2
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
