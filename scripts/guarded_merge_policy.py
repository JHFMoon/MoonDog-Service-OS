#!/usr/bin/env python3
"""Trusted authorization, optional review evidence, and authenticated findings gates."""
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

try:
    from .issue_auto_close import parse_matrix
except ImportError:
    from issue_auto_close import parse_matrix

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

# GitHub interprets issue-closing keywords in PR descriptions and commit messages
# without understanding negation ("Do not ..."). The parent issue must not be
# accidentally closed by an incremental criterion PR.
AUTO_CLOSE_REFERENCE = re.compile(
    r"\b(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)"
    r"[ \t]*(?::[ \t]*|\([ \t]*)?"
    r"(?:JHFMoon/MoonDog-Service-OS)?#([1-9]\d*)(?:-\d{1,3})?\b",
    re.IGNORECASE,
)


def unintended_issue_closures(pr: dict, commits: list, matrix: dict[int, dict[str, bool]]) -> list[tuple[str, int]]:
    """Identify auto-close references to unfinished matrix issues, never using PR text as code."""
    if not isinstance(pr, dict) or not isinstance(commits, list) or not isinstance(matrix, dict) or not matrix:
        raise ValueError("Closure guard input is not structured")
    unfinished = {number for number, criteria in matrix.items()
                  if not criteria or not all(criteria.values())}
    surfaces = [("PR title", pr.get("title") or ""), ("PR body", pr.get("body") or "")]
    for index, commit in enumerate(commits, start=1):
        if not isinstance(commit, dict) or not isinstance(commit.get("message"), str):
            raise ValueError("Commit message metadata is incomplete")
        surfaces.append((f"PR commit {index}", commit["message"]))
    findings = []
    for label, source in surfaces:
        if not isinstance(source, str):
            raise ValueError("PR text metadata is malformed")
        for match in AUTO_CLOSE_REFERENCE.finditer(source):
            issue = int(match.group(1))
            if issue in unfinished:
                findings.append((label, issue))
    return findings


