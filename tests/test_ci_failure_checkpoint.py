"""Synthetic/static regression checks for the protected CI failure checkpoint."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class FailureCheckpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = (ROOT / ".github/workflows/guarded-pr-merge.yml").read_text(encoding="utf-8")
        cls.job = cls.workflow.split("  report-failed-proof:\n", 1)[1].split("  advance-beta-queue:\n", 1)[0]

    def test_only_failed_pr_verification_emits_checkpoint(self):
        self.assertIn("github.event_name == 'workflow_run'", self.job)
        self.assertIn("github.event.workflow_run.event == 'pull_request'", self.job)
        self.assertIn("github.event.workflow_run.conclusion == 'failure'", self.job)
        self.assertIn('case "$RUN_NAME" in', self.job)
        self.assertIn('"Publication check"|"Clean Install Proof"', self.job)
        self.assertIn("NEEDS CHATGPT RESUMPTION", self.job)

    def test_no_release_or_repo_write_privilege(self):
        self.assertIn("permissions:\n      contents: read\n      pull-requests: read\n      issues: write", self.job)
        self.assertNotIn("permission-contents: write", self.job)
        self.assertNotIn("MOONDOG_RELEASE_APP_PRIVATE_KEY", self.job)
        self.assertNotIn("actions/create-github-app-token", self.job)
        self.assertNotIn("pulls/$PR_NUMBER/merge", self.job)
        self.assertNotIn("update-branch", self.job)

    def test_exact_head_no_logs_and_deduplicated(self):
        self.assertIn('[[ ! "$RUN_HEAD" =~ ^[0-9a-f]{40}$ ]]', self.job)
        self.assertIn("'.head.sha'", self.job)
        self.assertIn("'.head.repo.full_name'", self.job)
        self.assertIn("'.base.ref'", self.job)
        self.assertIn("'.state'", self.job)
        self.assertIn("moondog-failed-proof:v1:$RUN_ID", self.job)
        self.assertIn('grep -Fq "$MARKER"', self.job)
        self.assertIn("gh api -X POST", self.job)
        for forbidden in ("gh run view --log", "download-artifact", "workflow_dispatch", "secrets.", "run_attempt"):
            self.assertNotIn(forbidden, self.job)


if __name__ == "__main__":
    unittest.main()
