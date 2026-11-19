import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import verify_repair_center_gate as gate  # noqa: E402

SHA = "a" * 40
REPO = gate.REPO


def record(status="completed", conclusion="success", sha=SHA, event="push", run_id=3):
    return {"head_sha": sha, "event": event, "status": status,
            "conclusion": conclusion, "created_at": "2026-11-19T02:00:00Z", "id": run_id}


def mock_api(endpoint):
    if endpoint.endswith("/git/ref/heads/main"):
        return {"object": {"sha": SHA}}
    return {"workflow_runs": [record()]}


class RepairCenterGateTests(unittest.TestCase):
    def test_requires_both_exact_head_successful_runs(self):
        with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF_NAME": "main"}), \
             patch.object(gate, "gh_api", side_effect=mock_api), \
             patch.object(gate.subprocess, "run") as proc:
            proc.return_value.stdout = SHA + "\n"
            gate.verify(REPO, SHA, attempts=1)

    def test_rejects_prior_success_for_new_commit(self):
        run = record(sha="b" * 40)
        self.assertEqual(gate.choose_run([run], SHA), None)
        self.assertEqual(gate.run_state(None), "waiting")

    def test_rejects_latest_run_failure_instead_of_older_success(self):
        old = record(run_id=1)
        bad = record(conclusion="failure", run_id=2)
        self.assertEqual(gate.run_state(gate.choose_run([old, bad], SHA)), "failure")

    def test_rejects_pull_request_success_as_main_evidence(self):
        self.assertIsNone(gate.choose_run([record(event="pull_request")], SHA))

    def test_rejects_untrusted_automatic_trigger(self):
        with patch.dict(os.environ, {
            "GITHUB_EVENT_NAME": "workflow_run",
            "TRIGGER_HEAD_SHA": SHA, "TRIGGER_HEAD_BRANCH": "main",
            "TRIGGER_EVENT": "schedule", "TRIGGER_CONCLUSION": "success",
            "TRIGGER_NAME": "Public Repository History Safety Audit",
        }):
            with self.assertRaisesRegex(RuntimeError, "successful main push"):
                gate.verify_event(SHA)

    def test_rejects_stale_main_even_if_all_checks_pass(self):
        with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF_NAME": "main"}), \
             patch.object(gate, "gh_api", return_value={"object": {"sha": "b" * 40}}), \
             patch.object(gate.subprocess, "run") as proc:
            proc.return_value.stdout = SHA + "\n"
            with self.assertRaisesRegex(RuntimeError, "Main advanced"):
                gate.verify(REPO, SHA, attempts=1)

    def test_never_assumes_missing_or_in_progress_is_success(self):
        self.assertEqual(gate.run_state(record(status="in_progress", conclusion=None)), "waiting")
        self.assertEqual(gate.run_state(record(conclusion="cancelled")), "failure")


if __name__ == "__main__":
    unittest.main()
