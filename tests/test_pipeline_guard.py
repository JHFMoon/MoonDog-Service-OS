import unittest

from scripts.pipeline_guard import (
    blocked_paths,
    protected_automation_path,
    stable_manifest_changed,
    validate_pr_snapshot,
)


class PipelineGuardTests(unittest.TestCase):
    def test_runtime_changes_are_eligible_for_automation(self):
        self.assertFalse(protected_automation_path("assets/app.js"))
        self.assertFalse(protected_automation_path("assets/freshness.js"))
        self.assertEqual(blocked_paths(["assets/app.js", "README.md"]), [])

    def test_proof_workflow_and_guard_changes_are_rejected(self):
        candidates = [
            ".github/workflows/publication-check.yml",
            ".github/workflows/clean-install-proof.yml",
            ".github/workflows/prepare-beta-package.yml",
            "scripts/check_publication.py",
            "scripts/pipeline_guard.py",
            "tests/test_security_workflows.py",
        ]
        self.assertEqual(blocked_paths(candidates), sorted(candidates))

    def test_pr_snapshot_requires_exact_safe_current_identity(self):
        pr = {
            "state": "open",
            "draft": False,
            "body": "MoonDog-Auto-Merge: yes",
            "author_association": "OWNER",
            "base": {"ref": "main"},
            "head": {
                "sha": "abc123",
                "repo": {"full_name": "JHFMoon/MoonDog-Service-OS"},
            },
        }
        self.assertEqual(
            validate_pr_snapshot(
                pr,
                repository="JHFMoon/MoonDog-Service-OS",
                expected_head="abc123",
            ),
            [],
        )
        altered = dict(pr)
        altered["draft"] = True
        self.assertIn(
            "not-draft",
            validate_pr_snapshot(
                altered,
                repository="JHFMoon/MoonDog-Service-OS",
                expected_head="abc123",
            ),
        )
        self.assertIn(
            "exact-head",
            validate_pr_snapshot(
                pr,
                repository="JHFMoon/MoonDog-Service-OS",
                expected_head="different",
            ),
        )

    def test_stable_change_is_detected_independent_of_beta(self):
        base = {"stable": {"version": "0.10.17"}, "beta": {"version": "0.10.18-beta.3"}}
        beta_only = {"stable": {"version": "0.10.17"}, "beta": {"version": "0.10.18-beta.4"}}
        promoted = {"stable": {"version": "0.10.18"}, "beta": {"version": "0.10.18-beta.4"}}
        self.assertFalse(stable_manifest_changed(base, beta_only))
        self.assertTrue(stable_manifest_changed(base, promoted))


if __name__ == "__main__":
    unittest.main()
