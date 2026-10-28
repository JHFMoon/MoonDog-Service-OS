"""Select one authorized source PR to own the next trusted Beta version."""
from __future__ import annotations

from scripts.guarded_merge_policy import has_accepted_pr_author, has_merge_authorization
from scripts.pipeline_guard import blocked_paths


def _eligible(pr: dict, repository: str, package_bot_login: str | None, policy: dict) -> bool:
    if not isinstance(pr, dict) or pr.get("state") != "open" or pr.get("draft") is not False:
        return False
    if pr.get("base", {}).get("ref") != "main":
        return False
    head = pr.get("head", {})
    if not isinstance(head, dict) or head.get("repo", {}).get("full_name") != repository:
        return False
    if not has_merge_authorization(pr.get("body"), policy):
        return False
    return has_accepted_pr_author(pr, repository, package_bot_login)


def has_runtime_change(paths: list[str]) -> bool:
    return any(
        path == "index.html" or path.startswith("assets/")
        for path in paths
        if isinstance(path, str)
    )


def select_next_runtime_pr(
    pull_requests: list[dict],
    file_paths_by_pr: dict[int, list[str]],
    *,
    repository: str,
    package_bot_login: str | None,
    policy: dict,
) -> dict | None:
    """Return the oldest authorized, unprotected runtime-changing PR.

    Its package commit reserves the next Beta version until that source PR
    merges. Other runtime PRs wait; a trusted main-push job advances the next
    eligible branch afterward so its package is rebuilt from the new main.
    """
    eligible = []
    for pr in pull_requests if isinstance(pull_requests, list) else []:
        if not _eligible(pr, repository, package_bot_login, policy):
            continue
        number = pr.get("number")
        if not isinstance(number, int):
            continue
        paths = file_paths_by_pr.get(number, [])
        if blocked_paths(paths) or not has_runtime_change(paths):
            continue
        eligible.append(pr)
    if not eligible:
        return None
    return min(
        eligible,
        key=lambda pr: (str(pr.get("created_at") or ""), int(pr["number"])),
    )
