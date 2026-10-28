#!/usr/bin/env python3
"""Trusted repository-wide authorization and exact Codex review gates."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

try:
    from .guarded_merge_authorization import has_explicit_approval
except ImportError:
    from guarded_merge_authorization import has_explicit_approval

REVIEW_MARKER = "<!-- codex-review-state:v1 "


def load_policy(path: str | Path) -> dict:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def has_standing_authorization(policy: dict) -> bool:
    return (
        isinstance(policy, dict)
        and policy.get("schema_version") == 1
        and policy.get("standing_authorization") == "authorized"
        and policy.get("scope") == "all_existing_and_future_pull_requests"
        and policy.get("stable_publication") == "existing-stable-release-workflow-only"
    )


def has_merge_authorization(body: str | None, policy: dict) -> bool:
    return has_standing_authorization(policy) or has_explicit_approval(body)


HUMAN_PR_ASSOCIATIONS = {"OWNER", "MEMBER", "COLLABORATOR"}
BETA_PACKAGE_MARKER = "MoonDog-Automation-Package: yes"


def has_accepted_pr_author(pr: dict, repository: str) -> bool:
    """Accept normal collaborators, or the exact same-repo trusted Beta package bot.

    The bot exception requires its immutable GitHub login, the observed bot
    association, a same-repository head, and a standalone package marker.
    """
    if not isinstance(pr, dict):
        return False
    if pr.get("author_association") in HUMAN_PR_ASSOCIATIONS:
        return True
    user = pr.get("user")
    head = pr.get("head")
    head_repo = head.get("repo") if isinstance(head, dict) else None
    body = pr.get("body")
    return (
        isinstance(user, dict)
        and user.get("login") == "github-actions[bot]"
        and pr.get("author_association") == "CONTRIBUTOR"
        and isinstance(head_repo, dict)
        and head_repo.get("full_name") == repository
        and isinstance(body, str)
        and any(line.strip() == BETA_PACKAGE_MARKER for line in body.splitlines())
    )


def codex_review_state(comments: list, expected_head: str) -> str:
    """Return clean, pending, or findings for the newest Codex code review summary."""
    latest = None
    for comment in reversed(comments if isinstance(comments, list) else []):
        if not isinstance(comment, dict):
            continue
        user = comment.get("user", {})
        if not isinstance(user, dict) or user.get("login") != "chatgpt-codex-connector[bot]":
            continue
        body = comment.get("body", "")
        if REVIEW_MARKER not in body:
            continue
        match = re.search(r"<!-- codex-review-state:v1 (\{.*?\}) -->", body, re.DOTALL)
        if not match:
            continue
        try:
            summary = json.loads(match.group(1))
        except ValueError:
            return "pending"
        latest = summary.get("code_review")
        break
    if not isinstance(latest, dict) or latest.get("commit_sha") != expected_head:
        return "pending"
    if latest.get("status") != "completed":
        return "pending"
    # 'has_any_findings' is a cumulative review-history indicator. Once all
    # findings have been addressed, it can remain true indefinitely even when
    # Codex independently re-reviews the exact head and reports no unresolved
    # findings. Blocking that completed review causes a permanent false veto.
    unresolved = latest.get("has_unresolved_findings")
    any_findings = latest.get("has_any_findings")
    if unresolved is True:
        return "findings"
    if unresolved is False and any_findings in (True, False):
        return "clean"
    if any_findings is True:
        return "findings"
    return "pending"


OWNER_MARKER = "MoonDog-Owner-Review: approved"
OWNER_SHA_PREFIX = "Reviewed-Commit: "


def owner_review_state(reviews: list, expected_head: str, owner_login: str) -> str:
    """Trust only a GitHub PR review by the configured owner at this exact commit.

    COMMENTED reviews allow transparent owner self-attestation where GitHub
    cannot accept the PR author's APPROVE review. Issue comments never count.
    """
    if not re.fullmatch(r"[0-9a-f]{40}", expected_head) or not owner_login:
        return "pending"
    for review in reversed(reviews if isinstance(reviews, list) else []):
        if not isinstance(review, dict):
            continue
        user = review.get("user", {})
        if not isinstance(user, dict) or user.get("login") != owner_login:
            continue
        if review.get("commit_id") != expected_head:
            continue
        state = review.get("state")
        if state in {"CHANGES_REQUESTED", "REQUEST_CHANGES"}:
            return "findings"
        body = review.get("body") or ""
        if not isinstance(body, str):
            continue
        lines = {line.strip() for line in body.splitlines()}
        if state in {"COMMENTED", "APPROVED"} and OWNER_MARKER in lines and (
            OWNER_SHA_PREFIX + expected_head
        ) in lines:
            return "clean"
        if OWNER_MARKER in lines:
            # A newer malformed or dismissed attestation invalidates an older one.
            return "pending"
    return "pending"


def merge_review_state(comments: list, reviews: list, expected_head: str, policy: dict) -> str:
    """Active Codex findings veto an owner fallback; require exact-head proof."""
    codex = codex_review_state(comments, expected_head)
    # Only the newest authenticated exact-head summary can resolve previous
    # findings. A stale summary still returns pending, never clean. Requiring
    # every historical summary to be finding-free made resolution impossible.
    if codex == "findings":
        return "findings"
    # A stale, missing or incomplete newer summary does not clear an earlier
    # verified unresolved finding for the exact commit. Only a newer
    # authenticated completed exact-head summary explicitly reporting no
    # unresolved findings can supersede a historical finding.
    if codex == "pending" and any(
        codex_review_state([comment], expected_head) == "findings"
        for comment in comments if isinstance(comment, dict)
    ):
        return "findings"
    owner = "pending"
    if (
        has_standing_authorization(policy)
        and policy.get("owner_review_attestation") == "enabled"
        and policy.get("owner_review_login") == "JHFMoon"
    ):
        owner = owner_review_state(reviews, expected_head, policy["owner_review_login"])
    if owner == "findings":
        return "findings"
    return "clean" if codex == "clean" or owner == "clean" else "pending"


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    author = sub.add_parser("check-pr-author")
    author.add_argument("pr_json", type=Path)
    author.add_argument("--repository", required=True)
    auth = sub.add_parser("check-authorization")
    auth.add_argument("pr_json", type=Path)
    auth.add_argument("--policy", type=Path, required=True)
    review = sub.add_parser("codex-review-state")
    review.add_argument("comments_json", type=Path)
    review.add_argument("head_sha")
    combined = sub.add_parser("merge-review-state")
    combined.add_argument("comments_json", type=Path)
    combined.add_argument("reviews_json", type=Path)
    combined.add_argument("head_sha")
    combined.add_argument("--policy", type=Path, required=True)
    args = parser.parse_args()
    if args.command in {"check-pr-author", "check-authorization"}:
        try:
            pr = json.loads(args.pr_json.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            print("Cannot verify pull request authorization", file=sys.stderr)
            return 2
        if args.command == "check-pr-author":
            if not has_accepted_pr_author(pr, args.repository):
                print("Pull request author is not authorized for the guarded automation path")
                return 1
            return 0
        policy = load_policy(args.policy)
        if not has_merge_authorization(pr.get("body"), policy):
            print("No repository standing or explicit automatic-merge authorization")
            return 1
        return 0
    try:
        comments = json.loads(args.comments_json.read_text(encoding="utf-8"))
        if args.command == "merge-review-state":
            reviews = json.loads(args.reviews_json.read_text(encoding="utf-8"))
        else:
            reviews = []
    except (OSError, ValueError):
        print("pending")
        return 0
    state = (
        merge_review_state(comments, reviews, args.head_sha, load_policy(args.policy))
        if args.command == "merge-review-state"
        else codex_review_state(comments, args.head_sha)
    )
    print(state)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
