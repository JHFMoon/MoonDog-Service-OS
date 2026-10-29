"""Regression tests for the trusted, App-authenticated Beta release path."""
from pathlib import Path
import unittest

from scripts.guarded_merge_policy import has_accepted_pr_author
from scripts.beta_release_queue import select_next_runtime_pr

ROOT = Path(__file__).resolve().parents[1]
MERGE = ROOT / ".github/workflows/guarded-pr-merge.yml"
PACKAGE = ROOT / ".github/workflows/prepare-beta-package.yml"
REPO = "JHFMoon/MoonDog-Service-OS"


class BetaPipelineTests(unittest.TestCase):
    def test_runtime_candidate_is_built_inside_the_reviewed_source_pr(self):
        text = PACKAGE.read_text(encoding="utf-8")
        self.assertIn("pull_request_target:", text)
        self.assertIn("group: prepare-beta-package-${{ github.repository }}", text)
        self.assertIn("cancel-in-progress: false", text)
        self.assertIn("types: [opened, reopened, synchronize, ready_for_review, edited]", text)
        self.assertIn('compare/$MAIN_SHA...$HEAD_SHA', text)
        self.assertIn('$MERGE_BASE\" != \"$MAIN_SHA', text)
        self.assertIn("Check out trusted packaging logic from the reviewed base", text)
        self.assertIn("Check out candidate as untrusted data", text)
        self.assertIn("untrusted data", text)
        self.assertIn("scripts/build_beta_package.py", text)
        self.assertIn("Push package commit to the same reviewed PR", text)
        self.assertIn("GH_TOKEN: ${{ steps.release-app.outputs.token }}", text)
        package_token = text.split("id: release-app", 1)[1].split("Push package commit", 1)[0]
        self.assertIn("permission-contents: write", package_token)
        self.assertIn("permission-issues: write", package_token)
        self.assertIn("permission-pull-requests: write", package_token)
        self.assertIn("actions/create-github-app-token@67018539274d69449ef7c02e8e71183d1719ab42", text)
        self.assertIn('secrets.MOONDOG_RELEASE_APP_ID', text)
        self.assertIn('secrets.MOONDOG_RELEASE_APP_PRIVATE_KEY', text)
        self.assertIn('git -C candidate -c http.https://github.com/.extraheader=', text)
        self.assertIn("push origin \"HEAD:$HEAD_BRANCH\"", text)
        self.assertNotIn("workflow_dispatch:", text)
        self.assertNotIn("gh workflow run", text)
        self.assertNotIn("statuses:", text)
        self.assertNotIn("api -X POST \"repos/$REPO/statuses/", text)
        self.assertNotIn("for attempt in {1..", text)

    def test_only_exact_configured_same_repo_package_app_is_accepted(self):
        base = {
            "user": {"login": "moondog-release[bot]"},
            "author_association": "CONTRIBUTOR",
            "head": {"repo": {"full_name": REPO}},
            "body": "MoonDog-Automation-Package: yes",
        }
        self.assertTrue(has_accepted_pr_author(base, REPO, "moondog-release[bot]"))
        self.assertFalse(has_accepted_pr_author(base, REPO, "other-release[bot]"))
        self.assertFalse(has_accepted_pr_author(
            {**base, "user": {"login": "untrusted[bot]"}}, REPO, "moondog-release[bot]"
        ))
        self.assertFalse(has_accepted_pr_author(
            {**base, "head": {"repo": {"full_name": "attacker/MoonDog-Service-OS"}}},
            REPO,
            "moondog-release[bot]",
        ))
        self.assertFalse(has_accepted_pr_author(
            {**base, "body": "> MoonDog-Automation-Package: yes"},
            REPO,
            "moondog-release[bot]",
        ))

    def test_guard_rechecks_exact_head_and_waits_for_real_events(self):
        text = MERGE.read_text(encoding="utf-8")
        self.assertIn('github.event.workflow_run.event == \'pull_request\'', text)
        self.assertIn("commits/$HEAD_SHA/check-runs", text)
        self.assertIn("github.event.workflow_run", text)
        self.assertIn("app", text)
        self.assertIn("15368", text)
        self.assertIn("steps.proof.outputs.ready == 'true'", text)
        self.assertIn("pulls/$PR_NUMBER/update-branch", text)
        self.assertIn('gh api -X PUT "repos/$REPO/pulls/$PR_NUMBER/merge"', text)
        self.assertIn("pipeline_guard.py check-paths", text)
        self.assertIn("merge-review-state", text)
        self.assertNotIn("workflow_dispatch", text)
        self.assertNotIn("gh workflow run", text)
        self.assertNotIn("statuses/$HEAD_SHA", text)
        self.assertNotIn("sleep ", text)
        self.assertNotIn("for attempt in {1..", text)


    def test_beta_version_reservation_serializes_runtime_prs_until_merge(self):
        policy = {
            "schema_version": 1,
            "standing_authorization": "authorized",
            "scope": "all_existing_and_future_pull_requests",
            "stable_publication": "existing-stable-release-workflow-only",
        }
        def pr(number, created, paths, *, state="open", draft=False, repo=REPO):
            return {
                "number": number,
                "created_at": created,
                "state": state,
                "draft": draft,
                "author_association": "OWNER",
                "body": "",
                "base": {"ref": "main"},
                "head": {"sha": f"{number:040x}", "repo": {"full_name": repo}},
            }, paths

        older, older_paths = pr(600, "2026-10-28T10:00:00Z", ["assets/app.js"])
        newer, newer_paths = pr(601, "2026-10-28T11:00:00Z", ["assets/styles.css"])
        paths = {600: older_paths, 601: newer_paths}
        self.assertEqual(
            select_next_runtime_pr(
                [newer, older], paths, repository=REPO, package_bot_login="release[bot]", policy=policy
            )["number"],
            600,
        )
        self.assertEqual(
            select_next_runtime_pr(
                [newer], {601: newer_paths}, repository=REPO, package_bot_login="release[bot]", policy=policy
            )["number"],
            601,
        )

    def test_beta_reservation_ignores_docs_drafts_forks_and_protected_paths(self):
        policy = {
            "schema_version": 1,
            "standing_authorization": "authorized",
            "scope": "all_existing_and_future_pull_requests",
            "stable_publication": "existing-stable-release-workflow-only",
        }
        def pr(number, created, *, state="open", draft=False, repo=REPO):
            return {
                "number": number,
                "created_at": created,
                "state": state,
                "draft": draft,
                "author_association": "OWNER",
                "body": "",
                "base": {"ref": "main"},
                "head": {"sha": f"{number:040x}", "repo": {"full_name": repo}},
            }
        prs = [
            pr(590, "2026-10-28T08:00:00Z"),
            pr(591, "2026-10-28T08:10:00Z", draft=True),
            pr(592, "2026-10-28T08:20:00Z", repo="fork/MoonDog-Service-OS"),
            pr(593, "2026-10-28T08:30:00Z"),
            pr(594, "2026-10-28T08:40:00Z", state="closed"),
        ]
        paths = {
            590: ["README.md"],
            591: ["assets/app.js"],
            592: ["assets/app.js"],
            593: [".github/workflows/prepare-beta-package.yml", "assets/app.js"],
            594: ["assets/app.js"],
        }
        self.assertEqual(
            select_next_runtime_pr(
                prs, paths, repository=REPO, package_bot_login="release[bot]", policy=policy
            ),
            None,
        )


    def test_beta_builder_keeps_reviewed_commit_notes_and_stable_isolation(self):
        workflow = PACKAGE.read_text(encoding="utf-8")
        builder = (ROOT / "scripts/build_beta_package.py").read_text(encoding="utf-8")
        self.assertIn("Verified automated Beta from reviewed source.", builder)
        self.assertIn("Stable manifest changed; Beta preparation refuses Stable promotion", builder)
        self.assertIn("Automatic Beta preparation refuses migrations", builder)
        self.assertIn("No Workspace migration; Stable remains unchanged.", workflow)
        self.assertIn("Stable manifest changes are out of scope", MERGE.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
