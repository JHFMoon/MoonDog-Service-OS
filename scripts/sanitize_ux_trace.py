#!/usr/bin/env python3
"""Fail-closed sanitizer for synthetic Playwright retry traces.

Only sanitized JSONL event metadata is retained. Snapshots, screenshots,
source files, network bodies, and all other archive members are discarded.
"""
from __future__ import annotations

import json
import os
import re
import stat
import sys
import tempfile
import zipfile
from pathlib import Path

MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
MAX_TRACE_BYTES = 16 * 1024 * 1024
MAX_MEMBERS = 4096
MAX_RECORDS = 100000
MAX_LINE_BYTES = 256 * 1024

CREDENTIAL_KEY = re.compile(
    r"(?:password|passwd|token|secret|credential|private.?key|api.?key|authorization|cookie)",
    re.IGNORECASE,
)
QUOTED_PATH = re.compile(r"""(?P<q>["'])(?:file://|[A-Za-z]:[\\/]|/(?!/))[^"'\r\n]*(?P=q)""", re.IGNORECASE)
FILE_URL = re.compile(r"""file://[^\r\n]*""", re.IGNORECASE)
WEB_URL = re.compile(r"""https?://[^\r\n]*""", re.IGNORECASE)
AUTH_VALUE = re.compile(
    r"""(?i)\b(authorization|proxy-authorization)\s*[:=]\s*(?!\[redacted\])(?:(?:bearer|basic)\s+)?"""
    r"""(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^,\s;}]+)(?:\s+[^,;}]+)?"""
)
CREDENTIAL_ASSIGNMENT = re.compile(
    r"""(?i)(["']?)(password|passwd|token|secret|credential|private.?key|api.?key|authorization|cookie)(["']?)\s*[:=]\s*(?!\[redacted\])(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;}\]]+)"""
)
WIN_PATH = re.compile(r"""(?i)(?<![A-Za-z0-9])(?:[A-Z]:[\\/])[^\r\n]*""")
POSIX_SUFFIX = re.compile(r"""(?<![A-Za-z0-9_:/])/(?!/)[^\r\n]*""")

def _clean_string(value: str) -> str:
    # Redactions can expose another sensitive pattern in the same diagnostic
    # (for example, a quoted header value containing a path). Iterate to a
    # fixed point with a hard bound, then let validation fail closed if needed.
    value = value[:8192]
    for _ in range(8):
        cleaned = QUOTED_PATH.sub("[redacted-path]", value)
        cleaned = FILE_URL.sub("[redacted-file-url]", cleaned)
        cleaned = WEB_URL.sub("[redacted-url]", cleaned)
        cleaned = AUTH_VALUE.sub(r"\1=[redacted]", cleaned)
        cleaned = CREDENTIAL_ASSIGNMENT.sub(r"\1\2\3=[redacted]", cleaned)
        cleaned = WIN_PATH.sub("[redacted-path]", cleaned)
        cleaned = POSIX_SUFFIX.sub("[redacted-path]", cleaned)
        cleaned = cleaned[:4096]
        if cleaned == value:
            return cleaned
        value = cleaned
    return value

def _clean(value):
    if isinstance(value, dict):
        cleaned = {}
        for key, child in value.items():
            safe_key = _clean_string(str(key))[:256]
            cleaned[safe_key] = "[redacted]" if CREDENTIAL_KEY.search(str(key)) else _clean(child)
        return cleaned
    if isinstance(value, list):
        return [_clean(item) for item in value[:10000]]
    if isinstance(value, str):
        return _clean_string(value)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return "[redacted-value]"

