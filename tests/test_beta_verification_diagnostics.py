"""Guard generated Beta retry workflow structure and exact-head evidence."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/prepare-beta-package.yml"


class BetaVerificationDiagnosticsTests(unittest.TestCase):
    def test_candidate_reuse_loop_stays_inside_build_step(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        open_step = workflow.index("- name: Open isolated package PR")
        reuse_loop = workflow.index("while IFS=$'\\t' read -r CANDIDATE_NUMBER CANDIDATE_HEAD; do")
        self.assertLess(reuse_loop, open_step)
        self.assertIn('done <<< "$CANDIDATE_LIST"', workflow[:open_step])
        self.assertEqual(workflow.count("- name: Open isolated package PR"), 1)
        self.assertEqual(workflow.count("- name: Dispatch exact-head verification"), 1)
        self.assertEqual(workflow.count("- name: Verify package PR and merge exact head"), 1)

    def test_retry_wait_covers_exact_head_review(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("for attempt in {1..180}; do", workflow)
        self.assertNotIn("\\${{", workflow)

    def test_failure_path_stays_closed_and_stable_is_guarded(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("if main.get('stable') != package.get('stable'):", workflow)
        self.assertIn('gh api -X PUT "repos/$REPO/pulls/$PR_NUMBER/merge"', workflow)
        self.assertIn("PYTHONDONTWRITEBYTECODE: '1'", workflow)
        self.assertIn("exit 1", workflow)


if __name__ == "__main__":
    unittest.main()
