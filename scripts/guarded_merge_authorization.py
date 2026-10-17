#!/usr/bin/env python3
"""Accept only explicit, unquoted, standalone PR merge directives."""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys


DIRECTIVE = re.compile(r"^MoonDog-Auto-Merge: (yes|no)$")
FENCE_OPEN = re.compile(r"^\s{0,3}((?:\x60){3,}|~{3,})(.*)$")
FENCE_CLOSE = re.compile(r"^\s{0,3}((?:\x60){3,}|~{3,})\s*$")
HTML_TAG = re.compile(r"<\s*(/?)\s*([a-z][\w:-]*)\b[^>]*>", re.IGNORECASE)


def has_explicit_approval(body: str | None) -> bool:
    if not isinstance(body, str):
        return False
    # Accept LF and CRLF only; splitlines() also recognizes invisible Unicode
    # and control separators that can fabricate a standalone approval line.
    body = body.replace("\r\n", "\n")
    if any(ch in body for ch in ("\r", "\v", "\f", "\x1c", "\x1d", "\x1e", "\x85", "\u2028", "\u2029")):
        return False
    approved = False
    fence_char = None
    fence_count = 0
    html_comment = False
    html_stack: list[str] = []

    for line in body.split("\n"):
        if html_comment:
            if "-->" in line:
                html_comment = False
            continue
        if "<!--" in line and fence_char is None:
            if "-->" not in line.split("<!--", 1)[1]:
                html_comment = True
            continue

        if html_stack:
            tags = list(HTML_TAG.finditer(line))
            for tag in tags:
                closing, name = tag.group(1), tag.group(2).lower()
                if closing:
                    if html_stack and html_stack[-1] == name:
                        html_stack.pop()
                elif not tag.group(0).endswith("/>"):
                    html_stack.append(name)
            continue

        if fence_char:
            close = FENCE_CLOSE.fullmatch(line)
            if close and close.group(1)[0] == fence_char and len(close.group(1)) >= fence_count:
                fence_char, fence_count = None, 0
            continue
        open_fence = FENCE_OPEN.match(line)
        if open_fence:
            fence_char, fence_count = open_fence.group(1)[0], len(open_fence.group(1))
            continue

        tags = list(HTML_TAG.finditer(line))
        if tags:
            for tag in tags:
                closing, name = tag.group(1), tag.group(2).lower()
                if not closing and not tag.group(0).endswith("/>"):
                    html_stack.append(name)
            continue

        directive = DIRECTIVE.fullmatch(line)
        if directive:
            approved = directive.group(1) == "yes"

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
