"""Guard the event-driven Beta release workflow and exact-head gates."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PREPARE = ROOT / ".github/workflows/prepare-beta-package.yml"
GUARD = ROOT / ".github/workflows/guarded-pr-merge.yml"


class BetaVerificationDiagnosticsTests(unittest.TestCase):
    def test_candidate_is_added_to_same_reviewed_pr_without_dispatch_or_polling(self):
        workflow = PREPARE.read_text(encoding="utf-8")
        self.assertIn("pull_request_target:", workflow)
        self.assertIn("Check out candidate as untrusted data", workflow)
        self.assertIn("Build the Beta candidate with trusted code", workflow)
        self.assertIn("Push package commit to the same reviewed PR", workflow)
        self.assertIn("actions/create-github-app-token@", workflow)
        self.assertNotIn("workflow_dispatch", workflow)
        self.assertNotIn("gh workflow run", workflow)
        self.assertNotIn("sleep ", workflow)
        self.assertNotIn("for attempt in {1..", workflow)
        self.assertNotIn("statuses:", workflow)

    def test_merge_gate_uses_real_exact_head_checks_and_review_events(self):
        workflow = GUARD.read_text(encoding="utf-8")
        self.assertIn("pull_request_target:", workflow)
        self.assertIn("workflow_run:", workflow)
        self.assertIn("pull_request_review:", workflow)
        self.assertIn("commits/$HEAD_SHA/check-runs", workflow)
        self.assertIn("permission-actions: read", workflow)
        self.assertIn("permission-checks: read", workflow)
        self.assertIn("permission-contents: read", workflow)
        self.assertIn("permission-issues: write", workflow)
        self.assertIn("permission-pull-requests: write", workflow)
        self.assertIn("check_name='Publication Check'", workflow)
        self.assertIn("'Publication check': '.github/workflows/publication-check.yml'", workflow)
        self.assertIn("check_name='Publication Check' if name=='Publication check'", workflow)
        self.assertIn("specs={'Publication check':", workflow)
        self.assertIn("else 'prove-clean-install'", workflow)
        self.assertIn("15368", workflow)
        self.assertIn("merge-review-state", workflow)
        self.assertIn("ready=false", workflow)
        self.assertIn("workflow_run will reevaluate", workflow)
        self.assertNotIn("workflow_dispatch", workflow)
        self.assertNotIn("gh workflow run", workflow)
        self.assertNotIn("statuses/$HEAD_SHA", workflow)
        self.assertNotIn("sleep ", workflow)
        self.assertNotIn("for attempt in {1..", workflow)

    def test_stable_manifest_is_refused_and_merge_requires_current_proof(self):
        workflow = GUARD.read_text(encoding="utf-8")
        self.assertIn("Stable manifest changes are out of scope", workflow)
        self.assertIn("steps.proof.outputs.ready == 'true'", workflow)
        self.assertIn("Final guarded merge refused", workflow)
        self.assertIn("Check out verified PR candidate as untrusted data", workflow)
        self.assertIn("persist-credentials: false", workflow)
        self.assertIn("current_beta_runtime_mismatches", workflow)
        self.assertIn("the exact PR runtime is not present", workflow)
        self.assertIn('gh api -X PUT "repos/$REPO/pulls/$PR_NUMBER/merge"', workflow)


if __name__ == "__main__":
    unittest.main()
