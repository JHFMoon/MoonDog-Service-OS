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
    if latest.get("has_any_findings") is True or latest.get("has_unresolved_findings") is True:
        return "findings"
    if latest.get("has_any_findings") is False and latest.get("has_unresolved_findings") is False:
        return "clean"
    return "pending"


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    auth = sub.add_parser("check-authorization")
    auth.add_argument("pr_json", type=Path)
    auth.add_argument("--policy", type=Path, required=True)
    review = sub.add_parser("codex-review-state")
    review.add_argument("comments_json", type=Path)
    review.add_argument("head_sha")
    args = parser.parse_args()
    if args.command == "check-authorization":
        try:
            pr = json.loads(args.pr_json.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            print("Cannot verify pull request authorization", file=sys.stderr)
            return 2
        policy = load_policy(args.policy)
        if not has_merge_authorization(pr.get("body"), policy):
            print("No repository standing or explicit automatic-merge authorization")
            return 1
        return 0
    try:
        comments = json.loads(args.comments_json.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        print("pending")
        return 0
    state = codex_review_state(comments, args.head_sha)
    print(state)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
