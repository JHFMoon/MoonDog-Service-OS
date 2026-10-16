#!/usr/bin/env python3
"""Guarded Beta PR-merge consent: accept explicit, unquoted standalone directives only.

The last valid directive wins, allowing a later explicit 'no' to revoke consent.
Free-text mentions, inline code, quotes, lists and fenced examples grant nothing.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys


DIRECTIVE = re.compile(r"^MoonDog-Auto-Merge: (yes|no)$")
FENCE = re.compile(r"^\s*((?:\x60){3,}|~{3,})")


def has_explicit_approval(body: str | None) -> bool:
    if not isinstance(body, str):
        return False
    approved = False
    fence_char = None
    fence_count = 0
    for line in body.splitlines():
        mark = FENCE.match(line)
        if mark:
            chars = mark.group(1)
            if fence_char is None:
                fence_char, fence_count = chars[0], len(chars)
            elif chars[0] == fence_char and len(chars) >= fence_count:
                fence_char, fence_count = None, 0
            continue
        if fence_char:
            continue
        candidate = DIRECTIVE.fullmatch(line)
        if candidate:
            approved = candidate.group(1) == "yes"
    return approved


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: guarded_merge_authorization.py <local-pr-json>", file=sys.stderr)
        return 2
    try:
        payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
        approved = has_explicit_approval(payload.get("body"))
    except (OSError, ValueError, AttributeError):
        print("Cannot verify structured PR authorization", file=sys.stderr)
        return 2
    if not approved:
        print("No explicit automatic-merge authorization")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
