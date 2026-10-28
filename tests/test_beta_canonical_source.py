"""Prevent stale Beta snapshots from silently omitting already merged changes."""
from pathlib import Path
import tempfile
import unittest

from scripts.build_beta_package import source_runtime_mismatches, normalized_runtime_content

ROOT=Path(__file__).resolve().parents[1]

class CanonicalBetaSourceTests(unittest.TestCase):
    def test_beta_app_identity_does_not_create_spurious_runtime_drift(self):
        old=b'const VERSION = "0.10.18-beta.25";\nconst BUILD_DATE = "2026-10-09";\nfunction current() {return 1;}\n'
        now=b'const VERSION = "0.10.17";\nconst BUILD_DATE = "2026-10-11";\nfunction current() {return 1;}\n'
        self.assertEqual(normalized_runtime_content("assets/app.js",old), normalized_runtime_content("assets/app.js",now))

    def test_detects_omitted_earlier_manager_feature_even_if_last_delta_differs(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            (root/"assets").mkdir()
            source=b'const VERSION = "0.10.17";\nconst BUILD_DATE = "2026-10-11";\nfunction adminDueToday() {return true;}\n'
            older=b'const VERSION = "0.10.18-beta.25";\nconst BUILD_DATE = "2026-10-09";\n'
            (root/"assets/app.js").write_bytes(source)
            mismatches=source_runtime_mismatches(root,{"assets/app.js":older},["assets/app.js"])
            self.assertEqual(mismatches,["assets/app.js"])

    def test_runtime_file_drift_and_missing_file_are_explicit(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            (root/"index.html").write_bytes(b"reviewed launcher")
            self.assertEqual(source_runtime_mismatches(root,{"index.html":b"old launcher"},["index.html"]),["index.html"])
            self.assertEqual(source_runtime_mismatches(root,{},["index.html"]),["index.html"])
            with self.assertRaises(SystemExit):
                source_runtime_mismatches(root,{},["assets/app.js"])

    def test_builder_snapshots_every_catalogued_runtime_file_from_source(self):
        builder=(ROOT/"scripts/build_beta_package.py").read_text(encoding="utf-8")
        self.assertIn("mismatches = source_runtime_mismatches(root, current_files, paths)",builder)
        self.assertIn("if not changed and not added and not mismatches:",builder)
        self.assertIn("content = (root / path).read_bytes()",builder)
        self.assertNotIn("content = merge_text(",builder)

    def test_reviewed_source_pr_contains_a_verified_beta_candidate(self):
        workflow=(ROOT/".github/workflows/prepare-beta-package.yml").read_text(encoding="utf-8")
        self.assertIn("pull_request_target:",workflow)
        self.assertIn("scripts/build_beta_package.py",workflow)
        self.assertIn("Push package commit to the same reviewed PR",workflow)
        self.assertIn("normal pull_request checks",workflow)
        self.assertNotIn("package-unadvertised-main-runtime:",workflow)
        self.assertNotIn("workflow_dispatch:",workflow)
        contract=(ROOT/"tests/test_beta_package_runtime.py").read_text(encoding="utf-8")
        self.assertIn("package_change_in_pr = (",contract)
        self.assertIn("verify_runtime =",contract)

if __name__=="__main__":
    unittest.main()
