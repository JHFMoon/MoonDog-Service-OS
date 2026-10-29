"""Synthetic transport faults; preserve existing protected acceptance tests."""
from io import BytesIO
from http.client import IncompleteRead
import json
from unittest import TestCase
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

from scripts import issue_auto_close as closer


class CloseoutTransportTests(TestCase):
    def setUp(self):
        self.api = closer.GitHub("synthetic-token", closer.SAFE_REPO)
        self.endpoint = "repos/" + closer.SAFE_REPO + "/branches/main"

    def response(self, value):
        response = Mock()
        response.__enter__ = Mock(return_value=BytesIO(json.dumps(value).encode()))
        response.__exit__ = Mock(return_value=False)
        return response

    def http_error(self, code, headers=None):
        return HTTPError("https://api.github.com/synthetic", code, "synthetic", headers or {}, None)

    @patch.object(closer, "urlopen")
    def test_shared_time_budget_stops_reads_and_mutations_before_network(self, send):
        with patch.object(closer.time, "monotonic", return_value=self.api.deadline):
            for method in ["GET", "POST", "PATCH"]:
                with self.assertRaisesRegex(ValueError, "time budget exhausted"):
                    self.api.request(method, self.endpoint)
        send.assert_not_called()

    @patch.object(closer.time, "sleep")
    @patch.object(closer, "urlopen")
    def test_backoff_cannot_outlive_shared_budget(self, send, sleep):
        send.side_effect = self.http_error(429, {"Retry-After": "30"})
        with patch.object(closer.time, "monotonic", return_value=self.api.deadline - 5):
            with self.assertRaisesRegex(ValueError, "exceeds time budget"):
                self.api.request("GET", self.endpoint)
        send.assert_called_once()
        sleep.assert_not_called()

    @patch.object(closer.time, "sleep")
    @patch.object(closer, "urlopen")
    def test_transient_reads_retry_then_return_verified_response(self, send, sleep):
        send.side_effect = [URLError("offline"), self.http_error(503), self.response({"ok": True})]
        self.assertEqual(self.api.request("GET", self.endpoint), {"ok": True})
        self.assertEqual(send.call_count, 3)
        self.assertEqual([x.args[0] for x in sleep.call_args_list], [1, 2])

    @patch.object(closer.time, "sleep")
    @patch.object(closer, "urlopen")
    def test_rate_limit_honors_bounded_retry_after(self, send, sleep):
        send.side_effect = [self.http_error(429, {"Retry-After": "7"}), self.response({})]
        self.api.request("GET", self.endpoint)
        sleep.assert_called_once_with(7)

    @patch.object(closer.time, "sleep")
    @patch.object(closer, "urlopen")
    def test_terminal_errors_and_long_cooldowns_are_not_retried(self, send, sleep):
        for error in [self.http_error(401), self.http_error(403), self.http_error(404),
                      self.http_error(429, {"Retry-After": "3600"})]:
            with self.subTest(code=error.code):
                send.reset_mock()
                send.side_effect = error
                with self.assertRaises(HTTPError):
                    self.api.request("GET", self.endpoint)
                send.assert_called_once()
        sleep.assert_not_called()

    @patch.object(closer.time, "sleep")
    @patch.object(closer, "urlopen")
    def test_exhaustion_is_bounded_and_never_returns_success(self, send, sleep):
        send.side_effect = TimeoutError("synthetic timeout")
        with self.assertRaises(TimeoutError):
            self.api.request("GET", self.endpoint)
        self.assertEqual(send.call_count, 3)
        self.assertEqual(sleep.call_count, 2)
        self.assertTrue(all(call.kwargs["timeout"] == 15 for call in send.call_args_list))

    @patch.object(closer.time, "sleep")
    @patch.object(closer, "urlopen")
    def test_body_disconnect_retries_read_but_never_replays_comment(self, send, sleep):
        for error in [IncompleteRead(b"partial synthetic response"), ConnectionResetError()]:
            with self.subTest(error=type(error).__name__):
                broken = self.response({})
                broken.__enter__.return_value = Mock()
                broken.__enter__.return_value.read.side_effect = error
                send.reset_mock()
                send.side_effect = [broken, self.response({"ok": True})]
                self.assertEqual(self.api.request("GET", self.endpoint), {"ok": True})
                self.assertEqual(send.call_count, 2)
                send.reset_mock()
                send.side_effect = [broken]
                with self.assertRaises(type(error)):
                    self.api.request("POST", self.endpoint, {"body": "synthetic"})
                send.assert_called_once()

    @patch.object(closer.time, "sleep")
    @patch.object(closer, "urlopen")
    def test_ambiguous_comment_and_close_responses_are_never_replayed(self, send, sleep):
        for method in ["POST", "PATCH"]:
            with self.subTest(method=method):
                send.reset_mock()
                send.side_effect = URLError("response lost after server committed")
                with self.assertRaises(URLError):
                    self.api.request(method, self.endpoint, {"synthetic": True})
                send.assert_called_once()
        sleep.assert_not_called()

    @patch.object(closer.time, "sleep")
    @patch.object(closer, "urlopen")
    def test_only_known_review_graphql_query_can_retry_post(self, send, sleep):
        value = {"repository": {"synthetic": True}}
        send.side_effect = [self.http_error(502), self.response({"data": value})]
        self.assertEqual(self.api.graphql(closer.REVIEW_QUERY, {}), value)
        self.assertEqual(send.call_count, 2)
        send.reset_mock()
        sleep.reset_mock()
        send.side_effect = self.http_error(503)
        with self.assertRaises(HTTPError):
            self.api.graphql("mutation { synthetic }", {})
        send.assert_called_once()
        sleep.assert_not_called()

    @patch.object(closer, "GitHub")
    @patch.object(closer, "close_if_ready")
    @patch.dict(closer.os.environ, {"GITHUB_SHA": "", "GH_TOKEN": "synthetic", "GITHUB_REPOSITORY": closer.SAFE_REPO})
    def test_one_unavailable_issue_does_not_skip_others_and_fails_workflow(self, close, github):
        github.return_value.request.return_value = {"commit": {"sha": "f" * 40}}
        def close_result(api, issue, *args):
            if issue == 58:
                raise URLError("synthetic outage")
            return {"issue": issue, "status": "open/not-eligible"}

        close.side_effect = close_result
        expected_issues = len(json.loads(closer.EVIDENCE.read_text(encoding="utf-8"))["issues"])
        with patch("builtins.print") as output:
            self.assertEqual(closer.main(), 1)
        self.assertEqual(close.call_count, expected_issues)
        report = json.loads(output.call_args.args[0])
        self.assertEqual(report["issues"][0]["status"], "open/verification-blocked")
        self.assertIn("hourly", report["issues"][0]["next_action"])

    @patch.object(closer, "GitHub")
    @patch.object(closer, "close_if_ready")
    @patch.dict(closer.os.environ, {"GITHUB_SHA": "", "GH_TOKEN": "synthetic", "GITHUB_REPOSITORY": closer.SAFE_REPO})
    def test_incomplete_acceptance_remains_normal_successful_evaluation(self, close, github):
        github.return_value.request.return_value = {"commit": {"sha": "f" * 40}}
        close.return_value = {"status": "open/not-eligible"}
        with patch("builtins.print"):
            self.assertEqual(closer.main(), 0)
