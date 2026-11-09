"""Ensure pre-package CI noise is deferred without weakening exact-head gates."""
from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile
import textwrap
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
PRECHECK = "python3 scripts/preflight_beta_runtime.py"


class PendingPackageWorkflowContract(unittest.TestCase):
    def test_required_pr_checks_remain_strict_after_bounded_supersession_wait(self):
        for name in ("publication-check.yml", "clean-install-proof.yml"):
            with self.subTest(workflow=name):
                source = (ROOT / ".github" / "workflows" / name).read_text()
                probe = source.index("id: beta-package-probe")
                wait = source.index("run: sleep 120")
                strict = source.index("- name: Fail fast until trusted Beta package matches runtime")
                self.assertLess(probe, wait)
                self.assertLess(wait, strict)
                self.assertIn("continue-on-error: true", source[probe:wait])
                self.assertIn("steps.beta-package-probe.outcome == 'failure'", source[probe:wait])
                self.assertIn("if: github.event_name == 'pull_request'", source[strict:strict + 160])
                self.assertIn(PRECHECK, source[strict:strict + 240])
                self.assertNotIn("continue-on-error", source[strict:strict + 260])
                self.assertEqual(source.count(PRECHECK), 2)
                self.assertIn("cancel-in-progress:", source)
                cancel = source.split("cancel-in-progress:", 1)[1].splitlines()[0].strip()
                self.assertIn(cancel, ("true", "${{ github.event_name == 'pull_request' }}"))
                # A missing or compromised package must still fail the final gate.
                self.assertIn("Fail fast until trusted Beta package matches runtime", source)

    def test_guarded_merge_requires_package_ready_and_final_exact_head_verification(self):
        source = (ROOT / ".github/workflows/guarded-pr-merge.yml").read_text()
        proof = source.split("- name: Evaluate exact-head verification and authorization evidence", 1)[1]
        self.assertIn("steps.package-parity.outputs.ready == 'true'", proof[:400])
        squash = source.split("- name: Squash merge verified current PR", 1)[1]
        self.assertIn("steps.proof.outputs.ready == 'true'", squash[:320])
        self.assertIn("Final guarded merge refused: exact-head", squash)
        self.assertIn("Final guarded merge refused: protected change requires the manual merge route", squash)

    def test_real_guard_package_probe_is_pending_for_mismatch_and_ready_only_for_exact_parity(self):
        source = (ROOT / ".github/workflows/guarded-pr-merge.yml").read_text()
        block = source.split("- name: Verify Beta package matches the exact PR runtime", 1)[1]
        block = block.split("- name: Evaluate exact-head verification and authorization evidence", 1)[0]
        script = block.split("PYTHONPATH=. python3 - <<'PY'\n", 1)[1].split("\n          PY", 1)[0]
        code = compile(textwrap.dedent(script), "<guarded-package-parity>", "exec")

        def execute(result):
            fake = types.ModuleType("scripts.build_beta_package")
            def mismatches(_root):
                if isinstance(result, BaseException):
                    raise result
                return result
            fake.current_beta_runtime_mismatches = mismatches
            with tempfile.TemporaryDirectory() as directory:
                output_path = Path(directory) / "outputs"
                output_path.touch()
                with patch.dict(sys.modules, {"scripts.build_beta_package": fake}), patch.dict(
                    os.environ, {"GITHUB_OUTPUT": str(output_path)}
                ):
                    exec(code, {"__name__": "__main__"})
                return output_path.read_text()

        self.assertEqual(execute(["assets/freshness.js"]), "ready=false\n",
                         "unpackaged source must stay ineligible for guarded merge")
        self.assertEqual(execute([]), "ready=true\n",
                         "only exact packaged parity permits subsequent proof evaluation")
        with self.assertRaisesRegex(SystemExit, "untrusted package"):
            execute(SystemExit("untrusted package"))


if __name__ == "__main__":
    unittest.main()
