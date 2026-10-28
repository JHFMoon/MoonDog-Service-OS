"""Verify runtime PRs reserve Beta versions sequentially through merge."""
import unittest

from scripts.beta_release_queue import select_next_runtime_pr


REPO = "JHFMoon/MoonDog-Service-OS"
POLICY = {
    "schema_version": 1,
    "standing_authorization": "authorized",
    "scope": "all_existing_and_future_pull_requests",
    "stable_publication": "existing-stable-release-workflow-only",
}


def pr(number, created, *, state="open", draft=False, repo=REPO, base="main"):
    return {
        "number": number,
        "created_at": created,
        "state": state,
        "draft": draft,
        "author_association": "OWNER",
        "body": "",
        "base": {"ref": base},
        "head": {"sha": f"{number:040x}", "repo": {"full_name": repo}},
    }


class BetaReleaseQueueTests(unittest.TestCase):
    def test_oldest_authorized_runtime_pr_owns_the_candidate_version(self):
        earlier = pr(590, "2026-10-28T10:00:00Z")
        later = pr(591, "2026-10-28T11:00:00Z")
        paths = {590: ["assets/app.js"], 591: ["assets/styles.css"]}
        selected = select_next_runtime_pr(
            [later, earlier],
            paths,
            repository=REPO,
            package_bot_login="release[bot]",
            policy=POLICY,
        )
        self.assertEqual(selected["number"], 590)

    def test_next_pr_becomes_owner_only_after_earlier_pr_merges(self):
        later = pr(591, "2026-10-28T11:00:00Z")
        self.assertEqual(
            select_next_runtime_pr(
                [later],
                {591: ["assets/app.js"]},
                repository=REPO,
                package_bot_login="release[bot]",
                policy=POLICY,
            )["number"],
            591,
        )

    def test_docs_forks_drafts_and_protected_workflows_do_not_reserve_beta(self):
        prs = [
            pr(580, "2026-10-28T08:00:00Z"),
            pr(581, "2026-10-28T08:10:00Z", draft=True),
            pr(582, "2026-10-28T08:20:00Z", repo="fork/MoonDog-Service-OS"),
            pr(583, "2026-10-28T08:30:00Z"),
            pr(584, "2026-10-28T08:40:00Z", state="closed"),
            pr(585, "2026-10-28T08:50:00Z", base="release"),
        ]
        paths = {
            580: ["README.md"],
            581: ["assets/app.js"],
            582: ["assets/app.js"],
            583: [".github/workflows/prepare-beta-package.yml", "assets/app.js"],
            584: ["assets/app.js"],
            585: ["assets/app.js"],
        }
        self.assertIsNone(
            select_next_runtime_pr(
                prs,
                paths,
                repository=REPO,
                package_bot_login="release[bot]",
                policy=POLICY,
            )
        )


if __name__ == "__main__":
    unittest.main()
