#!/usr/bin/env python3
"""Build and verify the deterministic, sanitized offline distribution ZIP."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_JS = ROOT / "assets" / "app.js"
MANIFEST = ROOT / "updates" / "manifest.json"

VENDOR_BINARIES = {
    "vendor/jszip.min.js": "jszip.min.js",
    "vendor/pdf.min.js": "pdf.min.js",
    "vendor/pdf.worker.min.js": "pdf.worker.min.js",
    "vendor/xlsx.full.min.js": "xlsx.full.min.js",
}
WORKSPACE_DIRS = [
    "System Files/Workspace/",
    "System Files/Workspace/data/",
    "System Files/Workspace/data/history/",
    "System Files/Workspace/backups/",
    "System Files/Workspace/imports/",
    "System Files/Workspace/exports/",
    "System Files/Workspace/support/",
    "System Files/Workspace/01 - DROP REPORTS HERE/",
]
FORBIDDEN_RUNTIME_PREFIXES = (
    "Workspace/", "data/", "history/", "backups/", "reports/", "exports/",
    "logs/", "temp/", "tmp/", "Files To Learn/", "01 - DROP REPORTS HERE/",
)

LAUNCHER = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0; url=System%20Files/index.html"><title>Service Operations Dashboard</title></head>
<body><p>Opening Service Operations Dashboard… <a href="System%20Files/index.html">Continue</a></p>
<script>location.replace("System Files/index.html");</script></body></html>
"""

START_HERE = """SERVICE OPERATIONS DASHBOARD — START HERE

1. Extract this ZIP to a normal folder you control. Do not run it from inside the ZIP.
2. Open "00 - OPEN DASHBOARD.html" in Microsoft Edge.
3. When asked for the working folder, choose THIS extracted "Service Operations Dashboard" folder.
4. Choose "Designate this computer for store editing" when the Dashboard offers it.
5. Complete Guided Setup. Your store identity, reports, settings, history, and backups remain in System Files/Workspace on this computer.
6. Use Settings > System Updates to check for verified application updates.

NORMAL OPERATION IS LOCAL AND OFFLINE.
The application does not upload dealership operational data to GitHub.
Back up the entire extracted folder or use the Dashboard's validated Backup & Recovery tools.
"""

WORKSPACE_README = """LOCAL OPERATIONAL WORKSPACE

This folder belongs to this installation and is protected from software updates.
Store settings, imported report state, repair-order management state, history, backups,
exports, support files, and other local operational data stay here.

Do not copy this Workspace into the public source repository.
Do not replace this folder with files from an application update.
"""


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_contract() -> tuple[str, list[str]]:
    app = APP_JS.read_text(encoding="utf-8")
    version_match = re.search(r'const VERSION = "([^"]+)";', app)
    runtime_match = re.search(r"const HANDOFF_RUNTIME_PATHS=(\[[^;]+\]);", app, re.S)
    if not version_match or not runtime_match:
        raise SystemExit("Could not read installed version/runtime catalog from assets/app.js")

    version = version_match.group(1)
    try:
        runtime_paths = json.loads(runtime_match.group(1))
    except json.JSONDecodeError as error:
        raise SystemExit(f"Runtime catalog is not a literal JSON-compatible list: {error}") from error

    stable = json.loads(MANIFEST.read_text(encoding="utf-8"))["stable"]["version"]
    if version != stable:
        raise SystemExit(f"Source runtime version {version} does not match Stable manifest {stable}")
    if not runtime_paths or len(runtime_paths) != len(set(runtime_paths)):
        raise SystemExit("Runtime catalog is empty or contains duplicate paths")
    if "index.html" not in runtime_paths:
        raise SystemExit("Runtime catalog must include index.html")
    if set(VENDOR_BINARIES) - set(runtime_paths):
        raise SystemExit("Runtime catalog is missing required offline vendor libraries")
    for path in runtime_paths:
        normalized = path.replace("\\", "/")
        if normalized.startswith("/") or ".." in normalized.split("/") or normalized.startswith(FORBIDDEN_RUNTIME_PREFIXES):
            raise SystemExit(f"Unsafe runtime path: {path}")
    return version, runtime_paths


def source_bytes(path: str, vendor_dir: Path | None) -> bytes:
    source = ROOT / path
    if source.is_file():
        return source.read_bytes()
    if path in VENDOR_BINARIES and vendor_dir:
        generated = vendor_dir / VENDOR_BINARIES[path]
        if generated.is_file():
            return generated.read_bytes()
    raise SystemExit(f"Required distribution runtime is unavailable: {path}")


