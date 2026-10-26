"""Select an identical open trusted Beta PR for safe package-workflow retries."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

try:
    from .guarded_merge_authorization import has_explicit_approval
except ImportError:
    from guarded_merge_authorization import has_explicit_approval

PACKAGE_MARKER = "MoonDog-Automation-Package: yes"
BRANCH_PREFIX = "beta/post-merge-"
BETA_FIELDS = ("version", "packageUrl", "sha256", "minimumCompatibleVersion", "migrationRequired")


def eligible_package_pr(pr: dict, repository: str) -> bool:
    if not isinstance(pr, dict) or pr.get("state") != "open" or pr.get("draft") is not False:
        return False
    head = pr.get("head") or {}
    base = pr.get("base") or {}
    author = pr.get("user") or {}
    head_repo = head.get("repo") or {}
    body = pr.get("body") or ""
    lines = {line.strip() for line in body.splitlines()} if isinstance(body, str) else set()
    return (
        base.get("ref") == "main"
        and head_repo.get("full_name") == repository
        and isinstance(head.get("ref"), str)
        and head["ref"].startswith(BRANCH_PREFIX)
        and author.get("login") == "github-actions[bot]"
        and PACKAGE_MARKER in lines
        and has_explicit_approval(body)
    )


def package_metadata_matches(expected: dict, candidate: dict, package_bytes: bytes) -> bool:
    if not isinstance(expected, dict) or not isinstance(candidate, dict):
        return False
    if expected.get("stable") != candidate.get("stable"):
        return False
    expected_beta = expected.get("beta")
    candidate_beta = candidate.get("beta")
    if not isinstance(expected_beta, dict) or not isinstance(candidate_beta, dict):
        return False
    if any(expected_beta.get(key) != candidate_beta.get(key) for key in BETA_FIELDS):
        return False
    if hashlib.sha256(package_bytes).hexdigest() != candidate_beta.get("sha256"):
        return False
    try:
        package = json.loads(package_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return False
    return package.get("version") == candidate_beta.get("version")


def select_matching_pr(pulls: list, candidate_manifests: dict, candidate_packages: dict,
                       expected_manifest: dict, repository: str):
    matches = []
    eligible = []
    for pr in pulls if isinstance(pulls, list) else []:
        if not eligible_package_pr(pr, repository):
            continue
        number = str(pr.get("number"))
        eligible.append(number)
        manifest = candidate_manifests.get(number)
        package_bytes = candidate_packages.get(number)
        if isinstance(manifest, dict) and isinstance(package_bytes, bytes):
            if package_metadata_matches(expected_manifest, manifest, package_bytes):
                matches.append(pr)
    if len(matches) > 1:
        raise ValueError("Multiple open trusted Beta PRs match the same candidate; refusing ambiguous reuse.")
    if not matches and eligible:
        raise ValueError("An open trusted Beta PR exists but does not match the current candidate; refusing a duplicate package PR.")
    return matches[0] if matches else None


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    candidates = sub.add_parser("candidates")
    candidates.add_argument("--pulls-file", type=Path, required=True)
    candidates.add_argument("--repository", required=True)
    select = sub.add_parser("select")
    select.add_argument("--pulls-file", type=Path, required=True)
    select.add_argument("--expected-manifest", type=Path, required=True)
    select.add_argument("--candidate-dir", type=Path, required=True)
    select.add_argument("--repository", required=True)
    args = parser.parse_args()
    try:
        pulls = json.loads(args.pulls_file.read_text(encoding="utf-8"))
        if not isinstance(pulls, list):
            raise ValueError("Open PR response is not a list.")
        if args.command == "candidates":
            for pr in pulls:
                if eligible_package_pr(pr, args.repository):
                    print(f"{pr['number']}\t{pr['head']['sha']}")
            return 0
        expected = json.loads(args.expected_manifest.read_text(encoding="utf-8"))
        manifests = {}
        packages = {}
        for pr in pulls:
            if not eligible_package_pr(pr, args.repository):
                continue
            number = str(pr["number"])
            manifest_path = args.candidate_dir / f"{number}.manifest.json"
            package_path = args.candidate_dir / f"{number}.package.json"
            if manifest_path.exists() and package_path.exists():
                manifests[number] = json.loads(manifest_path.read_text(encoding="utf-8"))
                packages[number] = package_path.read_bytes()
        selected = select_matching_pr(pulls, manifests, packages, expected, args.repository)
        print(json.dumps(selected or {}))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
