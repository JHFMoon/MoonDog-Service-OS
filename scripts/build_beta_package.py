#!/usr/bin/env python3
"""Build the next opt-in Beta package while preserving the current Beta preview."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import subprocess
import tempfile
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


def package_entries(package: dict) -> dict[str, bytes]:
    approved = package.get("approvedFiles")
    files = package.get("files")
    if not isinstance(approved, list) or not isinstance(files, list):
        raise SystemExit("Current Beta package is malformed")
    if approved != [item.get("path") for item in files]:
        raise SystemExit("Current Beta approved file order is malformed")
    output = {}
    for item in files:
        path = item.get("path")
        if item.get("action") != "put" or not isinstance(path, str):
            raise SystemExit("Current Beta package contains an unsupported action")
        try:
            content = base64.b64decode(item.get("contentBase64", ""), validate=True)
        except Exception as error:
            raise SystemExit(f"Current Beta package contains invalid base64 for {path}") from error
        if item.get("sha256") != digest(content):
            raise SystemExit(f"Current Beta package hash mismatch for {path}")
        output[path] = content
    return output


def merge_text(current: bytes, base: bytes, candidate: bytes, path: str) -> bytes:
    """Three-way merge one reviewed source delta onto the current Beta file."""
    try:
        current.decode("utf-8")
        base.decode("utf-8")
        candidate.decode("utf-8")
    except UnicodeDecodeError as error:
        raise SystemExit(f"Automatic Beta merge supports UTF-8 runtime files only: {path}") from error
    with tempfile.TemporaryDirectory(prefix="moondog-beta-merge-") as folder:
        root = Path(folder)
        current_path = root / "current"
        base_path = root / "base"
        candidate_path = root / "candidate"
        current_path.write_bytes(current)
        base_path.write_bytes(base)
        candidate_path.write_bytes(candidate)
        result = subprocess.run(
            ["git", "merge-file", "-p", str(current_path), str(base_path), str(candidate_path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if result.returncode != 0:
            detail = result.stderr.decode("utf-8", "replace").strip()
            raise SystemExit(
                f"Beta three-way merge conflict for {path}. "
                f"Preserve the current Beta manually before publishing. {detail}"
            )
        return result.stdout


def changed_runtime_paths(base_root: Path, candidate_root: Path, paths: list[str]) -> list[str]:
    changed = []
    for path in paths:
        candidate = candidate_root / path
        base = base_root / path
        if not candidate.is_file():
            raise SystemExit(f"Candidate runtime file is missing: {path}")
        if not base.is_file() or candidate.read_bytes() != base.read_bytes():
            changed.append(path)
    return changed


def update_app_identity(content: bytes, stable_version: str, old_beta: str, new_beta: str, build_date: str) -> bytes:
    text = content.decode("utf-8")
    match = VERSION_RE.search(text)
    if not match or match.group(1) not in {stable_version, old_beta}:
        raise SystemExit("Merged Beta app.js has an unexpected VERSION identity")
    text = VERSION_RE.sub(f'const VERSION = "{new_beta}";', text, count=1)
    if not BUILD_RE.search(text):
        raise SystemExit("Merged Beta app.js has no BUILD_DATE")
    text = BUILD_RE.sub(f'const BUILD_DATE = "{build_date}";', text, count=1)
    return text.encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--base-root", type=Path, required=True)
    parser.add_argument("--base-manifest", type=Path, required=True)
    parser.add_argument("--release-notes", default="")
    args = parser.parse_args()

    root = args.root.resolve()
    base_root = args.base_root.resolve()
    manifest_path = root / "updates" / "manifest.json"
    manifest = load_json(manifest_path)
    base_manifest = load_json(args.base_manifest.resolve())

    if manifest.get("stable") != base_manifest.get("stable"):
        raise SystemExit("Stable manifest changed; Beta preparation refuses Stable promotion")
    stable = manifest["stable"]
    beta = manifest["beta"]
    if beta.get("migrationRequired") is not False:
        raise SystemExit("Automatic Beta preparation refuses migrations")

    current_package_path = root / "updates" / "packages" / f"moondog-{beta['version']}.json"
    if not current_package_path.is_file():
        raise SystemExit(f"Current Beta package is missing: {current_package_path.name}")
    current_package_bytes = current_package_path.read_bytes()
    if digest(current_package_bytes) != beta.get("sha256"):
        raise SystemExit("Current Beta package does not match its manifest digest")
    current_package = json.loads(current_package_bytes)
    if current_package.get("version") != beta["version"]:
        raise SystemExit("Current Beta package version does not match the manifest")
    current_files = package_entries(current_package)

    app_text = (root / "assets" / "app.js").read_text(encoding="utf-8")
    paths = beta_runtime_paths(app_text)
    removed = [path for path in current_package["approvedFiles"] if path not in paths]
    if removed:
        raise SystemExit(
            "Automatic Beta preparation refuses runtime deletions: " + ", ".join(removed)
        )

    changed = changed_runtime_paths(base_root, root, paths)
    added = [path for path in paths if path not in current_files]
    if not changed and not added:
        print(json.dumps({
            "changed": False,
            "betaVersion": beta["version"],
            "reason": "No reviewed runtime delta",
        }))
        return 0

    version = next_beta(beta["version"])
    build_date = git_value(root, "%cs")
    files = []
    for path in paths:
        candidate_path = root / path
        base_path = base_root / path
        if path in current_files and path not in changed:
            content = current_files[path]
        elif path in current_files and base_path.is_file():
            content = merge_text(
                current_files[path],
                base_path.read_bytes(),
                candidate_path.read_bytes(),
                path,
            )
        else:
            content = candidate_path.read_bytes()

        if path == "assets/app.js":
            content = update_app_identity(
                content,
                stable["version"],
                beta["version"],
                version,
                build_date,
            )

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
            f"- Automatically layered onto the previous Beta so existing preview features are preserved.\n\n"
        )
        if marker in text and f"## {version} " not in text:
            text = text.replace(marker, marker + block, 1)
            changelog.write_text(text, encoding="utf-8")

    print(json.dumps({
        "changed": True,
        "betaVersion": version,
        "changedRuntime": changed,
        "addedRuntime": added,
        "package": package_path.relative_to(root).as_posix(),
        "sha256": beta["sha256"],
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
