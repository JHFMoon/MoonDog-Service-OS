from __future__ import annotations
import unittest
from pathlib import Path
from scripts.beta_change_scope import classify_scope, stable_manifest_unchanged

ROOT = Path(__file__).resolve().parents[1]
STABLE = {"version": "0.10.17", "sha256": "stable-hash", "migrationRequired": False}
BASE = {"stable": STABLE, "beta": {"version": "0.10.18-beta.193", "sha256": "old"}}
BETA_HEAD = {"stable": STABLE, "beta": {"version": "0.10.18-beta.194", "sha256": "new"}}

class BetaChangeScopeTests(unittest.TestCase):
    def classify(self, paths, head=BETA_HEAD):
        return classify_scope(paths, base_manifest=BASE, head_manifest=head)

    def test_manifest_backed_beta_metadata_diff_reuses_expensive_ux_proof(self):
        self.assertEqual(self.classify(["updates/manifest.json", "updates/packages/moondog-0.10.18-beta.194.json", "CHANGELOG.md"]), "metadata-only")

    def test_manifest_only_beta_metadata_edit_can_reuse_runtime_ux_proof(self):
        self.assertEqual(self.classify(["updates/manifest.json"]), "metadata-only")

    def test_stable_manifest_change_keeps_full_ux_proof(self):
        head = {"stable": {**STABLE, "version": "0.10.18"}, "beta": BETA_HEAD["beta"]}
        self.assertEqual(self.classify(["updates/manifest.json"], head), "runtime-change")

    def test_missing_or_malformed_stable_manifest_fails_closed(self):
        self.assertEqual(classify_scope(["updates/manifest.json"]), "runtime-change")
        self.assertEqual(classify_scope(["updates/manifest.json"], base_manifest=BASE, head_manifest={"beta": {}}), "runtime-change")
        self.assertFalse(stable_manifest_unchanged(BASE, {"stable": []}))

    def test_empty_package_only_or_changelog_only_diff_fails_closed(self):
        self.assertEqual(self.classify([]), "runtime-change")
        self.assertEqual(self.classify(["updates/packages/moondog-0.10.18-beta.194.json"]), "runtime-change")
        self.assertEqual(self.classify(["CHANGELOG.md"]), "runtime-change")

    def test_stable_package_and_runtime_changes_keep_full_ux_proof(self):
        for paths in (
            ["updates/manifest.json", "updates/packages/moondog-0.10.17.json"],
            ["updates/manifest.json", "assets/app.js"],
            ["updates/manifest.json", ".github/workflows/clean-install-proof.yml"],
            ["updates/manifest.json", "tests/synthetic.test.cjs"],
            ["updates/manifest.json", "updates/packages/moondog-0.10.18-beta.latest.json"],
        ):
            with self.subTest(paths=paths):
                self.assertEqual(self.classify(paths), "runtime-change")

    def test_workflow_checks_stable_manifest_and_keeps_install_integrity(self):
        workflow = (ROOT / ".github/workflows/clean-install-proof.yml").read_text(encoding="utf-8")
        self.assertIn("git diff --no-renames --name-only -z", workflow)
        self.assertIn('git show "$' + '{GITHUB_SHA}^1:updates/manifest.json"', workflow)
        self.assertIn('git show "$' + '{GITHUB_SHA}^2:updates/manifest.json"', workflow)
        self.assertIn("python3 scripts/beta_change_scope.py", workflow)
        self.assertIn("if: steps.scope.outputs.metadata_only != 'true'", workflow)
        self.assertIn("node scripts/smoke_distribution.mjs", workflow)
        self.assertIn("node scripts/smoke_beta_package.mjs", workflow)
        self.assertIn("test_beta_package_runtime.py", workflow)

if __name__ == "__main__":
    unittest.main()
