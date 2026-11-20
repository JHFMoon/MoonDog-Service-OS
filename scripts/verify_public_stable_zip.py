#!/usr/bin/env python3
"""Verify that a public Stable ZIP contains only its immutable software inventory.

This verifier reads release assets but never opens a real dealership Workspace.
"""
import argparse
import hashlib
import json
import re
import stat
import zipfile
from pathlib import Path

MAX_BYTES = 64 * 1024 * 1024
PACKAGE_ROOT = "Service Operations Dashboard"
WORKSPACE = "System Files/Workspace/"
SHA = re.compile(r"[0-9a-f]{64}\Z")
VERSION = re.compile(r"\d+\.\d+\.\d+\Z")


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def verify(zip_path, release_manifest_path, sha_path, version):
    zip_path = Path(zip_path)
    require(bool(VERSION.fullmatch(version)), "Invalid Stable version")
    require(0 < zip_path.stat().st_size <= MAX_BYTES, "ZIP missing or exceeds public limit")
    external = json.loads(Path(release_manifest_path).read_text(encoding="utf-8"))
    require(external.get("format") == "service-operations-dashboard-release-asset" and
            external.get("version") == version and
            external.get("asset") == "Service-Operations-Dashboard.zip" and
            external.get("workspaceProtectedFromUpdates") is True,
            "Stable release manifest is not the approved clean-install contract")
    expected = external.get("sha256")
    require(isinstance(expected, str) and SHA.fullmatch(expected), "Invalid release digest")
    checksum = Path(sha_path).read_text(encoding="utf-8").strip()
    require(checksum == expected + "  Service-Operations-Dashboard.zip", "Checksum sidecar mismatch")
    require(digest(zip_path.read_bytes()) == expected, "Stable ZIP hash mismatch")

    root = PACKAGE_ROOT + "/"
    manifest_file = root + "INSTALLATION-MANIFEST.json"
    with zipfile.ZipFile(zip_path) as archive:
        info = archive.infolist()
        names = [item.filename for item in info]
        require(len(names) == len(set(names)) and
                len(names) == len(set(name.casefold() for name in names)),
                "Duplicate ZIP entry or case collision")
        require(manifest_file in names, "Clean-install manifest missing")
        total = 0
        for item in info:
            name = item.filename
            pieces = name.rstrip("/").split("/")
            require(name.startswith(root) and (len(pieces) >= 2 or (item.is_dir() and name == root)) and
                    all(part not in ("", ".", "..") for part in pieces) and
                    "\\" not in name and not name.startswith("/") and
                    not (stat.S_IFMT(item.external_attr >> 16) == stat.S_IFLNK) and
                    not (item.flag_bits & 1), "Unsafe ZIP member")
            require(item.file_size <= MAX_BYTES, "Oversized ZIP member")
            total += item.file_size
            require(total <= MAX_BYTES, "Excessive expanded ZIP size")
        installed = json.loads(archive.read(manifest_file))
        require(installed.get("format") == "service-operations-dashboard-clean-install" and
                installed.get("formatVersion") == 1 and
                installed.get("version") == version and
                installed.get("packageRoot") == PACKAGE_ROOT and
                installed.get("applicationRoot") == "System Files" and
                installed.get("workspaceRoot") == WORKSPACE.rstrip("/") and
                installed.get("workspaceProtectedFromUpdates") is True,
                "Unrecognized clean-install inventory")
        manifest_files = installed.get("files")
        require(isinstance(manifest_files, list) and manifest_files, "Missing file inventory")
        catalog = {}
        for row in manifest_files:
            require(isinstance(row, dict), "Invalid file record")
            path, size, sha = row.get("path"), row.get("size"), row.get("sha256")
            require(isinstance(path, str) and path and not path.endswith("/") and
                    isinstance(size, int) and 0 <= size <= MAX_BYTES and
                    isinstance(sha, str) and SHA.fullmatch(sha) and
                    path not in catalog, "Invalid or repeated inventory entry")
            require(not path.startswith(WORKSPACE) or path == WORKSPACE + "README.txt",
                    "Release contains initialized/private Workspace content")
            catalog[path] = (size, sha)
        actual = {item.filename[len(root):] for item in info
                  if not item.is_dir() and item.filename != manifest_file}
        require(actual == set(catalog), "Unlisted or missing public software file")
        require("System Files/index.html" in catalog and
                "00 - OPEN DASHBOARD.html" in catalog and
                WORKSPACE + "README.txt" in catalog,
                "Missing required clean-install entry")
        for path, (size, sha) in catalog.items():
            payload = archive.read(root + path)
            require(len(payload) == size and digest(payload) == sha,
                    "Installed-file inventory does not match verified ZIP")
        runtime = external.get("runtime")
        require(isinstance(runtime, list), "Release runtime inventory missing")
        expected_runtime = {
            path: {"path": path, "size": size, "sha256": sha}
            for path, (size, sha) in catalog.items() if path.startswith("System Files/")
        }
        require(len(runtime) == len(expected_runtime) and
                all(isinstance(row, dict) and row == expected_runtime.get(row.get("path"))
                    for row in runtime),
                "External and embedded runtime inventories disagree")
    return expected


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", required=True, dest="zip_file")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    print("Verified immutable public Stable ZIP:", verify(
        args.zip_file, args.manifest, args.sha256, args.version))


if __name__ == "__main__":
    main()
