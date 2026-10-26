"""Ensure automatic Beta verification errors can be diagnosed without bypassing gates."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]

class BetaVerificationDiagnosticsTests(unittest.TestCase):
    def test_generated_beta_failure_identifies_exact_check_run(self):
        workflow=(ROOT/".github/workflows/prepare-beta-package.yml").read_text(encoding="utf-8")
        self.assertIn("Generated Beta verification failed. Exact-head workflow IDs and failed jobs follow.",workflow)
        self.assertIn("actions/runs/$FAILED_ID/jobs?per_page=100",workflow)
        self.assertEqual(workflow.count("actions/runs/$FAILED_ID/jobs?per_page=100"),2)
        self.assertEqual(workflow.count("- name: Open isolated package PR"),1)
        self.assertEqual(workflow.count("- name: Dispatch exact-head verification"),1)
        self.assertEqual(workflow.count("- name: Verify package PR and merge exact head"),1)
        self.assertIn("for attempt in {1..180}; do",workflow)
        self.assertNotIn("\\${{",workflow)
        self.assertIn("Generated-head verification failed; exact-head run IDs and failed job names:",workflow)
        self.assertIn("select(.conclusion==\"failure\" or .conclusion==\"cancelled\" or .conclusion==\"timed_out\")",workflow)
        self.assertIn("done <<<\"$FAILED_IDS\"",workflow)
        self.assertIn('echo "Generated-head verification failed; exact-head run IDs and failed job names:"',workflow)
        self.assertIn("exit 1",workflow)

    def test_proof_remains_strict_and_never_touches_stable(self):
        workflow=(ROOT/".github/workflows/prepare-beta-package.yml").read_text(encoding="utf-8")
        self.assertIn('test "$CURRENT_MAIN" = "$EXPECTED_MAIN"',workflow)
        self.assertIn("if main.get('stable') != package.get('stable'):",workflow)
        self.assertIn('gh api -X PUT "repos/$REPO/pulls/$PR_NUMBER/merge"',workflow)
        self.assertIn("PYTHONDONTWRITEBYTECODE: '1'",workflow)

if __name__=="__main__":
    unittest.main()
