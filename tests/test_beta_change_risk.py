"""Beta merge safety policy: fail closed, never silently waive data proof."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from scripts.beta_change_risk import classify, merge_decision


def entry(filename, status="modified", patch="@@ -1 +1 @@\n-.old { display:block }\n+.new { display:block }", previous_filename=None):
    data = {"filename": filename, "status": status, "patch": patch}
    if previous_filename:
        data["previous_filename"] = previous_filename
    return data


def scoped_test():
    return entry(
        "tests/open-ro-new-write-preservation.test.cjs",
        status="added",
        patch="@@ -0,0 +1,2 @@\n+test('saved data remains', () => {\n+  assert.equal(actual, expected);",
    )


class BetaChangeRiskTests(unittest.TestCase):
    def test_safe_css_and_generated_metadata_are_automatic(self):
        self.assertEqual(merge_decision([
            entry("assets/clarity.css"),
            entry("src/meeting-presenter.css"),
            entry("updates/manifest.json", patch=None),
            entry("updates/packages/moondog-0.10.18-beta.999.json", status="added", patch=None),
        ]), "automatic")

    def test_script_change_with_scoped_assertion_does_not_require_ritual_review(self):
        self.assertEqual(classify([entry("assets/app.js"), scoped_test()]), "data-affecting")
        self.assertEqual(merge_decision([entry("assets/app.js"), scoped_test()]), "automatic")

    def test_data_change_without_scoped_proof_requires_review(self):
        self.assertEqual(merge_decision([entry("assets/app.js")]), "review-required")
        self.assertEqual(merge_decision([
            entry("assets/app.js"),
            entry("tests/navigation-render-performance.test.cjs", patch="+test('render', () => { assert.ok(true) }"),
        ]), "review-required")
        self.assertEqual(merge_decision([
            entry("assets/app.js"),
            entry("tests/open-ro-new-write-preservation.test.cjs", patch="+// no added assertion"),
        ]), "review-required")
        self.assertEqual(merge_decision([
            entry("assets/app.js"),
            entry("tests/open-ro-new-write-preservation.test.cjs", patch=None),
        ]), "review-required")

    def test_css_remote_resources_fail_closed(self):
        for patch in (
            "@@ -1 +1 @@\n+@import 'https://example.invalid/foo.css';",
            "@@ -1 +1 @@\n+background:url(https://example.invalid/x)",
            "@@ -1 +1 @@\n+src: url(data:text/css,foo)",
            "@@ -1 +1 @@\n+background:image-set('new.png')",
        ):
            with self.subTest(patch=patch):
                self.assertEqual(merge_decision([entry("assets/clarity.css", patch=patch)]), "protected")
        self.assertEqual(merge_decision([entry("assets/clarity.css", patch=None)]), "protected")
        self.assertEqual(merge_decision([entry("assets/clarity.css", status="added")]), "protected")

    def test_protected_security_policy_and_immutable_regressions_stop(self):
        for path in (
            ".github/workflows/guarded-pr-merge.yml",
            ".github/guarded-merge-policy.json",
            "scripts/beta_change_risk.py",
            "scripts/pipeline_guard.py",
            "tests/test_beta_change_risk.py",
            "tests/durable-write-fault-matrix.test.cjs",
            "tests/workspace-history-isolation.test.cjs",
            "docs/RELEASE-AUTHORIZATION.md",
            "docs/DATA-PRESERVATION-FIRST-BETA-POLICY.md",
            "SECURITY.md",
        ):
            with self.subTest(path=path):
                self.assertEqual(merge_decision([entry(path), scoped_test()]), "protected")

    def test_missing_unknown_or_truncated_scope_fails_closed(self):
        self.assertEqual(merge_decision([]), "protected")
        self.assertEqual(merge_decision([entry("updates/manifest.json")]), "protected")
        self.assertEqual(merge_decision([entry("README.md")]), "protected")
        self.assertEqual(merge_decision([entry("../assets/clarity.css")]), "protected")
        self.assertEqual(merge_decision([{"filename": "assets/clarity.css"}]), "protected")
        self.assertEqual(merge_decision([
            entry("assets/clarity.css", status="renamed",
                  previous_filename="scripts/guarded_merge_policy.py"),
        ]), "protected")
        self.assertEqual(merge_decision([
            entry("tests/open-ro-new-write-preservation.test.cjs", status="removed"),
        ]), "protected")

    def test_cli_requires_exact_file_count_for_review_bypass(self):
        with tempfile.TemporaryDirectory() as temp:
            name = Path(temp) / "changes.json"
            script = str(Path(__file__).resolve().parents[1] / "scripts/beta_change_risk.py")
            name.write_text(json.dumps([entry("assets/app.js"), scoped_test()]), encoding="utf-8")
            ok = subprocess.run(
                [sys.executable, script, str(name), "--decision", "--expected", "2"],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(ok.returncode, 0, ok.stderr)
            self.assertEqual(ok.stdout.strip(), "automatic")
            wrong_count = subprocess.run(
                [sys.executable, script, str(name), "--decision", "--expected", "3"],
                capture_output=True, text=True, check=False,
            )
            self.assertNotEqual(wrong_count.returncode, 0)
            name.write_text("{bad json}", encoding="utf-8")
            invalid = subprocess.run(
                [sys.executable, script, str(name), "--decision", "--expected", "2"],
                capture_output=True, text=True, check=False,
            )
            self.assertNotEqual(invalid.returncode, 0)


if __name__ == "__main__":
    unittest.main()
