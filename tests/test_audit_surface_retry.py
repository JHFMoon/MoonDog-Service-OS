"""Redacted public-surface audit retries only genuinely transient failures."""
import unittest
from pathlib import Path

from scripts.audit_surface_retry import (DownloadFailure, classify_api_failure,
                                         retry_transient, safe_api_operation)


class SurfaceRetryTests(unittest.TestCase):
    def attempt_series(self, statuses):
        attempts=[]
        cleaned=[]
        sleeps=[]
        statuses=iter(statuses)

        def attempt():
            status=next(statuses)
            attempts.append(status)
            if status!="200":
                raise DownloadFailure(status)
            return "complete"

        result=(attempts, cleaned, sleeps, attempt)
        return result

    def test_recovers_from_two_http_503_errors(self):
        attempts,cleaned,sleeps,attempt=self.attempt_series(["503","503","200"])
        value=retry_transient(attempt,reset=lambda: cleaned.append(True),
                              sleep=sleeps.append,jitter=lambda:0)
        self.assertEqual(value,"complete")
        self.assertEqual(attempts,["503","503","200"])
        self.assertEqual(sleeps,[1,2])
        self.assertEqual(len(cleaned),3)

    def test_persistent_failure_remains_blocking(self):
        attempts,cleaned,sleeps,attempt=self.attempt_series(["503","503","503"])
        with self.assertRaises(DownloadFailure) as context:
            retry_transient(attempt,reset=lambda: cleaned.append(True),
                            sleep=sleeps.append,jitter=lambda:0)
        self.assertEqual(context.exception.status,"503")
        self.assertEqual(len(attempts),3)
        self.assertEqual(sleeps,[1,2])

    def test_no_retry_for_permanent_or_missing_content(self):
        for status in ["401","403","404","auth_missing","missing_file"]:
            attempts,cleaned,sleeps,attempt=self.attempt_series([status])
            with self.subTest(status=status),self.assertRaises(DownloadFailure):
                retry_transient(attempt,reset=lambda: cleaned.append(True),
                                sleep=sleeps.append,jitter=lambda:0)
            self.assertEqual(len(attempts),1)
            self.assertFalse(sleeps)

    def test_transport_error_and_jitter_are_bounded(self):
        attempts,cleaned,sleeps,attempt=self.attempt_series(["transport_failure","429","200"])
        self.assertEqual(retry_transient(attempt,reset=lambda: cleaned.append(True),
                                        sleep=sleeps.append,jitter=lambda:100),"complete")
        self.assertEqual(sleeps,[1.25,2.25])

    def test_github_api_failure_classification_is_fixed_and_redacted(self):
        cases = [
            (b"gh: API rate limit exceeded for synthetic request", "429"),
            (b"gh: secondary rate limit (HTTP 403)", "429"),
            (b"gh: Resource not accessible by integration (HTTP 403)", "403"),
            (b"gh: temporary server response HTTP 503", "503"),
            (b"gh: connection timed out", "transport_failure"),
            (b"gh: unexpected response with private message", "api_failure"),
        ]
        for stderr, expected in cases:
            with self.subTest(expected=expected):
                result = classify_api_failure(stderr)
                self.assertEqual(result, expected)
                self.assertNotIn(stderr.decode(), result)

    def test_github_api_operation_labels_never_include_endpoint_values(self):
        cases = [
            ("repos/JHFMoon/MoonDog-Service-OS/pulls/593/reviews?per_page=100", "pr_reviews"),
            ("repos/JHFMoon/MoonDog-Service-OS/issues/comments?per_page=100", "issue_comments"),
            ("repos/JHFMoon/MoonDog-Service-OS/releases?per_page=100", "release_list"),
            ("repos/JHFMoon/MoonDog-Service-OS/actions/artifacts?per_page=100", "artifact_list"),
            ("unrecognized/private/path?token=synthetic", "other_api"),
        ]
        for endpoint, expected in cases:
            with self.subTest(expected=expected):
                result = safe_api_operation(endpoint)
                self.assertEqual(result, expected)
                self.assertNotIn("593", result)
                self.assertNotIn("token", result)

    def test_retry_limit_rejects_unbounded_attempts(self):
        with self.assertRaises(ValueError):
            retry_transient(lambda:None,reset=lambda:None,max_attempts=100)

    def test_integration_keeps_failed_artifacts_blocking(self):
        source=(Path(__file__).resolve().parents[1]/"scripts/audit_public_surfaces.py").read_text()
        self.assertIn("retry_transient(download_once",source)
        self.assertIn("retry_transient(api_read",source)
        self.assertIn("safe_api_operation(endpoint)",source)
        self.assertIn('counts["api_request_failure"]+=1',source)
        self.assertIn('counts["action_artifact_download_failure"]+=1',source)
        self.assertIn('counts["release_asset_download_failure"]+=1',source)
        self.assertIn('if counts:',source)


if __name__=="__main__":
    unittest.main()
