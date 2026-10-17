#!/usr/bin/env python3
"""Accept only explicit, unquoted, standalone PR merge directives."""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys
import unicodedata


DIRECTIVE = re.compile(r"^MoonDog-Auto-Merge: (yes|no)$")
FENCE_OPEN = re.compile(r"^\s{0,3}((?:\x60){3,}|~{3,})(.*)$")
FENCE_CLOSE = re.compile(r"^\s{0,3}((?:\x60){3,}|~{3,})\s*$")
HTML_TAG = re.compile(r"<\s*(/?)\s*([a-z][\w:-]*)\b[^>]*>", re.IGNORECASE)


VOID_HTML_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}


def has_explicit_approval(body: str | None) -> bool:
    if not isinstance(body, str):
        return False
    # Accept LF and CRLF only; splitlines() also recognizes invisible Unicode
    # and control separators that can fabricate a standalone approval line.
    body = body.replace("\r\n", "\n")
    if any((unicodedata.category(ch) in {"Cc", "Cf", "Zl", "Zp"} and ch not in "\n\t") for ch in body):
        return False
    approved = False
    fence_char = None
    fence_count = 0
    # Ignore HTML inside Markdown fences before tracking hidden HTML spans.
    html_lines = []
    html_fence = None
    for line in body.split("\n"):
        if html_fence:
            close = FENCE_CLOSE.fullmatch(line)
            if close and close[1][0] == html_fence[0] and len(close[1]) >= html_fence[1]:
                html_fence = None
            html_lines.append("")
        else:
            opening = FENCE_OPEN.match(line)
            if opening:
                html_fence = (opening[1][0], len(opening[1]))
                html_lines.append("")
            else:
                html_lines.append(line)
    markup_body = "\n".join(html_lines)
    html_hidden = set()
    stack = []
    cursor = 0
    line_number = 0
    for token in re.finditer(r"<!--[\s\S]*?(?:-->|$)|<[^>]*(?:>|$)", markup_body):
        between = markup_body[cursor:token.start()]
        if stack:
            html_hidden.update(range(line_number, line_number + between.count("\n") + 1))
        line_number += between.count("\n")
        value = token.group()
        html_hidden.update(range(line_number, line_number + value.count("\n") + 1))
        line_number += value.count("\n")
        tag = HTML_TAG.fullmatch(value)
        if tag:
            closing, name = tag.group(1), tag.group(2).lower()
            if closing:
                if stack and stack[-1] == name:
                    stack.pop()
            elif name not in VOID_HTML_TAGS and not value.endswith("/>"):
                stack.append(name)
        elif not value.startswith("<!--"):
            stack.append("invalid")
        cursor = token.end()
    if stack:
        return False
    quoted_paragraph = False

    for number, line in enumerate(body.split("\n")):
        if fence_char:
            close = FENCE_CLOSE.fullmatch(line)
            if close and close.group(1)[0] == fence_char and len(close.group(1)) >= fence_count:
                fence_char, fence_count = None, 0
            continue
        # Feed HTML before interpreting Markdown. Partial tags/comments can
        # span lines, and multiple comments may occur on the same line.
        if number in html_hidden:
            continue
        if not line.strip():
            quoted_paragraph = False
            continue
        if re.match(r"^ {0,3}(?:>|[-+*] |\d+[.)] )", line):
            quoted_paragraph = True
        if quoted_paragraph:
            continue
        open_fence = FENCE_OPEN.match(line)
        if open_fence:
            fence_char, fence_count = open_fence.group(1)[0], len(open_fence.group(1))
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
