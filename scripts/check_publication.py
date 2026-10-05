"""Fail publication when tracked files cross the public data boundary."""

from pathlib import Path
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
    return violations


if __name__ == "__main__":
    count = scan(Path(__file__).resolve().parents[1])
    if count:
        raise SystemExit(f"Publication check failed: {count} tracked file(s) cross the public data boundary.")
    print("Publication check passed.")