def _unsafe_category(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if CREDENTIAL_KEY.search(str(key)) and child != "[redacted]":
                return "credential-field"
            category = _unsafe_category(child)
            if category:
                return category
        return None
    if isinstance(value, list):
        for item in value:
            category = _unsafe_category(item)
            if category:
                return category
        return None
    if isinstance(value, str):
        if _clean_string(value) == value:
            return None
        for category, pattern in (
            ("quoted-path", QUOTED_PATH),
            ("file-url", FILE_URL),
            ("web-url", WEB_URL),
            ("auth-value", AUTH_VALUE),
            ("credential-text", CREDENTIAL_ASSIGNMENT),
            ("windows-path", WIN_PATH),
            ("posix-path", POSIX_SUFFIX),
        ):
            if pattern.search(value):
                return category
        return "unclassified-residue"
    return None

def _is_safe(value) -> bool:
    return _unsafe_category(value) is None

def _read_events(source: Path):
    if not source.is_file() or source.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("source archive is unavailable or exceeds the safety limit")
    with zipfile.ZipFile(source) as archive:
        infos = archive.infolist()
        if len(infos) > MAX_MEMBERS:
            raise ValueError("source archive exceeds the member limit")
        matching = [info for info in infos if info.filename == "trace.trace"]
        if len(matching) != 1 or matching[0].file_size > MAX_TRACE_BYTES:
            raise ValueError("source archive has no bounded Playwright event trace")
        raw = archive.read(matching[0])
    lines = raw.splitlines()
    if len(lines) > MAX_RECORDS:
        raise ValueError("trace has too many event records")
    events = []
    for line in lines:
        if not line:
            continue
        if len(line) > MAX_LINE_BYTES:
            raise ValueError("trace event exceeds the size limit")
        event = json.loads(line.decode("utf-8"))
        if not isinstance(event, dict):
            raise ValueError("trace event is not an object")
        events.append(_clean(event))
    return events, len(infos) - 1

def _write_zip(destination: Path, events, discarded_count: int):
    destination.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schemaVersion": 1,
        "format": "sanitized-playwright-jsonl",
        "eventCount": len(events),
        "discardedMemberCount": discarded_count,
    }
    payload = b"".join(
        json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
        for event in events
    )
    fd, temporary_name = tempfile.mkstemp(prefix=".ux-trace-", suffix=".zip", dir=destination.parent)
    os.close(fd)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name, data in (
                ("trace.trace", payload),
                ("sanitized-manifest.json", json.dumps(manifest, sort_keys=True).encode("utf-8")),
            ):
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                archive.writestr(info, data)
        validate_archive(temporary)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)

def validate_archive(archive_path: Path):
    if not archive_path.is_file() or archive_path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("sanitized trace archive is unavailable or oversized")
    with zipfile.ZipFile(archive_path) as archive:
        names = [item.filename for item in archive.infolist()]
        if sorted(names) != ["sanitized-manifest.json", "trace.trace"]:
            raise ValueError("trace archive contains unexpected members")
        manifest = json.loads(archive.read("sanitized-manifest.json"))
        if (
            manifest.get("schemaVersion") != 1
            or manifest.get("format") != "sanitized-playwright-jsonl"
            or not isinstance(manifest.get("eventCount"), int)
            or not isinstance(manifest.get("discardedMemberCount"), int)
        ):
            raise ValueError("sanitized trace manifest is invalid")
        data = archive.read("trace.trace")
    count = 0
    for line in data.splitlines():
        if not line:
            continue
        event = json.loads(line.decode("utf-8"))
        if not isinstance(event, dict):
            raise ValueError("trace archive contains a non-object event")
        category = _unsafe_category(event)
        if category:
            raise ValueError("trace archive has unsafe " + category)
        count += 1
    if count != manifest["eventCount"]:
        raise ValueError("sanitized trace event count does not match")
    return True

def sanitize_archive(source: Path, destination: Path):
    events, discarded = _read_events(source)
    _write_zip(destination, events, discarded)

def main(argv):
    if len(argv) == 4 and argv[1] == "sanitize":
        try:
            sanitize_archive(Path(argv[2]), Path(argv[3]))
            validate_archive(Path(argv[3]))
            print("PASS: sanitized synthetic browser trace validated")
            return 0
        except Exception as error:
            safe_reasons = {
                "source archive is unavailable or exceeds the safety limit",
                "source archive exceeds the member limit",
                "source archive has no bounded Playwright event trace",
                "trace has too many event records",
                "trace event exceeds the size limit",
                "trace event is not an object",
                "trace archive is unavailable or oversized",
                "trace archive contains unexpected members",
                "sanitized trace manifest is invalid",
                "trace archive contains unsanitized event data",
                "trace archive contains a non-object event",
                "sanitized trace event count does not match",
            }
            detail = str(error) if isinstance(error, ValueError) and (
                str(error) in safe_reasons or str(error) in {
                    "trace archive has unsafe " + category for category in (
                        "credential-field", "quoted-path", "file-url", "web-url",
                        "auth-value", "credential-text", "windows-path",
                        "posix-path", "unclassified-residue",
                    )
                }
            ) else type(error).__name__
            print("FAIL: synthetic browser trace could not be sanitized safely (" + detail + ")", file=sys.stderr)
            return 1
    if len(argv) == 3 and argv[1] == "validate":
        try:
            validate_archive(Path(argv[2]))
            print("PASS: sanitized synthetic browser trace validated")
            return 0
        except Exception:
            print("FAIL: synthetic browser trace validation failed", file=sys.stderr)
            return 1
    print("usage: sanitize_ux_trace.py sanitize SOURCE.zip DESTINATION.zip | validate ARCHIVE.zip", file=sys.stderr)
    return 2

if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
