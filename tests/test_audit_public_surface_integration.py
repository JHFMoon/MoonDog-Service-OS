"""Exercise public-surface download failures through the real audit entry point.

All GitHub API and download responses are synthetic; no network call is made.
"""
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import threading
import time
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
                  release_status=None, reviews_by_pr=None, review_tracker=None,
                  review_failure=None):
        with tempfile.TemporaryDirectory() as directory:
            status_path = Path(directory) / "status.json"
            summary_path = Path(directory) / "summary.md"
            archive = self._empty_zip()

            def fake_run(command, **kwargs):
                if command[0] == "gh":
                    endpoint = command[-1]
                    returncode = 0
                    stderr = b""
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
                        payload = [
                            {"number": number, "pull_request": {"url": "synthetic-only"}}
                            for number in sorted(reviews_by_pr or {})
                        ]
                    elif "/pulls/" in endpoint and "/reviews?" in endpoint:
                        number = int(endpoint.split("/pulls/", 1)[1].split("/reviews", 1)[0])
                        if review_tracker is not None:
                            with review_tracker["lock"]:
                                review_tracker["active"] += 1
                                review_tracker["peak"] = max(
                                    review_tracker["peak"], review_tracker["active"]
                                )
                        try:
                            time.sleep(0.02)  # Synthetic I/O makes concurrency measurable.
                            payload = (reviews_by_pr or {}).get(number, [])
                            if number == review_failure:
                                returncode = 1
                                stderr = b"gh: HTTP 403 synthetic permission denial"
                        finally:
                            if review_tracker is not None:
                                with review_tracker["lock"]:
                                    review_tracker["active"] -= 1
                    elif "/issues/comments?" in endpoint or "/pulls/comments?" in endpoint:
                        payload = []
                    else:
                        raise AssertionError("Unexpected synthetic GitHub API operation")
                    return type("Result", (), {
                        "returncode": returncode,
                        "stdout": json.dumps(payload).encode("utf-8"),
                        "stderr": stderr,
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
                summary = summary_path.read_text(encoding="utf-8") if summary_path.exists() else ""
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



    def test_bounded_review_fetch_scans_all_synthetic_submissions(self):
        reviews = {
            number: [{"body": f"Synthetic safe review {number}"}]
            for number in range(201, 213)
        }
        tracker = {"lock": threading.Lock(), "active": 0, "peak": 0}
        exit_code, report, _ = self.run_audit(
            reviews_by_pr=reviews, review_tracker=tracker
        )
        self.assertEqual(exit_code, 0)
        self.assertEqual(report["reviewSubmissions"], len(reviews))
        self.assertEqual(report["counts"], {})
        self.assertEqual(tracker["active"], 0)
        self.assertGreaterEqual(tracker["peak"], 2, "review reads should overlap")
        self.assertLessEqual(tracker["peak"], 4, "the security audit bounds requests")

    def test_review_scan_still_blocks_on_synthetic_sensitive_content(self):
        reviews = {
            301: [{"body": "Synthetic safe review"}],
            302: [{"body": "ghp_" + "A" * 24}],
        }
        exit_code, report, summary = self.run_audit(reviews_by_pr=reviews)
        self.assertEqual(exit_code, 1)
        self.assertEqual(report["reviewSubmissions"], 2)
        self.assertEqual(report["counts"]["provider_token"], 1)
        self.assertIn("Review required", summary)
        self.assertNotIn("ghp_" + "A" * 24, summary)

    def test_one_review_api_denial_fails_entire_concurrent_audit_closed(self):
        reviews = {
            number: [{"body": f"Synthetic safe review {number}"}]
            for number in range(401, 409)
        }
        exit_code, report, summary = self.run_audit(
            reviews_by_pr=reviews, review_failure=404
        )
        self.assertEqual(exit_code, 1)
        self.assertEqual(report["counts"]["api_request_failure"], 1)
        self.assertEqual(report["partial"], True)
        self.assertEqual(summary, "")
        self.assertNotIn("HTTP 403 synthetic permission denial", str(report))

if __name__ == "__main__":
    unittest.main()
