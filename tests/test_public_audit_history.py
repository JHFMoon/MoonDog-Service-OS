"""Synthetic integration checks for redacted public-history scanner."""
import pathlib
import runpy
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HISTORY_AUDIT = ROOT / "scripts" / "audit_public_git_history.py"
PUBLIC_SURFACE_AUDIT = ROOT / "scripts" / "audit_public_surfaces.py"


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args], stderr=subprocess.DEVNULL)


class RedactedHistoryAuditTests(unittest.TestCase):
    def init_repo(self):
        td = tempfile.TemporaryDirectory(prefix="moondog-public-audit-test-")
        repo = pathlib.Path(td.name)
        subprocess.check_call(["git", "init", "-q", str(repo)])
        git(repo, "config", "user.name", "Synthetic Example")
        git(repo, "config", "user.email", "bot@noreply.github.com")
        return td, repo

    def audit(self, repo):
        return subprocess.run(
            ["python3", str(HISTORY_AUDIT)],
            cwd=repo,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=60,
        )

    def test_accepts_legacy_github_noreply_commit_identity(self):
        td, repo = self.init_repo()
        try:
            (repo / "README.md").write_text("Synthetic example, no real operational data.\n")
            git(repo, "add", ".")
            git(repo, "commit", "-qm", "Synthetic public commit")
            result = self.audit(repo)
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertNotIn("commit_identity_email:", result.stdout)
        finally:
            td.cleanup()

    def test_accepts_github_webflow_system_identity(self):
        td, repo = self.init_repo()
        try:
            git(repo, "config", "user.email", "web-flow@github.com")
            (repo / "README.md").write_text("Synthetic public source.\\n")
            git(repo, "add", ".")
            git(repo, "commit", "-qm", "Synthetic public web commit")
            result = self.audit(repo)
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        finally:
            td.cleanup()

    def test_publication_history_scan_recognizes_only_exact_github_system_emails(self):
        scan = runpy.run_path(str(ROOT / "scripts" / "audit_git_history.py"))["pii_categories"]
        self.assertNotIn("non-example email address", scan(b"web-flow@github.com"))
        self.assertNotIn("non-example email address", scan(b"noreply@github.com"))
        self.assertIn("non-example email address", scan(b"personal" + b"@github.com"))
        self.assertIn("non-example email address", scan(b"customer" + b"@dealership.invalid"))

    def test_publication_history_audit_exempts_only_exact_test_bytecode(self):
        audit = runpy.run_path(str(ROOT / "scripts" / "audit_git_history.py"))
        oid = "1fc52a8c97815235c558290422f0aff000ccf125"
        path = "tests/__pycache__/test_check_publication.cpython-314.pyc"
        size = int(audit["run"]("git", "cat-file", "-s", oid))
        self.assertEqual([], audit["scan_blob"](oid, path, size))
        self.assertIn("blocked secret/target content", audit["scan_blob"](oid, "fixture.pyc", size))

    def test_public_history_audit_exempts_exact_synthetic_test_blobs_only(self):
        td, repo = self.init_repo()
        try:
            path = repo / "test-fixture.pyc"
            blob = git(ROOT, "cat-file", "blob", "1fc52a8c97815235c558290422f0aff000ccf125")
            path.write_bytes(blob)
            git(repo, "add", ".")
            git(repo, "commit", "-qm", "Add exact reviewed synthetic test fixture")
            result = self.audit(repo)
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertIn("allowed_reviewed_synthetic_test_blob: 1", result.stdout)

            path.write_bytes(blob + b" ")
            git(repo, "add", ".")
            git(repo, "commit", "-qm", "Change exact fixture bytes")
            result = self.audit(repo)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("provider_token: 1", result.stdout)
        finally:
            td.cleanup()

    def test_inspects_historical_name_when_identical_blob_is_renamed(self):
        td, repo = self.init_repo()
        try:
            forbidden = repo / "Workspace"
            forbidden.mkdir()
            (forbidden / "private.txt").write_text("Synthetic harmless placeholder.\n")
            git(repo, "add", ".")
            git(repo, "commit", "-qm", "Create synthetic forbidden path")
            git(repo, "mv", "Workspace/private.txt", "public.txt")
            git(repo, "commit", "-qm", "Rename without changing blob bytes")
            result = self.audit(repo)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("restricted_path:", result.stdout)
            self.assertNotIn("Workspace/private.txt", result.stdout)
        finally:
            td.cleanup()

    def test_new_synthetic_vin_blob_still_fails_closed(self):
        """A freshly created valid-looking VIN must not inherit historical exceptions."""
        from importlib.util import module_from_spec, spec_from_file_location
        spec = spec_from_file_location("vin_triage_for_test", ROOT / "scripts" / "audit_vin_provenance.py")
        helper = module_from_spec(spec)
        spec.loader.exec_module(helper)
        base = "1HGCM826" + "0" + "3A004352"
        total = sum(helper.VALUES[ch] * weight for ch, weight in zip(base, helper.WEIGHTS))
        test_vin = base[:8] + ("X" if total % 11 == 10 else str(total % 11)) + base[9:]
        td, repo = self.init_repo()
        try:
            (repo / "fixture.txt").write_text("Synthetic example " + test_vin + "\\n")
            git(repo, "add", ".")
            git(repo, "commit", "-qm", "New synthetic fixture must remain blocked")
            result = self.audit(repo)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("valid_vin:", result.stdout)
            self.assertNotIn(test_vin, result.stdout)
        finally:
            td.cleanup()

    def test_both_public_scanners_compile(self):
        for path in (HISTORY_AUDIT, PUBLIC_SURFACE_AUDIT):
            compile(path.read_text(encoding="utf-8"), str(path), "exec")

    def test_privileged_public_audit_does_not_execute_on_pull_requests(self):
        workflow = (ROOT / ".github" / "workflows" / "public-history-safety-audit.yml").read_text()
        self.assertNotIn("\n  pull_request:", workflow.split("\npermissions:", 1)[0])


if __name__ == "__main__":
    unittest.main()
