"""Synthetic integration checks for redacted public-history scanner."""
import pathlib
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

    def test_both_public_scanners_compile(self):
        for path in (HISTORY_AUDIT, PUBLIC_SURFACE_AUDIT):
            compile(path.read_text(encoding="utf-8"), str(path), "exec")

    def test_privileged_public_audit_does_not_execute_on_pull_requests(self):
        workflow = (ROOT / ".github" / "workflows" / "public-history-safety-audit.yml").read_text()
        self.assertNotIn("\n  pull_request:", workflow.split("\npermissions:", 1)[0])


if __name__ == "__main__":
    unittest.main()
