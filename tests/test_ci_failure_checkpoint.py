"""Exercise the trusted failure-checkpoint step with synthetic GitHub responses."""
import json
from pathlib import Path
import textwrap
import unittest
from unittest.mock import Mock, call, patch
from tempfile import TemporaryDirectory


WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/guarded-pr-merge.yml"
REPO = "example/synthetic"
HEAD = "a" * 40
BRANCH = "fix/synthetic-check"
ROOT = f"repos/{REPO}"
RUN_PATH = f"{ROOT}/actions/runs/123"
PULL_PATH = f"{ROOT}/pulls/456"
COMMENTS_PATH = f"{ROOT}/issues/456/comments"
MARKER = "<!-- moondog-failed-proof:v1:123 -->"


class FailureCheckpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        cls.job = workflow.split("  report-failed-proof:\n", 1)[1].split("  advance-beta-queue:\n", 1)[0]
        code = cls.job.split("python3 - <<'PY'\n", 1)[1].split("\n          PY", 1)[0]
        cls.code = compile(textwrap.dedent(code), str(WORKFLOW), "exec")

    def setUp(self):
        self.run = {
            "name": "Publication check", "status": "completed", "conclusion": "failure",
            "event": "pull_request", "run_attempt": 1, "head_sha": HEAD,
            "head_repository": {"full_name": REPO}, "head_branch": BRANCH,
            "pull_requests": [],
        }
        self.pr = {
            "number": 456, "state": "open", "base": {"ref": "main"},
            "head": {"sha": HEAD, "ref": BRANCH, "repo": {"full_name": REPO}},
        }

    def run_reporter(self, responses):
        namespace = {"__name__": "test_reporter"}
        exec(self.code, namespace)
        api = Mock(side_effect=responses)
        namespace["api"] = api
        with patch.dict("os.environ", REPO=REPO, RUN_ID="123", RUN_ATTEMPT="1", RUN_HEAD=HEAD):
            namespace["main"]()
        return api

    def test_permissions_and_event_boundary(self):
        self.assertIn("github.event_name == 'workflow_run'", self.job)
        self.assertIn("github.event.workflow_run.event == 'pull_request'", self.job)
        self.assertIn("github.event.workflow_run.conclusion == 'failure'", self.job)
        self.assertIn("permissions:\n      actions: read\n      pull-requests: read\n      issues: write", self.job)
        for forbidden in ("actions/checkout", "secrets.", "download-artifact", "/merge", "/logs"):
            self.assertNotIn(forbidden, self.job)

    def test_unassociated_run_resolves_exact_pr_and_ignores_spoofed_marker(self):
        spoof = {"user": {"login": "untrusted"}, "body": MARKER}
        api = self.run_reporter([
            self.run, [[], [self.pr]], [[spoof], []], [{"jobs": []}], self.run, self.pr, {},
        ])
        self.assertIn(call("GET", f"{ROOT}/pulls", "--paginate", "--slurp",
                           "-f", "state=open", "-f", "base=main",
                           "-f", f"head=example:{BRANCH}", "-f", "per_page=100"), api.call_args_list)
        method, path, flag, body = api.call_args.args
        self.assertEqual((method, path, flag), ("POST", COMMENTS_PATH, "-f"))
        self.assertTrue(body.startswith(f"body={MARKER}\n"))
        self.assertIn(HEAD, body)
        self.assertIn("/actions/runs/123/attempts/1", body)

    def test_trusted_marker_on_later_page_prevents_duplicate(self):
        checkpoint = {"user": {"login": "github-actions[bot]"}, "body": f"{MARKER}\nExisting"}
        api = self.run_reporter([self.run, [[self.pr]], [[], [checkpoint]]])
        self.assertEqual(api.call_count, 3)

    def test_stale_head_or_attempt_cannot_post(self):
        updated_run = {**self.run, "run_attempt": 2, "conclusion": "success"}
        updated_pr = {**self.pr, "head": {**self.pr["head"], "sha": "b" * 40}}
        for final_responses, expected_calls in (([updated_run], 5), ([self.run, updated_pr], 6)):
            with self.subTest(final_responses=final_responses):
                api = self.run_reporter([self.run, [[self.pr]], [[]], [{"jobs": []}], *final_responses])
                self.assertEqual(api.call_count, expected_calls)
                self.assertTrue(all(entry.args[0] == "GET" for entry in api.call_args_list))

    def test_fork_or_nonunique_pr_match_cannot_post(self):
        fork = {**self.run, "head_repository": {"full_name": "fork/synthetic"}}
        self.assertEqual(self.run_reporter([fork]).call_count, 1)
        self.assertEqual(self.run_reporter([self.run, [[self.pr, self.pr]]]).call_count, 2)

    def test_package_preflight_failure_has_specific_next_step(self):
        step = {
            "name": "Fail fast until trusted Beta package matches runtime",
            "conclusion": "failure",
            "output": "synthetic log payload",
        }
        api = self.run_reporter([
            self.run, [[self.pr]], [[]], [{"jobs": [{"steps": [step]}]}], self.run, self.pr, {},
        ])
        body = api.call_args.args[-1]
        self.assertIn("Check Prepare Beta Package first", body)
        self.assertNotIn(step["output"], body)

    def test_transient_read_recovers_and_retries_are_bounded(self):
        namespace = {"__name__": "test_reporter"}
        exec(self.code, namespace)
        unavailable = Mock(returncode=1, stderr="gh: unavailable (HTTP 503)")
        success = Mock(returncode=0, stdout=json.dumps(self.run))
        with patch("subprocess.run", side_effect=[unavailable, success]) as gh, patch("time.sleep") as sleep:
            self.assertEqual(namespace["api"]("GET", RUN_PATH), self.run)
            self.assertEqual(gh.call_count, 2)
            sleep.assert_called_once_with(1)
        with patch("subprocess.run", return_value=unavailable) as gh, patch("time.sleep") as sleep:
            with self.assertRaisesRegex(SystemExit, "Checkpoint API GET failed"):
                namespace["api"]("GET", RUN_PATH)
            self.assertEqual(gh.call_count, 3)
            self.assertEqual(sleep.call_args_list, [call(1), call(2)])
        with patch("subprocess.run", return_value=unavailable) as gh, patch("time.sleep") as sleep:
            with self.assertRaisesRegex(SystemExit, r"Checkpoint API POST failed \(HTTP 503\)"):
                namespace["api"]("POST", COMMENTS_PATH)
            self.assertEqual(gh.call_count, 1)
            sleep.assert_not_called()

    def test_failed_post_emits_only_safe_status_never_api_message(self):
        namespace = {"__name__": "test_reporter"}
        exec(self.code, namespace)
        for status in ("403", "422", "500"):
            sensitive = "synthetic-secret-must-not-reach-logs"
            failed = Mock(returncode=1, stderr=f"gh: {sensitive} (HTTP {status})")
            with self.subTest(status=status), patch("subprocess.run", return_value=failed):
                with self.assertRaises(SystemExit) as error:
                    namespace["api"]("POST", COMMENTS_PATH)
                self.assertEqual(str(error.exception), f"Checkpoint API POST failed (HTTP {status}).")
                self.assertNotIn(sensitive, str(error.exception))

        malformed = Mock(returncode=1, stderr="gh: synthetic-secret-must-not-reach-logs")
        with patch("subprocess.run", return_value=malformed):
            with self.assertRaisesRegex(SystemExit, r"Checkpoint API POST failed \(HTTP unknown\)"):
                namespace["api"]("POST", COMMENTS_PATH)


    def test_denied_or_ambiguous_post_records_unverified_delivery_and_stays_failed(self):
        # Both an explicit denial and an ambiguous response must stay visibly
        # failed; never claim a comment was definitely absent or replay a POST.
        for status in (403, 503):
            with self.subTest(status=status), TemporaryDirectory() as tmp:
                summary_path = Path(tmp) / "summary.md"
                responses = [
                    self.run, [[self.pr]], [[]], [{"jobs": []}], self.run, self.pr,
                    SystemExit(f"Checkpoint API POST failed (HTTP {status})."),
                ]
                with patch.dict("os.environ", GITHUB_STEP_SUMMARY=str(summary_path)):
                    with self.assertRaisesRegex(SystemExit, f"POST failed \\(HTTP {status}\\)"):
                        api = self.run_reporter(responses)
                summary = summary_path.read_text(encoding="utf-8")
                self.assertIn("Actions-only fallback", summary)
                self.assertIn("PR comment delivery unverified", summary)
                self.assertIn(HEAD, summary)
                self.assertIn("/actions/runs/123/attempts/1", summary)
                self.assertIn(f"HTTP {status}", summary)
                self.assertNotIn("gh: ", summary)
                self.assertNotIn("NOT delivered", summary)

    def test_success_never_claims_fallback(self):
        with TemporaryDirectory() as tmp:
            summary_path = Path(tmp) / "summary.md"
            responses = [
                self.run, [[self.pr]], [[]], [{"jobs": []}], self.run, self.pr, {},
            ]
            with patch.dict("os.environ", GITHUB_STEP_SUMMARY=str(summary_path)):
                self.run_reporter(responses)
            self.assertFalse(summary_path.exists())


if __name__ == "__main__":
    unittest.main()
