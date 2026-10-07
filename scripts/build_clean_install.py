#!/usr/bin/env python3
"""Build and verify a sanitized Service Operations Dashboard clean-install ZIP."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BINARY_VENDOR = {
    "vendor/jszip.min.js",
    "vendor/pdf.min.js",
    "vendor/pdf.worker.min.js",
    "vendor/xlsx.full.min.js",
}
ARCHIVE_ROOT = "Service Operations Dashboard"
HANDOFF_RE = re.compile(r"const HANDOFF_RUNTIME_PATHS=\[(.*?)\];", re.S)
STRING_RE = re.compile(r'"([^"]+)"')
VERSION_RE = re.compile(r'const VERSION="([^"]+)"')


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def runtime_paths() -> list[str]:
    content = (ROOT / "assets" / "app.js").read_text(encoding="utf-8")
    match = HANDOFF_RE.search(content)
    if not match:
        raise RuntimeError("HANDOFF_RUNTIME_PATHS was not found in assets/app.js")
    paths = STRING_RE.findall(match.group(1))
    if not paths or "index.html" not in paths:
        raise RuntimeError("Runtime inventory is incomplete")
    if len(paths) != len(set(paths)):
        raise RuntimeError("Runtime inventory contains duplicates")
    return paths


def app_version() -> str:
    content = (ROOT / "assets" / "app.js").read_text(encoding="utf-8")
    match = VERSION_RE.search(content)
    if not match:
        raise RuntimeError("Application version was not found")
    return match.group(1)


def compatibility_index(runtime_html: bytes) -> bytes:
    text = runtime_html.decode("utf-8")
    if "<base " not in text.lower():
        text, count = re.subn(r"(<head(?:\s[^>]*)?>)", r'\1\n<base href="System Files/">', text, count=1, flags=re.I)
        if count != 1:
            raise RuntimeError("Could not create the root compatibility document")
    return text.encode("utf-8")


def safe_archive_name(name: str) -> str:
    if name.startswith("/") or "\\" in name:
        raise RuntimeError(f"Unsafe archive path: {name}")
    parts = Path(name).parts
    if any(part in {"", ".", ".."} for part in parts):
        raise RuntimeError(f"Unsafe archive path: {name}")
    return name.replace("\\", "/")


def clean_install_readme(version: str) -> bytes:
    return f"""SERVICE OPERATIONS DASHBOARD {version}

START HERE

1. Extract this entire folder before opening the dashboard.
2. Open 00 - OPEN DASHBOARD.html in Microsoft Edge.
3. Choose this extracted Service Operations Dashboard folder when asked.
4. Designate this browser/computer as the store's authoritative writer.
5. Complete Guided Setup and import the first SAPR report.

YOUR DATA
Operational data stays in System Files/Workspace inside this folder. It is not included in software updates and is not uploaded to GitHub by the application.

UPDATES
Use Settings > System Updates to check the verified public update channel. Application updates do not replace System Files/Workspace.

BACKUPS
Use the dashboard Backup & Recovery controls. Keep an external backup separate from this application folder.

Do not run the dashboard from inside the ZIP.
""".encode("utf-8")


def build(vendor_dir: Path, output: Path) -> dict:
    paths = runtime_paths()
    version = app_version()
    payload: dict[str, bytes] = {}

    for path in paths:
        source = vendor_dir / Path(path).name if path in BINARY_VENDOR else ROOT / path
        if not source.is_file():
            raise RuntimeError(f"Required clean-install file is missing: {path} ({source})")
        payload[f"{ARCHIVE_ROOT}/System Files/{path}"] = source.read_bytes()

    runtime_html = payload[f"{ARCHIVE_ROOT}/System Files/index.html"]
    payload[f"{ARCHIVE_ROOT}/00 - OPEN DASHBOARD.html"] = (ROOT / "00 - OPEN DASHBOARD.html").read_bytes()
    payload[f"{ARCHIVE_ROOT}/index.html"] = compatibility_index(runtime_html)
    payload[f"{ARCHIVE_ROOT}/START HERE.txt"] = clean_install_readme(version)

    file_hashes = {name: sha256(data) for name, data in sorted(payload.items())}
    install_manifest = {
        "schemaVersion": 1,
        "product": "Service Operations Dashboard",
        "version": version,
        "dataBoundary": "System Files/Workspace is user-owned local state and is intentionally empty in this archive.",
        "files": file_hashes,
    }
    payload[f"{ARCHIVE_ROOT}/INSTALL-MANIFEST.json"] = (
        json.dumps(install_manifest, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")

    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr(f"{ARCHIVE_ROOT}/System Files/Workspace/", b"")
        for name, data in sorted(payload.items()):
            archive.writestr(safe_archive_name(name), data)

    verify(output)
    return {
        "version": version,
        "zip": str(output),
        "sha256": sha256(output.read_bytes()),
        "files": len(payload),
    }


def verify(archive_path: Path) -> None:
    seen: set[str] = set()
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        expected_workspace = f"{ARCHIVE_ROOT}/System Files/Workspace/"
        if expected_workspace not in names:
            raise RuntimeError("Clean archive is missing the empty Workspace directory")

        for raw in names:
            name = safe_archive_name(raw)
            canonical = name.lower().rstrip("/")
            if canonical in seen:
                raise RuntimeError(f"Duplicate canonical archive path: {name}")
            seen.add(canonical)
            workspace_prefix = f"{ARCHIVE_ROOT}/System Files/Workspace/"
            if name.startswith(workspace_prefix) and name != workspace_prefix:
                raise RuntimeError(f"Clean archive contains local workspace state: {name}")

        manifest_name = f"{ARCHIVE_ROOT}/INSTALL-MANIFEST.json"
        manifest = json.loads(archive.read(manifest_name))
        for name, expected in manifest["files"].items():
            if sha256(archive.read(name)) != expected:
                raise RuntimeError(f"Archive hash verification failed: {name}")

        launcher = archive.read(f"{ARCHIVE_ROOT}/00 - OPEN DASHBOARD.html").decode("utf-8")
        if "index.html" not in launcher:
            raise RuntimeError("Launcher does not target index.html")
        root_index = archive.read(f"{ARCHIVE_ROOT}/index.html").decode("utf-8")
        if '<base href="System Files/">' not in root_index:
            raise RuntimeError("Root compatibility index does not target System Files")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vendor-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--verify-only", type=Path)
    args = parser.parse_args()

    if args.verify_only:
        verify(args.verify_only)
        print(f"Verified {args.verify_only}")
        return 0

    result = build(args.vendor_dir, args.output)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"clean-install build failed: {error}", file=sys.stderr)
        raise SystemExit(1)
