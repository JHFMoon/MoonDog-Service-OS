"""Exercise public-surface download failures through the real audit entry point.

All GitHub API and download responses are synthetic; no network call is made.
"""
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "audit_public_surfaces.py"


class PublicSurfaceAuditIntegrationTests(unittest.TestCase):
    def _empty_zip(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w"):
            pass
        return buffer.getvalue()

    def run_audit(self, *, artifact_status="410", artifact_name="synthetic-artifact",
                  release_status=None):
        with tempfile.TemporaryDirectory() as directory:
            status_path = Path(directory) / "status.json"
            summary_path = Path(directory) / "summary.md"
            archive = self._empty_zip()

            def fake_run(command, **kwargs):
                if command[0] == "gh":
                    endpoint = command[-1]
                    if "/releases?" in endpoint:
                        assets = []
                        if release_status is not None:
                            assets = [{"id": 81, "name": "synthetic-release.zip"}]
                        payload = [{
                            "name": "Synthetic release",
                            "body": "Synthetic release notes",
                            "tag_name": "v0.0.0-test",
                            "assets": assets,
                        }] if assets else []
                    elif "/actions/artifacts?" in endpoint:
                        payload = {"artifacts": [{
                            "id": 91,
                            "name": artifact_name,
                            "expired": False,
                        }]}
                    elif "/issues?" in endpoint:
                        payload = []
                    elif "/issues/comments?" in endpoint or "/pulls/comments?" in endpoint:
                        payload = []
                    else:
                        raise AssertionError("Unexpected synthetic GitHub API operation")
                    return type("Result", (), {
                        "returncode": 0,
                        "stdout": json.dumps(payload).encode("utf-8"),
                        "stderr": b"",
                    })()

                if command[0] == "curl":
                    target = Path(command[command.index("--output") + 1])
                    url = command[-1]
                    if "/actions/artifacts/" in url:
                        status = artifact_status
                    elif "/releases/assets/" in url:
                        status = release_status
                    else:
                        raise AssertionError("Unexpected synthetic download endpoint")
                    if status == "200":
                        target.write_bytes(archive)
                    return type("Result", (), {
                        "returncode": 0,
                        "stdout": status.encode("ascii"),
                        "stderr": b"",
                    })()

                raise AssertionError("Unexpected subprocess in synthetic audit")

            environment = {
                "GITHUB_REPOSITORY": "JHFMoon/MoonDog-Service-OS",
                "GH_TOKEN": "synthetic-token-only",
                "PUBLIC_SURFACE_AUDIT_STATUS": str(status_path),
                "GITHUB_STEP_SUMMARY": str(summary_path),
            }
            sys.path.insert(0, str(ROOT))
            sys.path.insert(0, str(ROOT / "scripts"))
            try:
                with patch.dict(os.environ, environment), patch(
                    "subprocess.run", side_effect=fake_run
                ):
                    try:
                        runpy.run_path(str(SCRIPT), run_name="__main__")
                    except SystemExit as error:
                        exit_code = error.code
                    else:
                        exit_code = 0
                report = json.loads(status_path.read_text(encoding="utf-8"))
                summary = summary_path.read_text(encoding="utf-8")
                return exit_code, report, summary
            finally:
                sys.path.remove(str(ROOT / "scripts"))
                sys.path.remove(str(ROOT))

    def test_gone_action_artifact_is_safe_but_reported(self):
        exit_code, report, summary = self.run_audit(artifact_status="410")
        self.assertEqual(exit_code, 0)
        self.assertEqual(report["safe_counts"]["unavailable_action_artifact_410"], 1)
        self.assertNotIn("action_artifact_download_failure", report["counts"])
        self.assertIn("unavailable artifact contents were not retrievable", summary)

    def test_other_action_artifact_failure_remains_blocking(self):
        exit_code, report, _ = self.run_audit(artifact_status="404")
        self.assertEqual(exit_code, 1)
        self.assertEqual(report["counts"]["action_artifact_download_failure"], 1)
        self.assertEqual(report["counts"]["action_artifact_http_404"], 1)

    def test_release_asset_http_410_remains_blocking(self):
        exit_code, report, _ = self.run_audit(
            artifact_status="200", release_status="410"
        )
        self.assertEqual(exit_code, 1)
        self.assertEqual(report["counts"]["release_asset_download_failure"], 1)
        self.assertEqual(report["counts"]["release_asset_http_410"], 1)

    def test_gone_artifact_does_not_suppress_sensitive_artifact_name(self):
        synthetic_candidate = "ghp_" + ("A" * 24)
        exit_code, report, _ = self.run_audit(
            artifact_status="410", artifact_name=synthetic_candidate
        )
        self.assertEqual(exit_code, 1)
        self.assertEqual(report["safe_counts"]["unavailable_action_artifact_410"], 1)
        self.assertEqual(report["counts"]["provider_token"], 1)


if __name__ == "__main__":
    unittest.main()
