"""Focused checks for the public repository boundary."""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from check_publication import blocked_content, blocked_path, scan


class PublicationCheckTests(unittest.TestCase):
    def test_prohibited_paths_and_public_sources(self):
        for path in (
            "data/ro.json", "history/old.txt", "backups/save.zip",
            "01 - DROP REPORTS HERE/input.txt", "Files to Learn/notes.txt",
            "nested/report.XLSX", "settings.json", "nested/assign-next.json",
            ".env.local", "private.pem", "secrets-store.txt",
        ):
            with self.subTest(path=path):
                self.assertTrue(blocked_path(path))
        for path in ("README.md", "docs/ARCHITECTURE.md", "scripts/parser.py", "tests/fixture.json"):
            with self.subTest(path=path):
                self.assertFalse(blocked_path(path))

    def test_high_signal_credentials_in_allowed_source(self):
        self.assertTrue(blocked_content(b"-----BEGIN " + b"PRIVATE KEY-----"))
        self.assertTrue(blocked_content(b"ghp_" + b"A" * 36))
        self.assertFalse(blocked_content(b"Synthetic product documentation."))

    def test_force_added_ignored_file_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            (root / "reports").mkdir()
            (root / "reports" / "sample.csv").write_text("synthetic,example\n", encoding="utf-8")
            subprocess.run(["git", "add", "-f", "reports/sample.csv"], cwd=root, check=True)
            self.assertEqual(scan(root), 1)


if __name__ == "__main__":
    unittest.main()
