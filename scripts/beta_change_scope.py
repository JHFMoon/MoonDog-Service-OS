#!/usr/bin/env python3
"""Fail-closed Clean Install Proof scope for Beta metadata-only pull requests."""
from __future__ import annotations

import re
import sys
from collections.abc import Iterable

MANIFEST = "updates/manifest.json"
BETA_PACKAGE = re.compile(r"updates/packages/moondog-\d+\.\d+\.\d+-beta\.\d+\.json\Z")
CHANGELOG = "CHANGELOG.md"


def classify_scope(changed_paths: Iterable[str]) -> str:
    """Return metadata-only only for a manifest-backed Beta metadata diff.

    Every unrecognized path falls back to the full browser proof. The Beta
    manifest must be part of the diff; package-only changes without the
    matching manifest remain on the full path and are checked by Publication.
    """
    paths = tuple(changed_paths)
    allowed = {MANIFEST, CHANGELOG}
    if not paths or MANIFEST not in paths:
        return "runtime-change"
    if any(path not in allowed and BETA_PACKAGE.fullmatch(path) is None for path in paths):
        return "runtime-change"
    return "metadata-only"


if __name__ == "__main__":
    print(classify_scope(sys.argv[1:]))
