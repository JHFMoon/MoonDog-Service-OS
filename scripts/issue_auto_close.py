#!/usr/bin/env python3
"""Fail-closed, repository-native auto-close for evidence-complete MoonDog issues.

Only trusted main executes this script. No PR/issue prose is evaluated as code.
Updating this protected script or workflow requires a separately reviewed merge.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/ROADMAP-ACCEPTANCE-MATRIX.md"
EVIDENCE = ROOT / "docs/ISSUE-CLOSEOUT-EVIDENCE.json"
MANIFEST = ROOT / "updates/manifest.json"
OWNER = "JHFMoon"
APP_ID = 15368
SAFE_REPO = "JHFMoon/MoonDog-Service-OS"
CLOSE_MARKER = "<!-- moondog-verified-auto-close:v1 issue="
# A field result is not inferred from synthetic CI or from a PR description.
FIELD_SCENARIOS = {
    164: ("EDGE-01", "EDGE-02", "EDGE-03", "EDGE-04", "EDGE-05", "EDGE-06", "EDGE-07", "EDGE-08"),
    58: ("EDGE-01", "EDGE-02", "EDGE-07"),
}
ISSUE_HEADER = re.compile(r"^## #([1-9]\d*)\b")
CRITERION = re.compile(r"^\|\s*([1-9]\d*-\d{2})\s*\|")


def parse_matrix(source: str) -> dict[int, dict[str, bool]]:
    issue = None
    seen: dict[int, dict[str, bool]] = {}
    for line in source.splitlines():
        title = ISSUE_HEADER.match(line)
        if title:
            issue = int(title.group(1))
            if issue in seen:
                raise ValueError("Duplicate matrix issue section")
            seen[issue] = {}
            continue
        criterion = CRITERION.match(line)
        if not criterion:
            continue
        key = criterion.group(1)
        number = int(key.split("-")[0])
        if number != issue or key in seen[issue]:
            raise ValueError("Unexpected or duplicate acceptance criterion: " + key)
        cells = line.strip().strip("|").split("|")
        if len(cells) < 4:
            raise ValueError("Malformed acceptance criterion row: " + key)
        # Status must occur in the last cell, never merely in evidence prose.
        last = cells[-1].strip()
        seen[issue][key] = bool(re.search(r"\*\*VERIFIED COMPLETE\*\*", last))
    return seen


def evidence_shape(issue: int, matrix: dict[int, dict[str, bool]], record: dict) -> list[str]:
    reasons: list[str] = []
    listed = matrix.get(issue) or {}
    proofs = record.get("criteria")
    if not listed:
        return ["Issue has no authoritative acceptance matrix criteria"]
    if not isinstance(proofs, dict) or set(proofs) != set(listed):
        return ["Evidence criterion IDs do not exactly match the authoritative acceptance matrix"]
    for key, verified in listed.items():
        if not verified:
            reasons.append(key + " has not reached VERIFIED COMPLETE")
        proof = proofs[key]
        if not isinstance(proof, dict):
            reasons.append(key + " has no structured proof")
            continue
        if not isinstance(proof.get("pr"), int) or proof["pr"] < 1:
            reasons.append(key + " missing merged source/test PR")
        paths = proof.get("tests")
        if not isinstance(paths, list) or not paths or any(
            not isinstance(p, str) or
            not p.startswith("tests/") or
            not (p.endswith(".test.cjs") or (p.startswith("tests/test_") and p.endswith(".py"))) or
            p.startswith("tests/../") for p in paths
        ):
            reasons.append(key + " missing a valid synthetic regression test path")
        if proof.get("kind") not in {"runtime", "test", "field"}:
            reasons.append(key + " has no recognized verification kind")
    return reasons


def eligible_snapshot(issue: int, state: str, matrix: dict[int, dict[str, bool]], record: dict,
                      manifest: dict) -> list[str]:
    if state != "open":
        return ["Issue is not open"]
    reasons = evidence_shape(issue, matrix, record)
    if manifest.get("stable", {}).get("version") != "0.10.17":
        reasons.append("Stable invariant differs from protected 0.10.17")
    beta = manifest.get("beta", {})
    if not re.fullmatch(r"0\.10\.18-beta\.[1-9]\d*", beta.get("version", "")):
        reasons.append("Published Beta version is not recognized")
    if not re.fullmatch(r"[a-f0-9]{64}", beta.get("sha256", "")):
        reasons.append("Published Beta manifest SHA-256 is malformed")
    if not isinstance(record.get("package_pr"), int) or record["package_pr"] < 1:
        reasons.append("Missing verified trusted Beta package PR")
    if issue in FIELD_SCENARIOS and not isinstance(record.get("field_comment"), int):
        reasons.append("Missing owner-verified Windows/Edge field report")
    return reasons


class GitHub:
    def __init__(self, token: str, repository: str):
        if repository != SAFE_REPO:
            raise ValueError("Refusing cross-repository issue mutations")
        if not token:
            raise ValueError("Missing GitHub Actions token")
        self.token, self.repo = token, repository

    def request(self, method: str, endpoint: str, data=None):
        if not endpoint.startswith("repos/" + self.repo + "/"):
            raise ValueError("Unexpected API endpoint")
        return self._send(method, "https://api.github.com/" + endpoint, data)

    def graphql(self, query: str, variables: dict):
        result = self._send("POST", "https://api.github.com/graphql", {
            "query": query, "variables": variables
        })
        if result.get("errors"):
            raise ValueError("GitHub review verification failed")
        return result["data"]

    def _send(self, method, url, data=None):
        body = json.dumps(data).encode() if data is not None else None
        req = Request(url, data=body, method=method, headers={
            "Authorization": "Bearer " + self.token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "MoonDog-Verified-Issue-Closeout",
        })
        with urlopen(req, timeout=35) as response:
            result = response.read()
        return json.loads(result) if result else {}

    def pages(self, endpoint: str):
        result = []
        for page in range(1, 11):
            value = self.request("GET", endpoint + ("&" if "?" in endpoint else "?") +
                                 "per_page=100&page=" + str(page))
            if not isinstance(value, list):
                raise ValueError("Expected GitHub collection")
            result.extend(value)
            if len(value) < 100:
                return result
        raise ValueError("GitHub collection pagination limit reached")


REVIEW_QUERY = """
query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      reviewThreads(first:100){pageInfo{hasNextPage} nodes{isResolved}}
    }
  }
}
"""


def verified_checks(api: GitHub, head: str) -> bool:
    data = api.request("GET", "repos/" + api.repo + "/commits/" + head + "/check-runs?per_page=100")
    checks = data.get("check_runs", [])
    if data.get("total_count", 0) > 100:
        return False
    required = ("Publication Check", "prove-clean-install")
    return all(any(c.get("name") == name and c.get("status") == "completed" and
                       c.get("conclusion") == "success" and
                       c.get("head_sha") == head and
                       c.get("app", {}).get("id") == APP_ID for c in checks)
               for name in required)


def validated_pr(api: GitHub, number: int, cache: dict):
    if number in cache:
        return cache[number]
    pr = api.request("GET", "repos/" + api.repo + "/pulls/" + str(number))
    if not (pr.get("merged") is True and pr.get("merged_at") and
            pr.get("base", {}).get("ref") == "main" and
            pr.get("head", {}).get("repo", {}).get("full_name") == api.repo and
            re.fullmatch(r"[a-f0-9]{40}", pr.get("head", {}).get("sha", ""))):
        raise ValueError("Linked PR is not a merged repository-main PR: #" + str(number))
    if not verified_checks(api, pr["head"]["sha"]):
        raise ValueError("Exact-head authorized CI and clean install missing on PR #" + str(number))
    owner, name = api.repo.split("/")
    reviews = api.graphql(REVIEW_QUERY, {"owner": owner, "name": name, "number": number})
    threads = reviews["repository"]["pullRequest"]["reviewThreads"]
    if threads["pageInfo"]["hasNextPage"] or any(not t["isResolved"] for t in threads["nodes"]):
        raise ValueError("Unresolved or unbounded PR review threads on #" + str(number))
    files = api.pages("repos/" + api.repo + "/pulls/" + str(number) + "/files")
    names = {f["filename"] for f in files}
    cache[number] = (pr, names)
    return pr, names


def source_in_beta(api: GitHub, source_commit: str, package_base_sha: str) -> bool:
    if source_commit == package_base_sha:
        return True
    data = api.request("GET", "repos/" + api.repo + "/compare/" +
                       source_commit + "..." + package_base_sha)
    return (data.get("merge_base_commit", {}).get("sha") == source_commit and
            data.get("status") in {"ahead", "identical"})


def owner_field_report(api: GitHub, issue: int, comment_id: int, beta: str) -> bool:
    comment = api.request("GET", "repos/" + api.repo + "/issues/comments/" + str(comment_id))
    if comment.get("user", {}).get("login") != OWNER:
        return False
    if not comment.get("html_url", "").startswith(
            "https://github.com/" + api.repo + "/issues/" + str(issue) + "#"):
        return False
    body = comment.get("body", "")
    if "MoonDog-Field-Verified: yes" not in body or beta not in body:
        return False
    return all(scenario in body for scenario in FIELD_SCENARIOS[issue])


def verify_live_evidence(api: GitHub, issue: int, record: dict, manifest: dict,
                         commit_sha: str) -> None:
    cache: dict = {}
    package_number = record["package_pr"]
    package_pr, package_paths = validated_pr(api, package_number, cache)
    beta = manifest["beta"]
    package_path = "updates/packages/moondog-" + beta["version"] + ".json"
    if not {"updates/manifest.json", package_path}.issubset(package_paths):
        raise ValueError("Trusted package PR does not advertise live Beta")
    # Package must be on main; it must not predate the source changes.
    if not source_in_beta(api, package_pr["merge_commit_sha"], commit_sha):
        raise ValueError("Published Beta package is not an ancestor of current main")
    for key, proof in record["criteria"].items():
        source_pr, paths = validated_pr(api, proof["pr"], cache)
        if not set(proof["tests"]).intersection(paths):
            raise ValueError(key + " regression test was not delivered in linked PR")
        if proof["kind"] == "runtime" and not any(
                p.startswith("assets/") or p == "index.html" for p in paths):
            raise ValueError(key + " has no production runtime diff")
        if proof["kind"] == "field" and issue not in FIELD_SCENARIOS:
            raise ValueError(key + " field validation lacks a protected field policy")
        if proof["kind"] == "runtime":
            if not source_in_beta(api, source_pr["merge_commit_sha"],
                                  package_pr["base"]["sha"]):
                raise ValueError(key + " runtime source is newer than the trusted published Beta")
        elif not source_in_beta(api, source_pr["merge_commit_sha"], commit_sha):
            raise ValueError(key + " test/field proof has not reached current main")
    if issue in FIELD_SCENARIOS and not owner_field_report(
            api, issue, record["field_comment"], beta["version"]):
        raise ValueError("Owner Windows/Edge evidence is absent or incomplete")


def close_if_ready(api: GitHub, issue: int, record: dict, matrix: dict,
                   manifest: dict, main_sha: str, dry_run: bool) -> dict:
    details = api.request("GET", "repos/" + api.repo + "/issues/" + str(issue))
    reasons = eligible_snapshot(issue, details.get("state"), matrix, record, manifest)
    if reasons:
        return {"issue": issue, "status": "open/not-eligible", "reasons": reasons}
    # A green source PR alone does not prove the current main checkout is safe.
    # Fail closed if the current main Publication Check is absent or failing.
    current_checks = api.request("GET", "repos/" + api.repo + "/commits/" +
                                 main_sha + "/check-runs?per_page=100")
    if current_checks.get("total_count", 0) > 100 or not any(
            c.get("name") == "Publication Check" and
            c.get("conclusion") == "success" and
            c.get("status") == "completed" and
            c.get("head_sha") == main_sha and
            c.get("app", {}).get("id") == APP_ID
            for c in current_checks.get("check_runs", [])):
        return {"issue": issue, "status": "open/current-main-ci-unverified"}
    verify_live_evidence(api, issue, record, manifest, main_sha)
    marker = CLOSE_MARKER + str(issue) + " -->"
    comments = api.pages("repos/" + api.repo + "/issues/" + str(issue) + "/comments")
    if dry_run:
        return {"issue": issue, "status": "eligible/dry-run", "main": main_sha}
    # Re-read before mutation; scheduled/merge-event jobs serialize globally.
    current = api.request("GET", "repos/" + api.repo + "/issues/" + str(issue))
    if current.get("state") != "open":
        return {"issue": issue, "status": "already-closed"}
    if not any(marker in c.get("body", "") for c in comments):
        proofs = record["criteria"]
        proof_lines = [
            "- " + key + ": merged PR #" + str(proof["pr"]) +
            "; regression " + ", ".join(proof["tests"])
            for key, proof in sorted(proofs.items())
        ]
        fields = ("\n- Owner field attestation comment #" + str(record["field_comment"])
                  if issue in FIELD_SCENARIOS else "")
        completion = (
            marker + "\nAll acceptance matrix criteria VERIFIED COMPLETE. "
            "Source PRs and package passed authorized exact-head Publication Check "
            "and Clean Install Proof from GitHub Actions app 15368; relevant "
            "review threads are resolved.\n\n"
            + "\n".join(proof_lines)
            + "\n- Trusted Beta package PR #" + str(record["package_pr"])
            + "\n- Published Beta: " + manifest["beta"]["version"]
            + "\n- Manifest package SHA-256: " + manifest["beta"]["sha256"]
            + "\n- Protected main at closeout: " + main_sha
            + fields
            + "\n- Evidence registry: docs/ISSUE-CLOSEOUT-EVIDENCE.json."
            + "\nStable 0.10.17 unchanged; publication does not assert an installed update."
        )
        api.request("POST", "repos/" + api.repo + "/issues/" + str(issue) +
                    "/comments", {"body": completion})
    api.request("PATCH", "repos/" + api.repo + "/issues/" + str(issue), {
        "state": "closed", "state_reason": "completed"
    })
    confirmed = api.request("GET", "repos/" + api.repo + "/issues/" + str(issue))
    if confirmed.get("state") != "closed":
        raise ValueError("GitHub did not confirm closure for issue #" + str(issue))
    return {"issue": issue, "status": "closed", "main": main_sha}


def main() -> int:
    token = os.environ.get("GH_TOKEN", "")
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    dry = os.environ.get("DRY_RUN", "false").lower() == "true"
    api = GitHub(token, repo)
    main_ref = api.request("GET", "repos/" + repo + "/branches/main")["commit"]["sha"]
    event_sha = os.environ.get("GITHUB_SHA", "")
    if event_sha and event_sha != main_ref:
        print("Stale event checkout; refusing closure until trusted main is current")
        return 0
    matrix = parse_matrix(MATRIX.read_text(encoding="utf-8"))
    proof = json.loads(EVIDENCE.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if proof.get("schemaVersion") != 1 or not isinstance(proof.get("issues"), dict):
        raise ValueError("Unsupported closure evidence schema")
    if not proof["issues"]:
        raise ValueError("No tracked issues; refusing silent empty completion")
    summary = []
    for key, record in proof["issues"].items():
        try:
            if not re.fullmatch(r"[1-9]\d*", key) or not isinstance(record, dict):
                raise ValueError("Malformed issue record")
            summary.append(close_if_ready(api, int(key), record, matrix, manifest, main_ref, dry))
        except (ValueError, KeyError, TypeError, HTTPError) as error:
            summary.append({"issue": key, "status": "open/verification-blocked",
                            "reason": type(error).__name__ + ": " + str(error)[:300]})
    print(json.dumps({"main": main_ref, "beta": manifest["beta"]["version"],
                      "dry_run": dry, "issues": summary}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