def has_accepted_pr_author(
    pr: dict, repository: str, package_bot_login: str | None = None
) -> bool:
    """Accept collaborators or a configured, same-repository release App.

    The legacy Actions bot remains accepted only for already-existing package
    PRs. New package candidates use the exact App login configured by the repo
    owner; arbitrary bots, forks, and unmarked PRs remain rejected.
    """
    if not isinstance(pr, dict):
        return False
    if pr.get("author_association") in HUMAN_PR_ASSOCIATIONS:
        return True
    user = pr.get("user")
    head = pr.get("head")
    head_repo = head.get("repo") if isinstance(head, dict) else None
    body = pr.get("body")
    allowed_bots = {"github-actions[bot]"}
    if isinstance(package_bot_login, str) and package_bot_login.strip():
        allowed_bots.add(package_bot_login.strip())
    return (
        isinstance(user, dict)
        and user.get("login") in allowed_bots
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


def owner_resolves_findings(comments: list, reviews: list, expected_head: str, policy: dict) -> bool:
    """Require explicit, newer exact-head owner evidence for every legacy finding.

    An ordinary approval is insufficient. Privacy, CI and protected-change gates
    remain independent; this only permits a recorded finding to be investigated
    without requiring the original review provider to be available.
    """
    from datetime import datetime

    if owner_review_state(reviews, expected_head, policy.get("owner_review_login", "")) != "clean":
        return False
    findings = [comment for comment in comments
                if codex_review_state([comment], expected_head) == "findings"]
    if not findings:
        return False
    for review in reversed(reviews):
        if owner_review_state([review], expected_head, policy.get("owner_review_login", "")) != "clean":
            continue
        # Only the newest attestation counts; an older resolution cannot survive
        # a later approval that omits the resolution evidence.
        lines = (review.get("body") or "").splitlines()
        markers = [line for line in lines if line.startswith("Resolved-Review-Comments: ")]
        if len(markers) != 1:
            return False
        value = markers[0].removeprefix("Resolved-Review-Comments: ")
        if not re.fullmatch(r"[1-9][0-9]*(?:,[1-9][0-9]*)*", value):
            return False
        resolved = {int(item) for item in value.split(",")}
        try:
            reviewed_at = datetime.fromisoformat(review["submitted_at"].replace("Z", "+00:00"))
            for comment in findings:
                if type(comment.get("id")) is not int or comment["id"] not in resolved:
                    return False
                found_at = datetime.fromisoformat(comment["created_at"].replace("Z", "+00:00"))
                if reviewed_at <= found_at:
                    return False
        except (KeyError, ValueError, TypeError, AttributeError):
            return False
        return True
    return False


def merge_review_state(comments: list, reviews: list, expected_head: str, policy: dict) -> str:
    """Optional reviews never gate routine scoped-proof work; findings still veto.

    Historical provider summaries remain readable for audit compatibility. A
    missing provider, stale summary or absent AI review supplies no positive
    evidence, and is not a failure for an automatically eligible change.
    """
    comments = comments if isinstance(comments, list) else []
    reviews = reviews if isinstance(reviews, list) else []
    legacy = codex_review_state(comments, expected_head)
    enabled = (has_standing_authorization(policy)
               and policy.get("owner_review_attestation") == "enabled"
               and policy.get("owner_review_login") == "JHFMoon")
    owner = owner_review_state(reviews, expected_head, policy["owner_review_login"]) if enabled else "pending"
    if owner == "findings":
        return "findings"
    unresolved = legacy == "findings" or (legacy == "pending" and any(
        codex_review_state([comment], expected_head) == "findings"
        for comment in comments if isinstance(comment, dict)))
    if unresolved and not (enabled and owner_resolves_findings(comments, reviews, expected_head, policy)):
        return "findings"
    return "clean" if legacy == "clean" or owner == "clean" else "pending"


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    author = sub.add_parser("check-pr-author")
    author.add_argument("pr_json", type=Path)
    author.add_argument("--repository", required=True)
    author.add_argument("--package-bot-login", default="")
    auth = sub.add_parser("check-authorization")
    auth.add_argument("pr_json", type=Path)
    auth.add_argument("--policy", type=Path, required=True)
    closures = sub.add_parser("check-unintended-closures")
    closures.add_argument("pr_json", type=Path)
    closures.add_argument("commits_json", type=Path)
    closures.add_argument("--matrix", type=Path, required=True)
    review = sub.add_parser("codex-review-state")
    review.add_argument("comments_json", type=Path)
    review.add_argument("head_sha")
    combined = sub.add_parser("merge-review-state")
    combined.add_argument("comments_json", type=Path)
    combined.add_argument("reviews_json", type=Path)
    combined.add_argument("head_sha")
    combined.add_argument("--policy", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "check-unintended-closures":
        try:
            pr = json.loads(args.pr_json.read_text(encoding="utf-8"))
            commits = json.loads(args.commits_json.read_text(encoding="utf-8"))
            matrix = parse_matrix(args.matrix.read_text(encoding="utf-8"))
            violations = unintended_issue_closures(pr, commits, matrix)
        except (OSError, ValueError, TypeError, AttributeError) as error:
            print("Cannot verify accidental issue-closure safety: " + type(error).__name__, file=sys.stderr)
            return 2
        if violations:
            # Report issue numbers and metadata origins, never user-supplied content.
            details = ", ".join(f"{label} references unfinished issue #{number}"
                                for label, number in violations)
            print("Guarded merge blocked: " + details, file=sys.stderr)
            return 1
        return 0
    if args.command in {"check-pr-author", "check-authorization"}:
        try:
            pr = json.loads(args.pr_json.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            print("Cannot verify pull request authorization", file=sys.stderr)
            return 2
        if args.command == "check-pr-author":
            if not has_accepted_pr_author(pr, args.repository, args.package_bot_login):
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
