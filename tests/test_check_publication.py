"""Focused checks for the public repository boundary."""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from check_publication import blocked_content, blocked_path, release_contract_errors, scan


class PublicationCheckTests(unittest.TestCase):
    def test_beta_publication_requires_safe_stable_return(self):
        import json
        root = Path(__file__).resolve().parents[1]
        self.assertEqual(release_contract_errors(root), [])
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory)
            (fixture / "updates" / "packages").mkdir(parents=True)
            for name in ("moondog-0.10.7.json", "moondog-0.10.8-beta.1.json", "moondog-0.10.7-beta.1.json", "moondog-0.10.7-beta.2.json"):
                (fixture / "updates" / "packages" / name).write_bytes((root / "updates" / "packages" / name).read_bytes())
            manifest = json.loads((root / "updates" / "manifest.json").read_text(encoding="utf-8"))
            target = fixture / "updates" / "manifest.json"
            manifest["beta"]["migrationRequired"] = True
            target.write_text(json.dumps(manifest), encoding="utf-8")
            self.assertTrue(release_contract_errors(fixture))
            manifest["beta"]["migrationRequired"] = False
            manifest["stable"]["packageUrl"] = None
            target.write_text(json.dumps(manifest), encoding="utf-8")
            self.assertTrue(release_contract_errors(fixture))
            manifest["stable"]["packageUrl"] = json.loads((root / "updates" / "manifest.json").read_text(encoding="utf-8"))["stable"]["packageUrl"]
            package_path = fixture / "updates" / "packages" / "moondog-0.10.7.json"
            package = json.loads(package_path.read_text(encoding="utf-8"))
            package["approvedFiles"] = ["assets/other.css"]
            package_path.write_text(json.dumps(package), encoding="utf-8")
            self.assertTrue(release_contract_errors(fixture))

    def test_root_application_entry_is_approved_but_backups_are_not(self):
        import base64
        import hashlib
        import json
        root = Path(__file__).resolve().parents[1]
        self.assertEqual(release_contract_errors(root), [])
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory)
            packages = fixture / "updates" / "packages"
            packages.mkdir(parents=True)
            manifest = json.loads((root / "updates" / "manifest.json").read_text(encoding="utf-8"))
            for channel in ("stable", "beta"):
                version = manifest[channel]["version"]
                name = f"moondog-{version}.json"
                package = json.loads((root / "updates" / "packages" / name).read_text(encoding="utf-8"))
                self.assertIn("index.html", package["approvedFiles"])
                if channel == "beta":
                    package["approvedFiles"].append("backups/system-updates/forbidden.json")
                    package["files"].append({"path": "backups/system-updates/forbidden.json", "action": "put", "sha256": hashlib.sha256(b"{}").hexdigest(), "contentBase64": base64.b64encode(b"{}").decode("ascii")})
                raw = (json.dumps(package) + "\n").encode("utf-8")
                (packages / name).write_bytes(raw)
                manifest[channel]["sha256"] = hashlib.sha256(raw).hexdigest()
            (fixture / "updates" / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            self.assertTrue(release_contract_errors(fixture))

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
