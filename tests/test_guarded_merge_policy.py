import unittest

from scripts.guarded_merge_policy import (
    codex_review_state,
    has_merge_authorization,
    has_standing_authorization,
)

POLICY = {
    "schema_version": 1,
    "standing_authorization": "authorized",
    "scope": "all_existing_and_future_pull_requests",
    "stable_publication": "existing-stable-release-workflow-only",
}
HEAD = "abc123"


def summary(sha=HEAD, status="completed", findings=False, unresolved=False):
    payload = {
        "code_review": {
            "commit_sha": sha,
            "status": status,
            "has_any_findings": findings,
            "has_unresolved_findings": unresolved,
        }
    }
    import json
    return {
        "user": {"login": "chatgpt-codex-connector[bot]"},
        "body": "<!-- codex-review-state:v1 " + json.dumps(payload) + " -->",
    }


class StandingAuthorizationTests(unittest.TestCase):
    def test_repository_policy_authorizes_all_pr_categories(self):
        self.assertTrue(has_standing_authorization(POLICY))
        self.assertTrue(has_merge_authorization("MoonDog-Auto-Merge: no", POLICY))

    def test_malformed_or_untrusted_policy_fails_closed_to_explicit_marker(self):
        for policy in [{}, {"schema_version": 2, **POLICY}, {**POLICY, "scope": "one_pr"}]:
            self.assertFalse(has_standing_authorization(policy))
            self.assertFalse(has_merge_authorization("", policy))
        self.assertTrue(has_merge_authorization("MoonDog-Auto-Merge: yes", {}))
        self.assertFalse(has_merge_authorization("MoonDog-Auto-Merge: no", {}))

    def test_exact_completed_no_findings_review_is_required(self):
        self.assertEqual(codex_review_state([summary()], HEAD), "clean")

    def test_missing_stale_or_pending_review_does_not_pass(self):
        self.assertEqual(codex_review_state([], HEAD), "pending")
        self.assertEqual(codex_review_state([summary("old")], HEAD), "pending")
        self.assertEqual(codex_review_state([summary(status="running")], HEAD), "pending")
        self.assertEqual(codex_review_state([summary(findings=True)], HEAD), "findings")
        self.assertEqual(codex_review_state([summary(unresolved=True)], HEAD), "findings")

    def test_newer_stale_summary_supersedes_an_older_clean_review(self):
        self.assertEqual(codex_review_state([summary(), summary("old")], HEAD), "pending")

    def test_non_codex_comment_cannot_forge_review_state(self):
        forged = {**summary(), "user": {"login": "JHFMoon"}}
        self.assertEqual(codex_review_state([forged], HEAD), "pending")


if __name__ == "__main__":
    unittest.main()
