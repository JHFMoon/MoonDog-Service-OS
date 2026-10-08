#!/usr/bin/env python3
"""Build the next opt-in Beta package from reviewed source without touching Stable."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import subprocess
from pathlib import Path

VERSION_RE = re.compile(r'const VERSION = "([^"]+)";')
BUILD_RE = re.compile(r'const BUILD_DATE = "(20\d{2}-\d{2}-\d{2})";')
RUNTIME_RE = re.compile(r"const HANDOFF_RUNTIME_PATHS=(\[[^;]+\]);", re.S)
BETA_RE = re.compile(r"^(\d+\.\d+\.\d+)-beta\.(\d+)$")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def beta_runtime_paths(app_text: str) -> list[str]:
    match = RUNTIME_RE.search(app_text)
    if not match:
        raise SystemExit("Could not read HANDOFF_RUNTIME_PATHS from assets/app.js")
    paths = json.loads(match.group(1))
    selected = [path for path in paths if path == "index.html" or path.startswith("assets/")]
    if not selected or len(selected) != len(set(selected)):
        raise SystemExit("Beta runtime path catalog is empty or duplicated")
    for path in selected:
        if path.startswith("/") or ".." in path.split("/") or not (
            path == "index.html" or path.startswith("assets/")
        ):
            raise SystemExit(f"Unsafe Beta runtime path: {path}")
    return selected


def beta_bytes(root: Path, path: str, stable_version: str, beta_version: str, build_date: str) -> bytes:
    source = (root / path).read_bytes()
    if path != "assets/app.js":
        return source
    text = source.decode("utf-8")
    current = VERSION_RE.search(text)
    if not current or current.group(1) != stable_version:
        raise SystemExit("Reviewed app.js must keep the installed source VERSION on Stable until promotion")
    text = VERSION_RE.sub(f'const VERSION = "{beta_version}";', text, count=1)
    if not BUILD_RE.search(text):
        raise SystemExit("Reviewed app.js has no BUILD_DATE")
    text = BUILD_RE.sub(f'const BUILD_DATE = "{build_date}";', text, count=1)
    return text.encode("utf-8")


def current_package_matches(root: Path, manifest: dict, paths: list[str], build_date: str) -> bool:
    beta = manifest["beta"]
    stable = manifest["stable"]
    package_path = root / "updates" / "packages" / f"moondog-{beta['version']}.json"
    if not package_path.is_file():
        return False
    try:
        package = load_json(package_path)
    except (OSError, ValueError):
        return False
    if package.get("version") != beta["version"] or package.get("approvedFiles") != paths:
        return False
    entries = {item.get("path"): item for item in package.get("files", [])}
    if set(entries) != set(paths):
        return False
    app_entry = entries.get("assets/app.js", {})
    try:
        packaged_app = base64.b64decode(app_entry.get("contentBase64", ""), validate=True).decode("utf-8")
    except Exception:
        return False
    packaged_build = BUILD_RE.search(packaged_app)
    compare_build = packaged_build.group(1) if packaged_build else build_date
    for path in paths:
        item = entries.get(path, {})
        try:
            actual = base64.b64decode(item.get("contentBase64", ""), validate=True)
        except Exception:
            return False
        expected = beta_bytes(root, path, stable["version"], beta["version"], compare_build)
        if actual != expected or item.get("sha256") != digest(actual) or item.get("action") != "put":
            return False
    return True


def next_beta(version: str) -> str:
    match = BETA_RE.fullmatch(version)
    if not match:
        raise SystemExit(f"Current Beta version is invalid: {version}")
    return f"{match.group(1)}-beta.{int(match.group(2)) + 1}"


def git_value(root: Path, fmt: str) -> str:
    return subprocess.check_output(
        ["git", "-C", str(root), "show", "-s", f"--format={fmt}", "HEAD"],
        text=True,
    ).strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--base-manifest", type=Path, required=True)
    parser.add_argument("--release-notes", default="")
    args = parser.parse_args()
    root = args.root.resolve()

    manifest_path = root / "updates" / "manifest.json"
    manifest = load_json(manifest_path)
    base_manifest = load_json(args.base_manifest.resolve())
    if manifest.get("stable") != base_manifest.get("stable"):
        raise SystemExit("Stable manifest changed; Beta preparation refuses Stable promotion")

    stable = manifest["stable"]
    beta = manifest["beta"]
    if beta.get("migrationRequired") is not False:
        raise SystemExit("Automatic Beta preparation refuses migrations")

    app_text = (root / "assets" / "app.js").read_text(encoding="utf-8")
    paths = beta_runtime_paths(app_text)
    build_date = git_value(root, "%cs")
    if current_package_matches(root, manifest, paths, build_date):
        print(json.dumps({"changed": False, "betaVersion": beta["version"]}))
        return 0

    version = next_beta(beta["version"])
    files = []
    for path in paths:
        content = beta_bytes(root, path, stable["version"], version, build_date)
        files.append({
            "path": path,
            "action": "put",
            "sha256": digest(content),
            "contentBase64": base64.b64encode(content).decode("ascii"),
        })
    package = {
        "formatVersion": 1,
        "version": version,
        "approvedFiles": paths,
        "files": files,
    }
    package_bytes = (json.dumps(package, indent=2) + "\n").encode("utf-8")
    package_path = root / "updates" / "packages" / f"moondog-{version}.json"
    package_path.write_bytes(package_bytes)

    subject = git_value(root, "%s")
    notes = args.release_notes.strip() or (
        f"{subject}. Verified automated Beta from reviewed source. "
        f"No Workspace migration; Stable remains {stable['version']}."
    )
    beta["version"] = version
    beta["packageUrl"] = (
        f"https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/"
        f"updates/packages/{package_path.name}"
    )
    beta["sha256"] = digest(package_bytes)
    beta["releaseNotes"] = notes
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    readme = root / "README.md"
    if readme.is_file():
        text = readme.read_text(encoding="utf-8")
        text = re.sub(
            r"^- \*\*Beta:\*\* `[^`]+`.*$",
            f"- **Beta:** `{version}` (automated verified preview; Stable remains {stable['version']})",
            text,
            count=1,
            flags=re.M,
        )
        readme.write_text(text, encoding="utf-8")

    changelog = root / "CHANGELOG.md"
    if changelog.is_file():
        text = changelog.read_text(encoding="utf-8")
        marker = "# Changelog\n"
        block = (
            f"\n## {version} — current Beta\n\n"
            f"- {notes}\n"
            f"- Automatically packaged from the reviewed runtime after required verification.\n\n"
        )
        if marker in text and f"## {version} " not in text:
            text = text.replace(marker, marker + block, 1)
            changelog.write_text(text, encoding="utf-8")

    print(json.dumps({
        "changed": True,
        "betaVersion": version,
        "package": package_path.relative_to(root).as_posix(),
        "sha256": beta["sha256"],
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
