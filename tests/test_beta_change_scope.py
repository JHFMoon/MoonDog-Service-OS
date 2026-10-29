from __future__ import annotations

import unittest
from pathlib import Path

from scripts.beta_change_scope import classify_scope

ROOT = Path(__file__).resolve().parents[1]


class BetaChangeScopeTests(unittest.TestCase):
    def test_manifest_backed_beta_metadata_diff_reuses_expensive_ux_proof(self):
        self.assertEqual(
            classify_scope([
                "updates/manifest.json",
                "updates/packages/moondog-0.10.18-beta.194.json",
                "CHANGELOG.md",
            ]),
            "metadata-only",
        )

    def test_manifest_only_metadata_edit_can_reuse_runtime_ux_proof(self):
        self.assertEqual(classify_scope(["updates/manifest.json"]), "metadata-only")

    def test_empty_package_only_or_changelog_only_diff_fails_closed(self):
        self.assertEqual(classify_scope([]), "runtime-change")
        self.assertEqual(classify_scope(["updates/packages/moondog-0.10.18-beta.194.json"]), "runtime-change")
        self.assertEqual(classify_scope(["CHANGELOG.md"]), "runtime-change")

    def test_stable_package_and_runtime_changes_keep_full_ux_proof(self):
        for paths in (
            ["updates/manifest.json", "updates/packages/moondog-0.10.17.json"],
            ["updates/manifest.json", "assets/app.js"],
            ["updates/manifest.json", ".github/workflows/clean-install-proof.yml"],
            ["updates/manifest.json", "tests/synthetic.test.cjs"],
            ["updates/manifest.json", "updates/packages/moondog-0.10.18-beta.latest.json"],
        ):
            with self.subTest(paths=paths):
                self.assertEqual(classify_scope(paths), "runtime-change")

    def test_workflow_keeps_install_and_integrity_checks_on_metadata_only_path(self):
        workflow = (ROOT / ".github/workflows/clean-install-proof.yml").read_text(encoding="utf-8")
        self.assertIn("git diff --name-only -z", workflow)
        self.assertIn("python3 scripts/beta_change_scope.py", workflow)
        self.assertIn("if: steps.scope.outputs.metadata_only != 'true'", workflow)
        self.assertIn("node scripts/smoke_distribution.mjs", workflow)
        self.assertIn("node scripts/smoke_beta_package.mjs", workflow)
        self.assertIn("test_beta_package_runtime.py", workflow)


if __name__ == "__main__":
    unittest.main()
