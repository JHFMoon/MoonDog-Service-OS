"""Regression guard for Beta packaging after trusted GitHub-token merges."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MERGE = ROOT / ".github/workflows/guarded-pr-merge.yml"
PACKAGE = ROOT / ".github/workflows/prepare-beta-package.yml"


class BetaDispatchTests(unittest.TestCase):
    def test_verified_merge_dispatches_exact_commit(self):
        text = MERGE.read_text(encoding="utf-8")
        confirm = 'test "$MAIN_SHA" = "$MERGED_SHA"'
        dispatch = 'gh workflow run prepare-beta-package.yml --repo "$REPO" --ref main -f reviewed_commit="$MERGED_SHA"'
        self.assertIn(confirm, text)
        self.assertIn(dispatch, text)
        self.assertLess(text.index(confirm), text.index(dispatch))
        self.assertIn('gh workflow run publication-check.yml --repo "$REPO" --ref main', text)

    def test_existing_trusted_packager_accepts_reviewed_commit_and_guards_stable(self):
        text = PACKAGE.read_text(encoding="utf-8")
        self.assertIn('workflow_dispatch:', text)
        self.assertIn('reviewed_commit:', text)
        self.assertIn('TARGET_SHA="${REQUESTED_COMMIT:-$MAIN_SHA}"', text)
        self.assertIn('git merge-base --is-ancestor "$TARGET_SHA" "$MAIN_SHA"', text)
        self.assertIn("if main.get('stable') != package.get('stable'):", text)
        self.assertIn('gh workflow run clean-install-proof.yml', text)


    def test_postmerge_beta_uses_reviewed_commit_subject_instead_of_generic_notes(self):
        workflow = PACKAGE.read_text(encoding="utf-8")
        builder = (ROOT / "scripts/build_beta_package.py").read_text(encoding="utf-8")
        self.assertNotIn(
            '--release-notes "Automatically packaged merged runtime from current main; Stable unchanged."',
            workflow,
            "post-merge release notes must describe the actual reviewed change",
        )
        self.assertIn('notes = args.release_notes.strip() or (', builder)
        self.assertIn('subject = git_value(root, "%s")', builder)
        self.assertIn('Verified automated Beta from reviewed source.', builder)
        self.assertIn('echo "reviewed_sha=$TARGET_SHA" >> "$GITHUB_OUTPUT"', workflow)
        self.assertIn('REVIEWED_SHA: ${{ steps.detect.outputs.reviewed_sha }}', workflow)
        self.assertIn('git cat-file -e "$REVIEWED_SHA^{commit}"', workflow)
        self.assertIn('git show -s --format=%s "$REVIEWED_SHA"', workflow)
        self.assertIn('--release-notes "$REVIEWED_SUBJECT.', workflow)
        self.assertIn('Stable remains $STABLE_VERSION.', workflow)
        self.assertLess(workflow.index('git merge-base --is-ancestor "$TARGET_SHA" "$MAIN_SHA"'),
                        workflow.index('echo "reviewed_sha=$TARGET_SHA" >> "$GITHUB_OUTPUT"'),
                        "Only the validated reviewed commit may be used for release notes")


    def test_trusted_beta_packager_reuses_identical_open_candidate_and_refreshes_additively(self):
        workflow = PACKAGE.read_text(encoding="utf-8")
        helper = ROOT / "scripts/beta_candidate_reuse.py"
        self.assertTrue(helper.exists(), "candidate reuse must use a tested fail-closed selector")
        self.assertIn("python3 scripts/beta_candidate_reuse.py candidates", workflow)
        self.assertIn("python3 scripts/beta_candidate_reuse.py select", workflow)
        self.assertIn("update-branch", workflow)
        self.assertIn('expected_head_sha="$PACKAGE_HEAD"', workflow)
        self.assertIn("existing_pr_number=$EXISTING_PR_NUMBER", workflow)
        self.assertIn("existing_pr_number == ''", workflow)
        self.assertIn("for attempt in {1..180}; do", workflow)
        self.assertIn('gh api -X POST "repos/$REPO/statuses/$PACKAGE_HEAD"', workflow)
        self.assertIn('if main.get("stable") != candidate.get("stable"):', helper.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
