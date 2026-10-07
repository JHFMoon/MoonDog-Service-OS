from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SecurityWorkflowTests(unittest.TestCase):
    def test_publication_check_covers_all_pushes_and_recurs(self):
        text = (ROOT / ".github/workflows/publication-check.yml").read_text(encoding="utf-8")
        self.assertIn("  push:\n", text)
        self.assertNotIn("branches: [main]", text)
        self.assertIn("  workflow_dispatch:\n", text)
        self.assertIn("  schedule:\n", text)
        self.assertIn("fetch-depth: 0", text)
        self.assertIn("git fetch --force --tags origin '+refs/heads/*:refs/remotes/origin/*'", text)
        self.assertIn("python3 scripts/audit_git_history.py", text)
        self.assertIn("name: Publication Check", text)

    def test_release_and_pages_recheck_full_history(self):
        for path in (
            ".github/workflows/stable-release.yml",
            ".github/workflows/offline-distribution.yml",
        ):
            text = (ROOT / path).read_text(encoding="utf-8")
            self.assertIn("fetch-depth: 0", text)
            self.assertIn("git fetch --force --tags origin '+refs/heads/*:refs/remotes/origin/*'", text)
            self.assertIn("python3 scripts/check_publication.py", text)
            self.assertIn("python3 scripts/audit_git_history.py", text)

    def test_public_boundary_blocks_common_sensitive_binary_formats(self):
        text = (ROOT / "scripts/check_publication.py").read_text(encoding="utf-8")
        for suffix in ('.doc', '.docx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.webp', '.heic'):
            self.assertIn(f'"{suffix}"', text)


if __name__ == "__main__":
    unittest.main()
