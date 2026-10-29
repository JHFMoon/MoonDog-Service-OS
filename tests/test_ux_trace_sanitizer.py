import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SANITIZER = ROOT / "scripts" / "sanitize_ux_trace.py"

class SanitizedUxTraceTests(unittest.TestCase):
    def run_cli(self, *args, expected=0):
        result = subprocess.run(
            [sys.executable, str(SANITIZER), *map(str, args)],
            cwd=ROOT, capture_output=True, text=True, check=False
        )
        self.assertEqual(result.returncode, expected)
        self.assertNotIn("Synthetic Customer", result.stdout + result.stderr)
        return result

    def test_sanitize_keeps_only_scrubbed_event_stream(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "raw.zip"
            destination = Path(directory) / "safe.zip"
            event = {
                "type": "event", "apiName": "page.goto",
                "url": "file:///C:/Synthetic Workspace/Reports/report.xlsx",
                "error": 'failed "/home/runner/Private Customer/report.xlsx"; /srv/private/customer.xlsx',
                "details": {"authorization": "Bearer SYNTHETIC_BEARER_VALUE",
                            "password": "Synthetic Customer Password",
                            "message": '{"token":"SYNTHETIC_JSON_TOKEN","note":"Synthetic Customer"}'}
            }
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("trace.trace", json.dumps(event) + "\n")
                archive.writestr("resources/request-body.txt", "Synthetic Customer private payload")
                archive.writestr("resources/screenshot.png", b"synthetic")
            self.run_cli("sanitize", source, destination)
            self.run_cli("validate", destination)
            with zipfile.ZipFile(destination) as archive:
                self.assertEqual(sorted(archive.namelist()), ["sanitized-manifest.json", "trace.trace"])
                manifest = json.loads(archive.read("sanitized-manifest.json"))
                self.assertEqual(manifest["discardedMemberCount"], 2)
                trace = archive.read("trace.trace").decode("utf-8")
                for marker in ("Synthetic Workspace", "Private Customer", "/srv/private",
                               "SYNTHETIC_BEARER_VALUE", "Synthetic Customer Password",
                               "SYNTHETIC_JSON_TOKEN", "Synthetic Customer private payload",
                               "file://"):
                    self.assertNotIn(marker, trace)
                self.assertIn("[redacted-path]", trace)
                self.assertIn("[redacted]", trace)

    def test_malformed_trace_fails_without_output(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "bad.zip"
            destination = Path(directory) / "safe.zip"
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("other.txt", "synthetic")
            self.run_cli("sanitize", source, destination, expected=1)
            self.assertFalse(destination.exists())

    def test_validator_rejects_unsafe_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "unsafe.zip"
            manifest = {"schemaVersion": 1, "format": "sanitized-playwright-jsonl",
                        "eventCount": 1, "discardedMemberCount": 0}
            event = {"type": "event", "error": "file:///srv/private/customer.xlsx"}
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("trace.trace", json.dumps(event) + "\n")
                archive.writestr("sanitized-manifest.json", json.dumps(manifest))
            self.run_cli("validate", archive_path, expected=1)

if __name__ == "__main__":
    unittest.main()
