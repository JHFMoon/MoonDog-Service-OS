"""Synthetic gate tests for protected GitHub automatic issue closeout."""
import unittest

from scripts.issue_auto_close import (
    APP_ID, CLOSE_MARKER, close_if_ready, eligible_snapshot, evidence_shape,
    parse_matrix, verified_checks,
)

SOURCE_HEAD = "a" * 40
PACKAGE_HEAD = "b" * 40
SOURCE_MERGE = "c" * 40
PACKAGE_BASE = "d" * 40
PACKAGE_MERGE = "e" * 40
MAIN = "f" * 40
ISSUE = 987
CRITERION = "987-01"
MANIFEST = {
    "stable": {"version": "0.10.17"},
    "beta": {"version": "0.10.18-beta.114", "sha256": "1" * 64},
}
RECORD = {"package_pr": 42, "criteria": {
    CRITERION: {"kind": "runtime", "pr": 41,
                "tests": ["tests/verified.test.cjs"]}
}}
MATRIX = {ISSUE: {CRITERION: True}}


def runs(sha, *, publication=True, clean=True):
    return {
        "total_count": 2,
        "check_runs": [
            {"name": "Publication Check", "status": "completed",
             "conclusion": "success" if publication else "failure",
             "head_sha": sha, "app": {"id": APP_ID}},
            {"name": "prove-clean-install", "status": "completed",
             "conclusion": "success" if clean else "failure",
             "head_sha": sha, "app": {"id": APP_ID}},
        ],
    }


class FakeAPI:
    repo = "JHFMoon/MoonDog-Service-OS"

    def __init__(self, *, verified=True, beta=True, blocked=False, duplicate=False, advance_main_at=0, issue=ISSUE):
        self.issue = issue
        self.verification = verified
        self.beta = beta
        self.blocked = blocked
        self.state = "open"
        self.actions = []
        self.advance_main_at = advance_main_at
        self.main_reads = 0
        self.comments = [{
            "body": CLOSE_MARKER + str(issue) + " -->"
        }] if duplicate else []

    def request(self, method, endpoint, data=None):
        self.actions.append((method, endpoint))
        if method == "PATCH":
            self.state = data["state"]
            return {"state": self.state}
        if method == "POST":
            self.comments.append({"body": data["body"]})
            return {"id": 9}
        if endpoint.endswith("/branches/main"):
            self.main_reads += 1
            changed = self.advance_main_at and self.main_reads >= self.advance_main_at
            return {"commit": {"sha": "0" * 40 if changed else MAIN}}
        if endpoint.endswith("/issues/" + str(self.issue)):
            return {"state": self.state}
        if endpoint.endswith("/pulls/41"):
            return {"merged": True, "merged_at": "2026-10-19T02:00:00Z",
                    "base": {"ref": "main"}, "merge_commit_sha": SOURCE_MERGE,
                    "head": {"sha": SOURCE_HEAD, "repo": {"full_name": self.repo}}}
        if endpoint.endswith("/pulls/42"):
            return {"merged": True, "merged_at": "2026-10-19T02:01:00Z",
                    "base": {"ref": "main", "sha": PACKAGE_BASE},
                    "merge_commit_sha": PACKAGE_MERGE,
                    "head": {"sha": PACKAGE_HEAD, "repo": {"full_name": self.repo}}}
        if "/check-runs" in endpoint:
            sha = endpoint.split("/commits/")[1].split("/")[0]
            return runs(sha, publication=self.verification)
        if "/compare/" in endpoint:
            if not self.beta:
                return {"status": "diverged", "merge_base_commit": {"sha": "0" * 40}}
            base = endpoint.split("/compare/")[1].split("...")[0]
            return {"status": "ahead", "merge_base_commit": {"sha": base}}
        raise AssertionError("Unexpected fake API: " + method + " " + endpoint)

    def pages(self, endpoint):
        if endpoint.endswith("/pulls/41/files"):
            return [{"filename": "assets/app.js"},
                    {"filename": "tests/verified.test.cjs"}]
        if endpoint.endswith("/pulls/42/files"):
            return [{"filename": "updates/manifest.json"},
                    {"filename": "updates/packages/moondog-0.10.18-beta.114.json"}]
        if endpoint.endswith("/issues/" + str(self.issue) + "/comments"):
            return self.comments
        raise AssertionError("Unexpected collection: " + endpoint)

    def graphql(self, query, variables):
        return {"repository": {"pullRequest": {"reviewThreads": {
            "pageInfo": {"hasNextPage": False},
            "nodes": [{"isResolved": not self.blocked}]
        }}}}


