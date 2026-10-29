#!/usr/bin/env python3
"""Fail-closed Clean Install Proof scope for Beta metadata-only pull requests."""
from __future__ import annotations
import argparse
import json
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

MANIFEST = "updates/manifest.json"
BETA_PACKAGE = re.compile(r"updates/packages/moondog-\d+\.\d+\.\d+-beta\.\d+\.json\Z")
CHANGELOG = "CHANGELOG.md"

def stable_manifest_unchanged(base: Any, head: Any) -> bool:
    """Return true only when both manifest snapshots have identical Stable data."""
    return (
        isinstance(base, dict) and isinstance(head, dict)
        and isinstance(base.get("stable"), dict) and isinstance(head.get("stable"), dict)
        and base["stable"] == head["stable"]
    )

def classify_scope(changed_paths: Iterable[str], *, base_manifest: Any = None, head_manifest: Any = None) -> str:
    """Reuse runtime UX proof only for manifest-backed Beta-only metadata diffs."""
    paths = tuple(changed_paths)
    allowed = {MANIFEST, CHANGELOG}
    if not paths or MANIFEST not in paths:
        return "runtime-change"
    if any(path not in allowed and BETA_PACKAGE.fullmatch(path) is None for path in paths):
        return "runtime-change"
    if not stable_manifest_unchanged(base_manifest, head_manifest):
        return "runtime-change"
    return "metadata-only"

def read_manifest(path: str | None) -> Any:
    if not path:
        return None
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-manifest")
    parser.add_argument("--head-manifest")
    parser.add_argument("paths", nargs="*")
    args = parser.parse_args()
    print(classify_scope(args.paths, base_manifest=read_manifest(args.base_manifest), head_manifest=read_manifest(args.head_manifest)))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
