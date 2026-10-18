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


class HtmlState:
    """Small fail-closed HTML lexer; comments and quoted attributes may span lines."""
    def __init__(self):
        self.stack = []
        self.comment = False
        self.tag = ""
        self.quote = None

    @property
    def active(self):
        return bool(self.stack or self.comment or self.tag)

    def feed(self, line):
        hidden = self.active
        i = 0
        while i < len(line):
            if self.comment:
                end = line.find("-->", i)
                if end < 0:
                    return True
                self.comment = False
                i = end + 3
            elif self.tag:
                char = line[i]
                self.tag += char
                i += 1
                if self.quote:
                    if char == self.quote:
                        self.quote = None
                elif char in {"'", '"'}:
                    self.quote = char
                elif char == ">":
                    match = HTML_TAG.fullmatch(self.tag)
                    if not match:
                        self.stack.append("invalid")
                    else:
                        closing, name = match[1], match[2].lower()
                        if closing:
                            if self.stack and self.stack[-1] == name:
                                self.stack.pop()
                        elif name not in VOID_HTML_TAGS and not self.tag.endswith("/>"):
                            self.stack.append(name)
                    self.tag = ""
            elif line.startswith("<!--", i):
                hidden = self.comment = True
                i += 4
            elif line[i] == "<":
                hidden = True
                self.tag = "<"
                i += 1
            else:
                i += 1
        if self.tag:
            self.tag += "\n"
        return hidden or self.active


def has_explicit_approval(body: str | None) -> bool:
    if not isinstance(body, str):
        return False
    body = body.replace("\r\n", "\n")
    if any(unicodedata.category(ch) in {"Cc", "Cf", "Zl", "Zp"} and ch not in "\n\t" for ch in body):
        return False
    approved = False
    fence = None
    inline_ticks = 0
    quoted_paragraph = False
    html = HtmlState()
    for line in body.split("\n"):
        if fence:
            close = FENCE_CLOSE.fullmatch(line)
            if close and close[1][0] == fence[0] and len(close[1]) >= fence[1]:
                fence = None
            continue
        if not inline_ticks and (html.active or "<" in line):
            if html.feed(line):
                continue
        if not inline_ticks:
            opening = FENCE_OPEN.match(line)
            if opening:
                fence = (opening[1][0], len(opening[1]))
                quoted_paragraph = False
                continue
            if not line.strip():
                quoted_paragraph = False
                continue
            if re.match(r"^ {0,3}(?:#{1,6}(?:[ \t]|$)|(?:\* *\* *\*|- *- *-|_ *_ *_)[ *_-]*$)", line):
                quoted_paragraph = False
                continue
            if re.match(r"^ {0,3}(?:>|[-+*] |\d+[.)] )", line):
                quoted_paragraph = True
                continue
            # Revocation is conservative: an exact visible negative directive
            # must not be lost to an ambiguous lazy-quote boundary.
            if line == "MoonDog-Auto-Merge: no":
                approved = False
                continue
            if quoted_paragraph:
                continue
        was_inline = bool(inline_ticks)
        for ticks in re.finditer(r"(?<!\\)(`+)", line):
            size = len(ticks[1])
            if not inline_ticks:
                inline_ticks = size
            elif size == inline_ticks:
                inline_ticks = 0
        if was_inline or inline_ticks or "`" in line:
            continue
        directive = DIRECTIVE.fullmatch(line)
        if directive:
            approved = directive[1] == "yes"
    return approved and not html.active and not inline_ticks and fence is None


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
