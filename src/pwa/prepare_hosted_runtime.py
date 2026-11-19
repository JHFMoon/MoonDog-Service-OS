"""Prepare a reviewable, public-only PWA runtime from ONE verified Stable ZIP.

SECURITY: This is prototype packaging SOURCE, not an authorized publisher or release
workflow. Do not call it from a protected workflow without independent review.
The existing file:// Stable package remains the authoritative build source.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

ROOT_NAME = "Service Operations Dashboard"
PREFIX = ROOT_NAME + "/"
INSTALL_MANIFEST = PREFIX + "INSTALLATION-MANIFEST.json"
BROWSER_PREFIX = "System Files/"
FORMAT = "service-operations-dashboard-clean-install"
MAX_ZIP = 256 * 1024 * 1024
MAX_TOTAL = 192 * 1024 * 1024
MAX_FILE = 64 * 1024 * 1024
MAX_ENTRIES = 350
VENDOR = frozenset({"vendor/jszip.min.js", "vendor/pdf.min.js", "vendor/pdf.worker.min.js", "vendor/xlsx.full.min.js"})

class Refused(Exception):
    pass


def fail(message: str) -> None:
    raise Refused(message)


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def safe_path(name: str, directory: bool = False) -> bool:
    if not name.startswith(PREFIX) or "\\" in name or "\x00" in name:
        return False
    rel = name[len(PREFIX):].rstrip("/") if directory else name[len(PREFIX):]
    if not rel:
        return directory
    segments = rel.split("/")
    return all(p not in ("", ".", "..") and not p.endswith((".", " "))
               and not re.search(r'[\x00-\x1f<>:"|?*\\]', p)
               and not re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)',p,re.I)
               for p in segments)


def required_public_path(path: str) -> bool:
    if not path.startswith(BROWSER_PREFIX):
        return False
    sub = path[len(BROWSER_PREFIX):]
    if sub == "index.html":
        return True
    if sub.startswith("Workspace/"):
        return False
    return (sub.startswith("assets/") or sub.startswith("vendor/")) and safe_path(PREFIX + path)


def load_metadata(metadata_file: Path) -> tuple[str, str]:
    try:
        data = json.loads(metadata_file.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        fail(f"Trusted release metadata unreadable: {exc}")
    version, checksum = data.get("version"), data.get("sha256")
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        fail("Not a formal verified Stable version.")
    if not isinstance(checksum, str) or not re.fullmatch(r"[a-f0-9]{64}", checksum):
        fail("Release checksum must be an exact SHA-256.")
    return version, checksum


def read_zip(archive_path: Path, release_metadata: Path) -> tuple[str, str, dict[str, bytes]]:
    version, expected_sha = load_metadata(release_metadata)
    if not archive_path.is_file() or archive_path.stat().st_size > MAX_ZIP:
        fail("ZIP missing or exceeds reviewed size limit.")
    if sha256(archive_path.read_bytes()) != expected_sha:
        fail("Downloaded or built Stable ZIP does not match the release checksum.")
    total = 0
    with zipfile.ZipFile(archive_path, "r") as z:
        members = z.infolist()
        if not members or len(members) > MAX_ENTRIES:
            fail("ZIP inventory is missing or exceeds reviewed limit.")
        seen = set()
        actual = {}
        dirs = set()
        for info in members:
            if info.filename in seen or not safe_path(info.filename, info.is_dir()):
                fail("ZIP contains duplicate or unsafe path.")
            seen.add(info.filename)
            mode = (info.external_attr >> 16) & 0o170000
            if mode == stat.S_IFLNK:
                fail("ZIP symlink refused.")
            if info.flag_bits & 1 or info.file_size > MAX_FILE:
                fail("Encrypted or oversized ZIP entry refused.")
            total += info.file_size
            if total > MAX_TOTAL:
                fail("Unpacked package exceeds reviewed limit.")
            if info.is_dir():
                dirs.add(info.filename)
            else:
                actual[info.filename] = z.read(info, pwd=None)
        if not dirs.issubset({PREFIX, *(PREFIX + p for p in (
            "System Files/Workspace/", "System Files/Workspace/data/",
            "System Files/Workspace/data/history/", "System Files/Workspace/backups/",
            "System Files/Workspace/imports/", "System Files/Workspace/exports/",
            "System Files/Workspace/support/", "System Files/Workspace/01 - DROP REPORTS HERE/"
        ))}):
            fail("Unapproved directory in verified Stable package.")
        if INSTALL_MANIFEST not in actual:
            fail("Canonical installation inventory missing.")
        try:
            manifest = json.loads(actual[INSTALL_MANIFEST].decode("utf-8"))
        except (ValueError, UnicodeError):
            fail("Canonical installation inventory unreadable.")
        if (manifest.get("format") != FORMAT or manifest.get("formatVersion") != 1 or
            manifest.get("version") != version or manifest.get("packageRoot") != ROOT_NAME or
            manifest.get("workspaceRoot") != "System Files/Workspace" or
            manifest.get("workspaceProtectedFromUpdates") is not True or
            manifest.get("launcher") != "00 - OPEN DASHBOARD.html" or
            manifest.get("applicationRoot") != "System Files" or
            manifest.get("updateChannel") != "stable"):
            fail("Package identity, version, or private Workspace boundary mismatch.")
        listed = manifest.get("files")
        if not isinstance(listed, list) or len(listed) > MAX_ENTRIES:
            fail("Invalid canonical file inventory.")
        approved = {}
        for item in listed:
            if not isinstance(item, dict):
                fail("Invalid listed file entry.")
            path, size, sha = item.get("path"), item.get("size"), item.get("sha256")
            if (not isinstance(path, str) or not safe_path(PREFIX + path) or
                path in approved or not isinstance(size, int) or isinstance(size, bool) or
                size < 0 or size > MAX_FILE or not isinstance(sha, str) or
                not re.fullmatch(r"[a-f0-9]{64}", sha)):
                fail("Invalid, duplicate or unbounded file manifest entry.")
            approved[path] = (size, sha)
        package_files = {path[len(PREFIX):]: data for path, data in actual.items() if path != INSTALL_MANIFEST}
        if package_files.keys() != approved.keys():
            fail("Unexpected, missing or unapproved ZIP application file.")
        for path, data in package_files.items():
            expected_size, expected_hash = approved[path]
            if len(data) != expected_size or sha256(data) != expected_hash:
                fail("App file bytes don't match the trusted Stable inventory.")
        if not {'System Files/index.html','00 - OPEN DASHBOARD.html'}.issubset(package_files):
            fail("Required launcher/real application missing.")
        if not {BROWSER_PREFIX + name for name in VENDOR}.issubset(package_files):
            fail("Offline browser libraries missing.")
        if not any(k.startswith('System Files/assets/') for k in package_files):
            fail("App assets missing.")
        for path, data in package_files.items():
            if path.startswith('System Files/Workspace/') and path != 'System Files/Workspace/README.txt':
                fail("Store-private files must never appear inside a clean install ZIP.")
        public_files = {path[len(BROWSER_PREFIX):]: content for path,content in package_files.items()
                        if required_public_path(path)}
        if len(public_files) < 12:
            fail("Insufficient verified runtime to host the dashboard.")
        return version, expected_sha, public_files


def publish_verified(archive: Path, metadata: Path, destination: Path) -> dict:
    version, package_sha, public_files = read_zip(archive, metadata)
    if destination.exists():
        fail("Cannot replace an existing published PWA directory.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Staging is separate, and never follows arbitrary filenames outside target.
    with tempfile.TemporaryDirectory(prefix="moondog-public-runtime-", dir=destination.parent) as temp:
        staging = Path(temp)
        for relative, contents in sorted(public_files.items()):
            target = staging.joinpath(*PurePosixPath(relative).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(contents)
            if sha256(target.read_bytes()) != sha256(contents):
                fail("Public runtime durable staging readback failed.")
        summary = {"format":"moondog-browser-public-runtime", "formatVersion":1,
                   "version":version,"trustedZipSha256":package_sha,
                   "workspaceHosted":False,"operationalReady":False,
                   "files":[{"path":p,"bytes":len(data),"sha256":sha256(data)} for p,data in sorted(public_files.items())]}
        (staging / "HOSTED-RUNTIME.json").write_text(json.dumps(summary,indent=2)+"\n",encoding="utf-8")
        # No web application is advertised here: a separate reviewed browser
        # Workspace bridge, backup/restore and offline cache remain mandatory.
        staging.rename(destination)
        return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Stage verified PUBLIC Stable files for later PWA integration")
    parser.add_argument("--zip", dest="archive",type=Path,required=True)
    parser.add_argument("--release-metadata", type=Path, required=True)
    parser.add_argument("--destination", type=Path,required=True)
    args = parser.parse_args()
    summary=publish_verified(args.archive,args.release_metadata,args.destination)
    print(f"Staged {len(summary['files'])} verified public runtime files, private Workspace absent. Not deployable alone.")

if __name__=="__main__":
    main()