def validate_vendor(path: str, data: bytes) -> None:
    checks = {
        "vendor/jszip.min.js": (50_000, b"JSZip"),
        "vendor/pdf.min.js": (100_000, b"pdfjsLib"),
        "vendor/pdf.worker.min.js": (100_000, b"pdfjsWorker"),
        "vendor/xlsx.full.min.js": (250_000, b"XLSX"),
    }
    minimum, marker = checks[path]
    if len(data) < minimum or marker not in data:
        raise SystemExit(f"Generated vendor file failed validation: {path}")


def zip_write(archive: zipfile.ZipFile, name: str, data: bytes = b"", directory: bool = False) -> None:
    if directory and not name.endswith("/"):
        name += "/"
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = ((0o755 if directory else 0o644) & 0xFFFF) << 16
    archive.writestr(info, b"" if directory else data)


def build(output: Path, vendor_dir: Path) -> dict:
    version, runtime_paths = load_contract()
    package_root = "Service Operations Dashboard"
    entries: dict[str, bytes] = {
        f"{package_root}/00 - OPEN DASHBOARD.html": LAUNCHER.encode("utf-8"),
        f"{package_root}/README - START HERE.txt": START_HERE.encode("utf-8"),
        f"{package_root}/System Files/Workspace/README.txt": WORKSPACE_README.encode("utf-8"),
    }

    for runtime in runtime_paths:
        data = source_bytes(runtime, vendor_dir)
        if runtime in VENDOR_BINARIES:
            validate_vendor(runtime, data)
        entries[f"{package_root}/System Files/{runtime}"] = data

    inventory = [
        {"path": name[len(package_root) + 1 :], "size": len(data), "sha256": sha256(data)}
        for name, data in sorted(entries.items())
    ]
    install_manifest = {
        "format": "service-operations-dashboard-clean-install",
        "formatVersion": 1,
        "version": version,
        "packageRoot": package_root,
        "launcher": "00 - OPEN DASHBOARD.html",
        "applicationRoot": "System Files",
        "workspaceRoot": "System Files/Workspace",
        "updateChannel": "stable",
        "workspaceProtectedFromUpdates": True,
        "files": inventory,
    }
    manifest_bytes = (json.dumps(install_manifest, indent=2, sort_keys=True) + "\n").encode("utf-8")
    entries[f"{package_root}/INSTALLATION-MANIFEST.json"] = manifest_bytes

    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        zip_write(archive, package_root + "/", directory=True)
        for directory in WORKSPACE_DIRS:
            zip_write(archive, f"{package_root}/{directory}", directory=True)
        for name, data in sorted(entries.items()):
            zip_write(archive, name, data)

    with zipfile.ZipFile(output) as archive:
        names = archive.namelist()
        required = {
            f"{package_root}/00 - OPEN DASHBOARD.html",
            f"{package_root}/System Files/index.html",
            f"{package_root}/System Files/Workspace/data/",
            *{f"{package_root}/System Files/{path}" for path in runtime_paths},
        }
        missing = sorted(required - set(names))
        if missing:
            raise SystemExit("Built ZIP is incomplete: " + ", ".join(missing))
        if any("/Workspace/" in name and name.endswith((
            "settings.json", "current-state.json", "appointments.json", "advisor-performance.json",
            "assign-next.json", "operational-metrics.json", "meeting-cycle.json", "recovery.json"
        )) for name in names):
            raise SystemExit("Built ZIP contains initialized operational state; clean install must be unconfigured")

    digest = sha256(output.read_bytes())
    external_manifest = {
        "format": "service-operations-dashboard-release-asset",
        "formatVersion": 1,
        "version": version,
        "asset": output.name,
        "sha256": digest,
        "workspaceProtectedFromUpdates": True,
        "runtimeFileCount": len(runtime_paths),
        "runtime": [
            {"path": item["path"], "size": item["size"], "sha256": item["sha256"]}
            for item in inventory if item["path"].startswith("System Files/")
        ],
    }
    manifest_path = output.with_suffix(".manifest.json")
    manifest_path.write_text(json.dumps(external_manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    output.with_suffix(output.suffix + ".sha256").write_text(f"{digest}  {output.name}\n", encoding="utf-8")
    return external_manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-source", action="store_true")
    parser.add_argument("--vendor-dir", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "dist" / "Service-Operations-Dashboard.zip")
    args = parser.parse_args()

    version, runtime_paths = load_contract()
    if args.check_source:
        missing = [p for p in runtime_paths if not (ROOT / p).is_file() and p not in VENDOR_BINARIES]
        if missing:
            raise SystemExit("Tracked source is missing runtime files: " + ", ".join(missing))
        print(json.dumps({"status": "ok", "stableVersion": version, "runtimeFiles": len(runtime_paths),
                          "generatedVendorFiles": sorted(VENDOR_BINARIES)}, indent=2))
        return 0

    if not args.vendor_dir:
        parser.error("--vendor-dir is required when building the clean-install ZIP")
    result = build(args.output, args.vendor_dir)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
