"""Regression tests for the trusted, App-authenticated Beta release path."""
from pathlib import Path
import unittest

from scripts.guarded_merge_policy import has_accepted_pr_author

ROOT = Path(__file__).resolve().parents[1]
MERGE = ROOT / ".github/workflows/guarded-pr-merge.yml"
PACKAGE = ROOT / ".github/workflows/prepare-beta-package.yml"
REPO = "JHFMoon/MoonDog-Service-OS"


class BetaPipelineTests(unittest.TestCase):
    def test_runtime_candidate_is_built_inside_the_reviewed_source_pr(self):
        text = PACKAGE.read_text(encoding="utf-8")
        self.assertIn("pull_request_target:", text)
        self.assertIn("types: [opened, reopened, synchronize, ready_for_review]", text)
        self.assertIn("Check out trusted packaging logic from the reviewed base", text)
        self.assertIn("Check out candidate as untrusted data", text)
        self.assertIn("untrusted data", text)
        self.assertIn("scripts/build_beta_package.py", text)
        self.assertIn("Push package commit to the same reviewed PR", text)
        self.assertIn("actions/create-github-app-token@67018539274d69449ef7c02e8e71183d1719ab42", text)
        self.assertIn('secrets.MOONDOG_RELEASE_APP_ID', text)
        self.assertIn('secrets.MOONDOG_RELEASE_APP_PRIVATE_KEY', text)
        self.assertIn('git -C candidate -c http.https://github.com/.extraheader=', text)
        self.assertIn("push origin \"HEAD:$HEAD_BRANCH\"", text)
        self.assertNotIn("workflow_dispatch:", text)
        self.assertNotIn("gh workflow run", text)
        self.assertNotIn("statuses:", text)
        self.assertNotIn("api -X POST \"repos/$REPO/statuses/", text)
        self.assertNotIn("for attempt in {1..", text)

    def test_only_exact_configured_same_repo_package_app_is_accepted(self):
        base = {
            "user": {"login": "moondog-release[bot]"},
            "author_association": "CONTRIBUTOR",
            "head": {"repo": {"full_name": REPO}},
            "body": "MoonDog-Automation-Package: yes",
        }
        self.assertTrue(has_accepted_pr_author(base, REPO, "moondog-release[bot]"))
        self.assertFalse(has_accepted_pr_author(base, REPO, "other-release[bot]"))
        self.assertFalse(has_accepted_pr_author(
            {**base, "user": {"login": "untrusted[bot]"}}, REPO, "moondog-release[bot]"
        ))
        self.assertFalse(has_accepted_pr_author(
            {**base, "head": {"repo": {"full_name": "attacker/MoonDog-Service-OS"}}},
            REPO,
            "moondog-release[bot]",
        ))
        self.assertFalse(has_accepted_pr_author(
            {**base, "body": "> MoonDog-Automation-Package: yes"},
            REPO,
            "moondog-release[bot]",
        ))

    def test_guard_rechecks_exact_head_and_waits_for_real_events(self):
        text = MERGE.read_text(encoding="utf-8")
        self.assertIn('github.event.workflow_run.event == \'pull_request\'', text)
        self.assertIn("commits/$HEAD_SHA/check-runs", text)
        self.assertIn("github.event.workflow_run", text)
        self.assertIn("app", text)
        self.assertIn("15368", text)
        self.assertIn("steps.proof.outputs.ready == 'true'", text)
        self.assertIn("pulls/$PR_NUMBER/update-branch", text)
        self.assertIn('gh api -X PUT "repos/$REPO/pulls/$PR_NUMBER/merge"', text)
        self.assertIn("pipeline_guard.py check-paths", text)
        self.assertIn("merge-review-state", text)
        self.assertNotIn("workflow_dispatch", text)
        self.assertNotIn("gh workflow run", text)
        self.assertNotIn("statuses/$HEAD_SHA", text)
        self.assertNotIn("sleep ", text)
        self.assertNotIn("for attempt in {1..", text)

    def test_beta_builder_keeps_reviewed_commit_notes_and_stable_isolation(self):
        workflow = PACKAGE.read_text(encoding="utf-8")
        builder = (ROOT / "scripts/build_beta_package.py").read_text(encoding="utf-8")
        self.assertIn("Verified automated Beta from reviewed source.", builder)
        self.assertIn("Stable manifest changed; Beta preparation refuses Stable promotion", builder)
        self.assertIn("Automatic Beta preparation refuses migrations", builder)
        self.assertIn("No Workspace migration; Stable remains unchanged.", workflow)
        self.assertIn("Stable manifest changes are out of scope", MERGE.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
