import unittest

from scripts.guarded_merge_policy import (
    codex_review_state,
    merge_review_state,
    owner_review_state,
    has_merge_authorization,
    has_standing_authorization,
)

POLICY = {
    "schema_version": 1,
    "standing_authorization": "authorized",
    "scope": "all_existing_and_future_pull_requests",
    "stable_publication": "existing-stable-release-workflow-only",
    "owner_review_attestation": "enabled",
    "owner_review_login": "JHFMoon",
}
HEAD = "a" * 40


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
        for policy in [{}, {**POLICY, "schema_version": 2}, {**POLICY, "scope": "one_pr"}]:
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
        self.assertEqual(codex_review_state([summary(findings=True)], HEAD), "clean")
        self.assertEqual(codex_review_state([summary(findings=True, unresolved=True)], HEAD), "findings")
        self.assertEqual(codex_review_state([summary(findings=True, unresolved=None)], HEAD), "findings")
        self.assertEqual(codex_review_state([summary(unresolved=True)], HEAD), "findings")

    def test_resolved_historical_findings_do_not_block_verified_exact_head(self):
        old = summary(findings=True, unresolved=True)
        final = summary(findings=True, unresolved=False)
        self.assertEqual(codex_review_state([old, final], HEAD), "clean")
        self.assertEqual(merge_review_state([old, final], [], HEAD, POLICY), "clean")
        self.assertEqual(merge_review_state([final, old], [], HEAD, POLICY), "findings")

    def test_unverified_or_missing_resolution_remains_blocking(self):
        uncertain = summary(findings=True, unresolved=None)
        self.assertEqual(codex_review_state([uncertain], HEAD), "findings")
        self.assertEqual(codex_review_state([summary(unresolved=None)], HEAD), "pending")

    def test_newer_stale_summary_supersedes_an_older_clean_review(self):
        self.assertEqual(codex_review_state([summary(), summary("old")], HEAD), "pending")

    def test_non_codex_comment_cannot_forge_review_state(self):
        forged = {**summary(), "user": {"login": "JHFMoon"}}
        self.assertEqual(codex_review_state([forged], HEAD), "pending")


def owner_review(sha=HEAD, user="JHFMoon", state="COMMENTED", body=None):
    if body is None:
        body = f"Reviewed the full PR diff. No blocking findings.\nMoonDog-Owner-Review: approved\nReviewed-Commit: {sha}"
    return {"user": {"login": user}, "commit_id": sha, "state": state, "body": body}


class OwnerReviewFallbackTests(unittest.TestCase):
    def test_exact_owner_review_accepted_without_codex_quota(self):
        self.assertEqual(owner_review_state([owner_review()], HEAD, "JHFMoon"), "clean")
        self.assertEqual(merge_review_state([], [owner_review()], HEAD, POLICY), "clean")

    def test_wrong_identity_or_wrong_head_fails_closed(self):
        self.assertEqual(merge_review_state([], [owner_review(user="other")], HEAD, POLICY), "pending")
        self.assertEqual(merge_review_state([], [owner_review(sha="b" * 40)], HEAD, POLICY), "pending")
        self.assertEqual(merge_review_state([], [owner_review()], "b" * 40, POLICY), "pending")

    def test_marker_and_commit_must_be_standalone_in_review_body(self):
        marker_only = f"MoonDog-Owner-Review: approved\nReviewed-Commit: {'b' * 40}"
        self.assertEqual(merge_review_state([], [owner_review(body=marker_only)], HEAD, POLICY), "pending")
        quoted = f"quote MoonDog-Owner-Review: approved\nReviewed-Commit: {HEAD}"
        self.assertEqual(merge_review_state([], [owner_review(body=quoted)], HEAD, POLICY), "pending")
        self.assertEqual(merge_review_state([], [{"body": owner_review()["body"]}], HEAD, POLICY), "pending")

    def test_issue_comment_and_other_account_cannot_impersonate_review(self):
        forged_comment = {"user": {"login": "JHFMoon"}, "body": owner_review()["body"]}
        self.assertEqual(merge_review_state([forged_comment], [], HEAD, POLICY), "pending")
        self.assertEqual(merge_review_state([], [owner_review(user="chatgpt-codex-connector[bot]")], HEAD, POLICY), "pending")

    def test_owner_request_changes_vetoes_prior_attestation(self):
        reviews = [owner_review(), owner_review(state="CHANGES_REQUESTED", body="Fix persistence bug")]
        self.assertEqual(merge_review_state([], reviews, HEAD, POLICY), "findings")
        self.assertEqual(merge_review_state([summary()], reviews, HEAD, POLICY), "findings")

    def test_newer_invalid_attestation_supersedes_clean_one(self):
        newer = owner_review(body=f"MoonDog-Owner-Review: approved\nReviewed-Commit: {'b' * 40}")
        self.assertEqual(merge_review_state([], [owner_review(), newer], HEAD, POLICY), "pending")

    def test_codex_findings_cannot_be_suppressed_by_owner_attestation(self):
        self.assertEqual(merge_review_state([summary(findings=True, unresolved=True)], [owner_review()], HEAD, POLICY), "findings")
        self.assertEqual(merge_review_state([summary(findings=True, unresolved=True), summary("b" * 40)], [owner_review()], HEAD, POLICY), "findings")
        self.assertEqual(merge_review_state([summary(findings=True, unresolved=False)], [owner_review()], HEAD, POLICY), "clean")

    def test_stale_or_incomplete_summary_never_clears_exact_head_finding(self):
        active = summary(findings=True, unresolved=True)
        stale = summary("b" * 40, findings=False, unresolved=False)
        pending = summary(status="running", findings=False, unresolved=False)
        unverified = summary(findings=False, unresolved=None)
        for newer in (stale, pending, unverified):
            self.assertEqual(merge_review_state([active, newer], [owner_review()], HEAD, POLICY), "findings")
        # Once Codex independently verifies all findings resolved at the
        # requested SHA, the older findings must no longer veto the release.
        resolved = summary(findings=True, unresolved=False)
        self.assertEqual(merge_review_state([active, stale, resolved], [], HEAD, POLICY), "clean")

    def test_disabled_or_untrusted_policy_does_not_enable_owner_attestation(self):
        self.assertEqual(merge_review_state([], [owner_review()], HEAD, {}), "pending")
        self.assertEqual(merge_review_state([], [owner_review()], HEAD, {**POLICY, "owner_review_login": "other"}), "pending")
        self.assertEqual(merge_review_state([], [owner_review()], HEAD, {**POLICY, "owner_review_attestation": "disabled"}), "pending")
        self.assertEqual(merge_review_state([summary()], [owner_review()], HEAD, {}), "clean")


if __name__ == "__main__":
    unittest.main()
