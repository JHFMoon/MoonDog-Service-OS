import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from scripts.beta_change_risk import classify, path_risk


def entry(filename, status="modified", patch="@@ -1 +1 @@\n-.old { display:block }\n+.new { display:block }", previous_filename=None):
    out = {"filename": filename, "status": status, "patch": patch}
    if previous_filename:
        out["previous_filename"] = previous_filename
    return out


class BetaChangeRiskTests(unittest.TestCase):
    def test_safe_css_and_generated_metadata_do_not_require_ritual_review(self):
        self.assertEqual(classify([
            entry("assets/clarity.css"), entry("src/meeting-presenter.css"),
            entry("updates/manifest.json", patch=None),
            entry("updates/packages/moondog-0.10.18-beta.999.json", status="added", patch=None),
            entry("CHANGELOG.md", patch=None),
        ]), "routine")

    def test_css_remote_resource_and_missing_patch_fail_closed(self):
        for patch in (
            "@@ -1 +1 @@\n+@import 'https://example.invalid/test.css';",
            "@@ -1 +1 @@\n+background: url(https://example.invalid/capture)",
            "@@ -1 +1 @@\n+background: image-set('x')",
            "@@ -1 +1 @@\n+src: url(data:text/css,abc)",
        ):
            self.assertEqual(classify([entry("assets/clarity.css", patch=patch)]), "data-affecting")
        self.assertEqual(classify([entry("assets/clarity.css", patch=None)]), "data-affecting")
        self.assertEqual(classify([entry("assets/clarity.css", status="added")]), "data-affecting")

    def test_js_html_data_paths_and_tests_retain_data_gate(self):
        for path in (
            "assets/app.js", "assets/daily-ops.js", "index.html",
            "tests/open-ro-edit-save-roundtrip.test.cjs", "updates/something.json"
        ):
            self.assertEqual(classify([entry(path), entry("assets/clarity.css")]), "data-affecting")

    def test_guarded_merge_protection_cannot_self_authorize(self):
        for path in (
            ".github/workflows/guarded-pr-merge.yml",
            ".github/guarded-merge-policy.json",
            "scripts/beta_change_risk.py",
            "scripts/pipeline_guard.py",
            "tests/test_beta_change_risk.py",
            "docs/RELEASE-AUTHORIZATION.md",
            "docs/DATA-PRESERVATION-FIRST-BETA-POLICY.md",
            "SECURITY.md",
        ):
            self.assertEqual(classify([entry(path), entry("assets/clarity.css")]), "protected")

    def test_unknown_generated_only_or_rename_are_not_routine(self):
        self.assertEqual(classify([]), "protected")
        self.assertEqual(classify([entry("updates/manifest.json")]), "data-affecting")
        self.assertEqual(classify([entry("assets/clarity.css", status="renamed",
                                       previous_filename="scripts/pipeline_guard.py")]), "protected")
        self.assertEqual(classify([entry("../assets/clarity.css")]), "protected")
        self.assertEqual(classify([{"filename": "assets/clarity.css"}]), "protected")

    def test_cli_reads_structured_scope_without_trusting_pr_text(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "changes.json"
            source.write_text(json.dumps([entry("assets/styles.css")]), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(Path(__file__).resolve().parents[1] /
                                     "scripts/beta_change_risk.py"), str(source)],
                capture_output=True, text=True
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), "routine")
            source.write_text("{not JSON}", encoding="utf-8")
            invalid = subprocess.run(
                [sys.executable, str(Path(__file__).resolve().parents[1] /
                                     "scripts/beta_change_risk.py"), str(source)],
                capture_output=True, text=True
            )
            self.assertNotEqual(invalid.returncode, 0)


if __name__ == "__main__":
    unittest.main()
