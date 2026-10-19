"""Synthetic regression coverage for the read-only roadmap progress report."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import roadmap_progress


class RoadmapProgressTests(unittest.TestCase):
    def report(self, matrix, issues):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            matrix_path = root / "matrix.md"
            evidence_path = root / "evidence.json"
            manifest_path = root / "manifest.json"
            matrix_path.write_text(matrix, encoding="utf-8")
            evidence_path.write_text(json.dumps({"issues": issues}), encoding="utf-8")
            manifest_path.write_text(
                json.dumps({"beta": {"version": "0.0.0-test"}}), encoding="utf-8"
            )
            output = io.StringIO()
            with (
                patch.object(roadmap_progress, "MATRIX", matrix_path),
                patch.object(roadmap_progress, "EVIDENCE", evidence_path),
                patch.object(roadmap_progress, "MANIFEST", manifest_path),
                contextlib.redirect_stdout(output),
            ):
                roadmap_progress.main()
            return output.getvalue()

    def test_newly_registered_issue_is_included_without_script_edits(self):
        matrix = (
            "## #58 — existing active\n"
            "| 58-01 | test | **PARTIALLY COMPLETE** |\n"
            "## #999 — newly registered active\n"
            "| 999-01 | test | **VERIFIED COMPLETE** |\n"
            "## #212 — deferred\n"
            "| 212-01 | test | **DEFERRED** |\n"
        )
        issues = {
            "58": {"criteria": {}},
            "999": {"criteria": {"999-01": {"kind": "test", "pr": 1, "tests": []}}},
            "212": {"criteria": {}},
        }
        output = self.report(matrix, issues)
        self.assertIn("#58 | 0/1 | 1 | 0/0 credited | OPEN REQUIREMENTS", output)
        self.assertIn("#999 | 1/1 | 0 | 1/1 credited | READY FOR CLOSURE REVIEW", output)
        self.assertIn("#212 | 0/1 | 1 | 0/0 credited | DEFERRED", output)
        self.assertIn("ACTIVE TOTAL | 1/2 | 1 remaining", output)

    def test_unregistered_matrix_issue_fails_loudly(self):
        matrix = (
            "## #58 — existing\n| 58-01 | test | **PARTIALLY COMPLETE** |\n"
            "## #999 — unregistered\n| 999-01 | test | **PARTIALLY COMPLETE** |\n"
        )
        with self.assertRaisesRegex(ValueError, "Roadmap issue mismatch"):
            self.report(matrix, {"58": {"criteria": {}}})

    def test_registry_issue_missing_from_matrix_fails_loudly(self):
        matrix = "## #58 — existing\n| 58-01 | test | **PARTIALLY COMPLETE** |\n"
        with self.assertRaisesRegex(ValueError, "Roadmap issue mismatch"):
            self.report(matrix, {
                "58": {"criteria": {}},
                "999": {"criteria": {}},
            })

    def test_noncanonical_registry_issue_ids_are_rejected(self):
        matrix = "## #58 — existing\\n| 58-01 | test | **PARTIALLY COMPLETE** |\\n"
        for issues in (
            {"058": {"criteria": {}}},
            {"+58": {"criteria": {}}},
            {"58 ": {"criteria": {}}},
            {"58": {"criteria": {}}, "058": {"criteria": {}}},
        ):
            with self.subTest(keys=sorted(issues)):
                with self.assertRaisesRegex(
                    ValueError, "Non-canonical roadmap registry issue IDs"
                ):
                    self.report(matrix, issues)


if __name__ == "__main__":
    unittest.main()