class AutoCloseTests(unittest.TestCase):
    def test_matrix_only_last_cell_can_establish_verified_complete(self):
        source = (
            "## #987 — Sample\n"
            "| ID | Requirement | Existing | Gap | Priority | Verification |\n"
            "| 987-01 | Work | **VERIFIED COMPLETE** mentioned in evidence | Missing | P0 | **PARTIALLY COMPLETE** |\n"
        )
        self.assertEqual(parse_matrix(source), {987: {"987-01": False}})
        self.assertEqual(parse_matrix(source.replace("**PARTIALLY COMPLETE**",
                                                    "**VERIFIED COMPLETE**")),
                         MATRIX)
        with self.assertRaises(ValueError):
            parse_matrix(source + source.splitlines()[-1] + "\n")

    def test_eligible_completed_issue_closes_once_and_confirms_github_state(self):
        fake = FakeAPI()
        result = close_if_ready(fake, ISSUE, RECORD, MATRIX, MANIFEST, MAIN, False)
        self.assertEqual(result["status"], "closed")
        self.assertEqual(fake.state, "closed")
        self.assertEqual(len([x for x in fake.actions if x[0] == "PATCH"]), 1)
        self.assertEqual(len(fake.comments), 1)
        self.assertIn(CLOSE_MARKER, fake.comments[0]["body"])
        self.assertIn("PR #41", fake.comments[0]["body"])
        self.assertIn("tests/verified.test.cjs", fake.comments[0]["body"])
        self.assertIn("package PR #42", fake.comments[0]["body"])
        self.assertIn(MANIFEST["beta"]["sha256"], fake.comments[0]["body"])
        retry = close_if_ready(fake, ISSUE, RECORD, MATRIX, MANIFEST, MAIN, False)
        self.assertEqual(retry["status"], "open/not-eligible")
        self.assertEqual(len(fake.comments), 1)

    def test_issue_164_can_close_without_user_browser_test_when_engineering_is_verified(self):
        matrix = {164: {"164-05": True}}
        record = {"package_pr": 42, "criteria": {"164-05": {
            "kind": "runtime", "pr": 41, "tests": ["tests/verified.test.cjs"]
        }}}
        self.assertEqual(eligible_snapshot(164, "open", matrix, record, MANIFEST), [])
        self.assertEqual(evidence_shape(164, matrix, record), [])
        self.assertNotIn("field_comment", record)
        fake = FakeAPI(issue=164)
        outcome = close_if_ready(fake, 164, record, matrix, MANIFEST, MAIN, False)
        self.assertEqual(outcome["status"], "closed")
        self.assertEqual(fake.state, "closed")
        self.assertEqual(len(fake.comments), 1)

    def test_personal_field_comment_cannot_replace_missing_engineering_proofs(self):
        matrix = {164: {"164-05": False}}
        record = {"package_pr": 42, "field_comment": 999, "criteria": {
            "164-05": {"kind": "runtime", "pr": 41,
                        "tests": ["tests/verified.test.cjs"]}
        }}
        reasons = eligible_snapshot(164, "open", matrix, record, MANIFEST)
        self.assertTrue(any("has not reached VERIFIED COMPLETE" in x for x in reasons))
        self.assertFalse(any("field report" in x for x in reasons))

    def test_field_only_proof_cannot_substitute_for_runtime_or_test_coverage(self):
        matrix = {164: {"164-05": True}}
        record = {"package_pr": 42, "criteria": {"164-05": {
            "kind": "field", "pr": 41, "tests": ["tests/verified.test.cjs"]
        }}}
        self.assertTrue(any("recognized verification kind" in x
                            for x in evidence_shape(164, matrix, record)))

    def test_incomplete_issue_stays_open_with_no_mutations(self):
        fake = FakeAPI()
        result = close_if_ready(fake, ISSUE, RECORD, {ISSUE: {CRITERION: False}},
                                MANIFEST, MAIN, False)
        self.assertEqual(result["status"], "open/not-eligible")
        self.assertTrue(any(CRITERION in x for x in result["reasons"]))
        self.assertFalse(any(a[0] in {"PATCH", "POST"} for a in fake.actions))

    def test_failed_ci_on_current_main_prevents_issue_closure(self):
        fake = FakeAPI(verified=False)
        result = close_if_ready(fake, ISSUE, RECORD, MATRIX, MANIFEST, MAIN, False)
        self.assertEqual(result["status"], "open/current-main-ci-unverified")
        self.assertEqual(fake.state, "open")

    def test_missing_or_older_beta_prevents_closure(self):
        missing = dict(RECORD, package_pr=None)
        fake = FakeAPI()
        result = close_if_ready(fake, ISSUE, missing, MATRIX, MANIFEST, MAIN, False)
        self.assertEqual(result["status"], "open/not-eligible")
        self.assertEqual(fake.state, "open")
        stale = FakeAPI(beta=False)
        with self.assertRaisesRegex(ValueError, "Published Beta package"):
            close_if_ready(stale, ISSUE, RECORD, MATRIX, MANIFEST, MAIN, False)

    def test_blocked_requirement_and_unresolved_review_prevent_closure(self):
        absent = {"package_pr": 42, "criteria": {}}
        self.assertTrue(evidence_shape(ISSUE, MATRIX, absent))
        fake = FakeAPI(blocked=True)
        with self.assertRaisesRegex(ValueError, "Unresolved"):
            close_if_ready(fake, ISSUE, RECORD, MATRIX, MANIFEST, MAIN, False)
        self.assertEqual(fake.state, "open")

    def test_duplicate_completion_comment_not_posted_again(self):
        fake = FakeAPI(duplicate=True)
        result = close_if_ready(fake, ISSUE, RECORD, MATRIX, MANIFEST, MAIN, False)
        self.assertEqual(result["status"], "closed")
        self.assertFalse(any(x[0] == "POST" for x in fake.actions))

    def test_main_advances_before_comment_leaves_issue_open(self):
        fake = FakeAPI(advance_main_at=1)
        outcome = close_if_ready(fake, ISSUE, RECORD, MATRIX, MANIFEST, MAIN, False)
        self.assertEqual(outcome["status"], "open/main-advanced-recheck-required")
        self.assertEqual(fake.state, "open")
        self.assertFalse(any(op[0] in {"POST", "PATCH"} for op in fake.actions))

    def test_main_advances_after_comment_never_changes_issue_state(self):
        fake = FakeAPI(advance_main_at=2)
        outcome = close_if_ready(fake, ISSUE, RECORD, MATRIX, MANIFEST, MAIN, False)
        self.assertEqual(outcome["status"], "open/main-advanced-recheck-required")
        self.assertEqual(fake.state, "open")
        self.assertEqual(len(fake.comments), 1)
        self.assertFalse(any(op[0] == "PATCH" for op in fake.actions))

    def test_dry_run_never_comments_or_changes_issue(self):
        fake = FakeAPI()
        result = close_if_ready(fake, ISSUE, RECORD, MATRIX, MANIFEST, MAIN, True)
        self.assertEqual(result["status"], "eligible/dry-run")
        self.assertFalse(any(x[0] in {"POST", "PATCH"} for x in fake.actions))

    def test_recent_failed_authorized_ci_overrides_older_success(self):
        class CheckAPI:
            repo = "JHFMoon/MoonDog-Service-OS"
            def request(self, method, endpoint):
                return {"total_count": 3, "check_runs": [
                    {"id": 1, "name": "Publication Check", "head_sha": SOURCE_HEAD,
                     "started_at": "2026-10-19T01:00:00Z",
                     "status": "completed", "conclusion": "success", "app": {"id": APP_ID}},
                    {"id": 2, "name": "Publication Check", "head_sha": SOURCE_HEAD,
                     "started_at": "2026-10-19T02:00:00Z",
                     "status": "completed", "conclusion": "failure", "app": {"id": APP_ID}},
                    {"id": 3, "name": "prove-clean-install", "head_sha": SOURCE_HEAD,
                     "started_at": "2026-10-19T02:00:00Z",
                     "status": "completed", "conclusion": "success", "app": {"id": APP_ID}}
                ]}
        self.assertFalse(verified_checks(CheckAPI(), SOURCE_HEAD))

    def test_future_beta_versions_remain_supported_without_stable_promotion(self):
        future = {**MANIFEST, "beta": {
            "version": "0.10.19-beta.1", "sha256": "1" * 64
        }}
        self.assertEqual(eligible_snapshot(ISSUE, "open", MATRIX, RECORD, future), [])

    def test_evidence_cannot_omit_a_criterion(self):
        data = {ISSUE: {"987-01": True, "987-02": True}}
        reasons = evidence_shape(ISSUE, data, RECORD)
        self.assertTrue(any("do not exactly match" in x for x in reasons))

    def test_invalid_stable_version_blocks_even_fully_completed_issue(self):
        changed = {**MANIFEST, "stable": {"version": "0.10.18"}}
        reasons = eligible_snapshot(ISSUE, "open", MATRIX, RECORD, changed)
        self.assertTrue(any("Stable invariant" in r for r in reasons))


if __name__ == "__main__":
    unittest.main()
