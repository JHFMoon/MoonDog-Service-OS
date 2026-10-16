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


if __name__ == "__main__":
    unittest.main()
