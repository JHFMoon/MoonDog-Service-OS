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

    def test_guarded_merge_and_offline_distribution_are_hands_off_safe(self):
        merge = (ROOT / ".github/workflows/guarded-pr-merge.yml").read_text(encoding="utf-8")
        self.assertIn('workflows: ["Publication check"]', merge)
        self.assertIn("MoonDog-Auto-Merge: yes", merge)
        self.assertIn("Clean Install Proof", merge)
        self.assertIn("workflow_dispatch", merge)
        self.assertIn('pulls?state=open&head=$OWNER:$HEAD_BRANCH', merge)
        self.assertIn("Stable manifest changed and requires James explicit approval", merge)
        self.assertIn('pulls/$PR_NUMBER/update-branch', merge)
        self.assertIn('pulls/$PR_NUMBER/merge', merge)
        self.assertIn("-f merge_method=squash", merge)
        self.assertIn("all exact-head Publication and Clean Install runs to settle", merge)
        self.assertIn("Required status check.*in progress", merge)

        prepare = (ROOT / ".github/workflows/prepare-beta-package.yml").read_text(encoding="utf-8")
        self.assertIn("pull_request_target", prepare)
        self.assertIn("MoonDog-Auto-Merge: yes", prepare)
        self.assertIn("without executing candidate code", prepare)
        self.assertIn("trusted/scripts/build_beta_package.py", prepare)
        self.assertIn("--base-root trusted", prepare)
        self.assertIn("actions: write", prepare)
        self.assertIn('git push origin "HEAD:$HEAD_BRANCH"', prepare)
        self.assertIn("gh workflow run publication-check.yml", prepare)
        self.assertIn("gh workflow run clean-install-proof.yml", prepare)
        self.assertIn("pull-requests: write", prepare)
        self.assertIn("Wait for generated-head proof and merge", prepare)
        self.assertIn('compare/main...$CURRENT_HEAD', prepare)
        self.assertIn('pulls/$PR_NUMBER/merge', prepare)
        self.assertIn("Generated-head merge refused: Stable changed.", prepare)
        self.assertIn("all generated-head checks to settle", prepare)
        self.assertIn("generated-head status context", prepare)
        builder = (ROOT / "scripts/build_beta_package.py").read_text(encoding="utf-8")
        self.assertIn("Stable manifest changed; Beta preparation refuses Stable promotion", builder)
        self.assertIn("Automatic Beta preparation refuses migrations", builder)
        self.assertIn("merge_text", builder)
        self.assertIn("changed_runtime_paths", builder)
        self.assertIn("next_beta", builder)
        self.assertIn("current Beta preview", builder)

        offline = (ROOT / ".github/workflows/offline-distribution.yml").read_text(encoding="utf-8")
        self.assertIn("Check out immutable Stable source", offline)
        self.assertIn('git checkout --detach "$TAG"', offline)
        self.assertIn("python3 scripts/build_distribution.py --check-source", offline)
        self.assertLess(offline.index("Check out immutable Stable source"), offline.index("Build deterministic clean-install ZIP"))

    def test_public_boundary_blocks_common_sensitive_binary_formats(self):
        text = (ROOT / "scripts/check_publication.py").read_text(encoding="utf-8")
        for suffix in ('.doc', '.docx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.webp', '.heic'):
            self.assertIn(f'"{suffix}"', text)


if __name__ == "__main__":
    unittest.main()
