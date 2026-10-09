#!/usr/bin/env python3
"""Trusted policy helpers for MoonDog unattended PR automation."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

PROTECTED_PREFIXES = (
    ".github/workflows/",
)
PROTECTED_FILES = {
    "scripts/audit_git_history.py",
    "scripts/build_beta_package.py",
    "scripts/build_distribution.py",
    "scripts/build_operating_modules.py",
    "scripts/check_publication.py",
    "scripts/pipeline_guard.py",
    "scripts/prepare_distribution_vendor.sh",
    "scripts/smoke_distribution.mjs",
    "tests/install.test.cjs",
    "tests/package-verification.test.cjs",
    "tests/runtime-mirror.test.cjs",
    "tests/test_check_publication.py",
    "tests/test_pipeline_guard.py",
    "tests/test_security_workflows.py",
    "tests/test_update_manifest.py",
}


def protected_automation_path(path: str) -> bool:
    normalized = str(path or "").replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized in PROTECTED_FILES or any(
        normalized.startswith(prefix) for prefix in PROTECTED_PREFIXES
    )


def blocked_paths(paths: list[str]) -> list[str]:
    return sorted({path for path in paths if protected_automation_path(path)})


def validate_pr_snapshot(
    pr: dict,
    *,
    repository: str,
    expected_head: str,
    expected_base_ref: str = "main",
) -> list[str]:
    body = pr.get("body") or ""
    checks = {
        "open": pr.get("state") == "open",
        "not-draft": pr.get("draft") is False,
        "base-main": pr.get("base", {}).get("ref") == expected_base_ref,
        "same-repository": pr.get("head", {}).get("repo", {}).get("full_name") == repository,
        "exact-head": pr.get("head", {}).get("sha") == expected_head,
        "automation-marker": "MoonDog-Auto-Merge: yes" in body,
        "authorized-association": pr.get("author_association")
        in {"OWNER", "MEMBER", "COLLABORATOR"},
    }
    return [name for name, ok in checks.items() if not ok]


def stable_manifest_changed(base: dict, head: dict) -> bool:
    return base.get("stable") != head.get("stable")



def validate_generated_merge(
    pr: dict,
    *,
    repository: str,
    expected_head: str,
    current_main: str,
    compare_status: str,
    base_manifest: dict,
    head_manifest: dict,
) -> list[str]:
    """Re-evaluate all merge invariants immediately before EVERY merge attempt."""
    failures = validate_pr_snapshot(pr, repository=repository, expected_head=expected_head)
    if pr.get("base", {}).get("sha") != current_main:
        failures.append("base-not-current-main")
    if compare_status != "ahead":
        failures.append("branch-not-ahead-of-main")
    if stable_manifest_changed(base_manifest, head_manifest):
        failures.append("stable-changed")
    return failures


def generated_proof_state(
    runs: list[dict], jobs_by_run: dict[str, list[dict]], expected_head: str
) -> tuple[str, list[str]]:
    """Only real, successful exact-head dispatch jobs count as trusted proof.

    GitHub's bot-created pull_request checks sometimes fail with zero jobs.
    Ignore ONLY that precise platform artifact; never ignore real failed jobs.
    """
    required = {"publication check", "clean install proof"}
    proven: set[str] = set()
    errors: list[str] = []
    pending = False
    for run in runs:
        name = str(run.get("name", "")).lower()
        if name not in required:
            continue
        rid = str(run.get("id", ""))
        jobs = jobs_by_run.get(rid, [])
        if run.get("head_sha") != expected_head:
            errors.append(f"{rid}: wrong head")
            continue
        bot_no_job = (
            run.get("event") == "pull_request"
            and (run.get("actor") or {}).get("login") == "github-actions[bot]"
            and not jobs
            and run.get("status") == "completed"
        )
        if bot_no_job:
            continue
        if run.get("status") != "completed":
            pending = True
            continue
        if run.get("conclusion") != "success":
            errors.append(f"{rid}: {name} {run.get('conclusion')}")
            continue
        if not jobs:
            errors.append(f"{rid}: successful run has no jobs")
            continue
        if any(j.get("conclusion") not in {"success", "skipped"} for j in jobs):
            errors.append(f"{rid}: job failed or incomplete")
            continue
        if not any(j.get("conclusion") == "success" for j in jobs):
            errors.append(f"{rid}: no successful job")
            continue
        if run.get("event") == "workflow_dispatch":
            proven.add(name)
    if errors:
        return "failed", errors
    if pending or proven != required:
        return "pending", sorted(required - proven)
    return "success", []



def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    paths = sub.add_parser("check-paths")
    paths.add_argument("file", type=Path)
    args = parser.parse_args()

    if args.command == "check-paths":
        candidates = [
            line.strip()
            for line in args.file.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        blocked = blocked_paths(candidates)
        if blocked:
            raise SystemExit(
                "Automatic merge refuses trusted automation/proof changes: "
                + ", ".join(blocked)
                + ". Use a reviewed bootstrap PR instead."
            )
        print(json.dumps({"status": "ok", "checked": len(candidates)}))
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
