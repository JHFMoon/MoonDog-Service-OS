"""Fail publication when tracked files cross the public data boundary."""

from pathlib import Path
import base64
import binascii
import hashlib
import json
import os
import re
import subprocess


BLOCKED_DIRS = {
    "data", "history", "backup", "backups", "reports", "exports",
    "logs", "temp", "tmp", "customers", "employees", "contacts",
    "repair-orders", "ro-data", "store-data", "operational-data",
}
BLOCKED_EXTENSIONS = {
    ".xlsx", ".xls", ".csv", ".pdf", ".zip", ".7z", ".rar",
    ".log", ".tmp", ".bak",
}
BLOCKED_LOCAL_STATE = {
    "current-state.json", "settings.json", "appointments.json",
    "advisor-performance.json", "operational-metrics.json",
    "assign-next.json", "auto-import.json", "meeting-cycle.json",
    "recovery.json",
}
PRIVATE_KEY_PATTERN = re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")
TOKEN_PATTERN = re.compile(rb"\b(?:gh[opusr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,})\b")


def blocked_path(path):
    parts = path.replace("\\", "/").lower().split("/")
    directories, name = parts[:-1], parts[-1]
    if any(
        part in BLOCKED_DIRS or "drop reports here" in part or "files to learn" in part
        for part in directories
    ):
        return True
    return (
        Path(name).suffix in BLOCKED_EXTENSIONS
        or name in BLOCKED_LOCAL_STATE
        or (name.endswith(".json") and (name.endswith("-state.json") or name.startswith("local-")))
        or name == ".env" or name.startswith(".env.")
        or name.endswith((".key", ".pem"))
        or name.startswith(("credentials", "secrets"))
    )


def blocked_content(content):
    return PRIVATE_KEY_PATTERN.search(content) is not None or TOKEN_PATTERN.search(content) is not None


def release_contract_errors(root):
    """Fail closed when a published Beta cannot return to the current Stable."""
    manifest_path = root / "updates" / "manifest.json"
    if not manifest_path.exists():
        return []
    try:
        manifest = json.loads(manifest_path.read_bytes())
        stable, beta = manifest["stable"], manifest["beta"]
        if beta["migrationRequired"] is not False:
            raise ValueError("Beta migrations must be reversible and are not published")
        packages = {}
        for channel, release in (("stable", stable), ("beta", beta)):
            version = release["version"]
            pattern = r"\d+\.\d+\.\d+" + (r"-beta\.\d+" if channel == "beta" else "")
            if not isinstance(version, str) or not re.fullmatch(pattern, version):
                raise ValueError(f"{channel} version is invalid")
            filename = f"moondog-{version}.json"
            relative = f"updates/packages/{filename}"
            expected_url = f"https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/{relative}"
            if release["packageUrl"] != expected_url:
                raise ValueError(f"{channel} package URL is missing or untrusted")
            raw = (root / relative).read_bytes()
            if hashlib.sha256(raw).hexdigest() != release["sha256"]:
                raise ValueError(f"{channel} package SHA-256 mismatch")
            package = json.loads(raw)
            if package["formatVersion"] != 1 or package["version"] != version:
                raise ValueError(f"{channel} package version mismatch")
            files = package["files"]
            paths = [entry["path"] for entry in files]
            if not paths or paths != package["approvedFiles"] or len(paths) != len(set(paths)):
                raise ValueError(f"{channel} approved file list mismatch")
            for entry in files:
                path = entry["path"]
                if (path.startswith("/") or "\\" in path or
                    any(part in ("", ".", "..") for part in path.split("/")) or
                    blocked_path(path) or not path.startswith("assets/") or
                    Path(path).suffix.lower() not in (".css", ".js", ".html", ".json")):
                    raise ValueError(f"{channel} contains protected or unknown path")
                if entry["action"] != "put":
                    raise ValueError(f"{channel} contains an unsupported deletion")
                content = base64.b64decode(entry["contentBase64"], validate=True)
                if hashlib.sha256(content).hexdigest() != entry["sha256"] or blocked_content(content):
                    raise ValueError(f"{channel} file hash or public boundary failed")
            packages[channel] = {entry["path"]: entry for entry in files}
        if not set(packages["beta"]).issubset(packages["stable"]):
            raise ValueError("Stable package does not restore every Beta-touched file")
        return []
    except (KeyError, TypeError, ValueError, OSError, UnicodeError, binascii.Error) as error:
        return [str(error)]


def scan(root):
    paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).split(b"\0")
    violations = 0
    for raw_path in filter(None, paths):
        path = os.fsdecode(raw_path)
        if blocked_path(path):
            violations += 1
            continue
        content = subprocess.check_output(["git", "show", ":" + path], cwd=root)
        if blocked_content(content):
            violations += 1
    violations += len(release_contract_errors(root))
    return violations


if __name__ == "__main__":
    count = scan(Path(__file__).resolve().parents[1])
    if count:
        raise SystemExit(f"Publication check failed: {count} tracked file(s) cross the public data boundary.")
    print("Publication check passed.")
