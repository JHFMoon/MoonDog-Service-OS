import ast
from pathlib import Path
import re
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


    def test_ci_attribution_guard_blocks_misleading_trailer_only_in_new_commits(self):
        text = (ROOT / ".github/workflows/publication-check.yml").read_text(encoding="utf-8")
        name = "Reject falsely attributed CI co-authors in new commits"
        self.assertIn(name, text)
        section = text.split(name, 1)[1].split("      - name:", 1)[0]
        self.assertIn("PR_BASE_SHA:", section)
        self.assertIn("PR_HEAD_SHA:", section)
        self.assertIn('revision = f"{base}..{head}" if base and head else os.environ["GITHUB_SHA"]', section)
        self.assertIn('["git", "log", "--format=%B%x00", revision]', section)
        pattern_source = next(
            line.strip() for line in section.splitlines()
            if line.strip().startswith('r"(?im)^Co-authored-by:')
        )
        pattern = re.compile(ast.literal_eval(pattern_source))
        self.assertIsNotNone(pattern.search(
            "Publish Beta\n\nCo-authored-by: MoonDog CI <ci@users.noreply.github.com>\n"
        ))
        self.assertIsNotNone(pattern.search(
            "Co-Authored-By: CI <CI@USERS.NOREPLY.GITHUB.COM>\n"
        ))
        self.assertIsNone(pattern.search(
            "Co-authored-by: MoonDog Automation <41898282+github-actions[bot]@users.noreply.github.com>\n"
        ))
        self.assertIsNone(pattern.search(
            "Co-authored-by: Example Contributor <contributor@example.com>\n"
        ))

    def test_owner_bootstrap_status_requires_independent_proof(self):
        workflow = (ROOT / ".github/workflows/publication-check.yml").read_text(encoding="utf-8")
        self.assertIn("  actions: read", workflow)
        self.assertIn("  statuses: write", workflow)
        status_step = workflow.index("Publish owner bootstrap status only after clean-install proof")
        history_audit = workflow.index("python3 scripts/audit_git_history.py")
        self.assertLess(history_audit, status_step)
        bridge = workflow[status_step:]
        self.assertIn("github.event.pull_request.author_association == 'OWNER'", bridge)
        self.assertIn("github.event.pull_request.head.repo.full_name == github.repository", bridge)
        self.assertIn("github.event.pull_request.base.ref == 'main'", bridge)
        self.assertIn("repos/$REPO/commits/$HEAD_SHA/check-runs", bridge)
        self.assertIn('select(.name=="prove-clean-install")', bridge)
        self.assertIn('if [ "$CLEAN" = "success" ]; then', bridge)
        self.assertIn('-f context="Publication Check"', bridge)
        self.assertIn('statuses/$HEAD_SHA', bridge)

    def test_stable_release_directly_dispatches_offline_distribution(self):
        stable = (ROOT / ".github/workflows/stable-release.yml").read_text(encoding="utf-8")
        offline = (ROOT / ".github/workflows/offline-distribution.yml").read_text(encoding="utf-8")
        self.assertIn("actions: write", stable)
        self.assertIn("Dispatch verified Stable offline distribution", stable)
        self.assertIn("gh workflow run offline-distribution.yml", stable)
        self.assertNotIn('workflows: ["Publication check"]', offline)
        self.assertIn("  release:\n", offline)
        self.assertIn("  workflow_dispatch:\n", offline)

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
        self.assertIn("this PR changes Stable and requires James explicit approval", merge)
        self.assertIn("merge_base_commit.sha", merge)
        self.assertIn("Final guarded merge refused", merge)
        self.assertIn("PR is no longer based on current main", merge)
        self.assertIn("Final guarded merge refused: Stable invariant changed.", merge)
        self.assertIn("gh workflow run publication-check.yml", merge)
        self.assertIn('pulls/$PR_NUMBER/update-branch', merge)
        self.assertIn('pulls/$PR_NUMBER/merge', merge)
        self.assertIn("-f merge_method=squash", merge)
        self.assertIn("all exact-head Publication and Clean Install runs to settle", merge)
        self.assertIn("Required status check.*(in progress|expected)", merge)

        prepare = (ROOT / ".github/workflows/prepare-beta-package.yml").read_text(encoding="utf-8")
        self.assertIn("pull_request_target", prepare)
        self.assertIn("MoonDog-Auto-Merge: yes", prepare)
        self.assertIn("Refuse automatic changes to trusted proof/automation files", prepare)
        self.assertIn("trusted/scripts/pipeline_guard.py check-paths", prepare)
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
        self.assertIn("gh workflow run publication-check.yml", prepare)
        self.assertIn("statuses: write", prepare)
        self.assertIn('statuses/$CURRENT_HEAD', prepare)
        self.assertIn('-f context="Publication Check"', prepare)
        self.assertIn("Exact-head Publication Check and Clean Install Proof passed", prepare)
        self.assertIn("in progress|expected", prepare)
        builder = (ROOT / "scripts/build_beta_package.py").read_text(encoding="utf-8")
        self.assertIn("Stable manifest changed; Beta preparation refuses Stable promotion", builder)
        self.assertIn("Automatic Beta preparation refuses migrations", builder)
        self.assertIn("merge_text", builder)
        self.assertIn("changed_runtime_paths", builder)
        self.assertIn("next_beta", builder)
        self.assertIn("current Beta preview", builder)

        offline = (ROOT / ".github/workflows/offline-distribution.yml").read_text(encoding="utf-8")
        self.assertIn("Wait for matching Stable GitHub Release", offline)
        self.assertIn("Stable tag $TAG was not fetchable after retry window.", offline)
        self.assertIn("Check out immutable Stable source", offline)
        self.assertIn('git checkout --detach "$TAG"', offline)
        self.assertIn("python3 scripts/build_distribution.py --check-source", offline)
        self.assertLess(offline.index("Wait for matching Stable GitHub Release"), offline.index("Check out immutable Stable source"))
        self.assertLess(offline.index("Check out immutable Stable source"), offline.index("Build deterministic clean-install ZIP"))

    def test_generated_beta_merge_dispatches_post_merge_main_proof(self):
        workflow = (ROOT / ".github/workflows/prepare-beta-package.yml").read_text(encoding="utf-8")
        package_job = workflow.split("  package-unadvertised-main-runtime:", 1)[1]
        self.assertIn('test "$(jq -r \'.merged\' <<<"$RESULT")" = "true"', package_job)
        self.assertIn('MERGED_SHA="$(jq -r \'.sha\' <<<"$RESULT")"', package_job)
        self.assertIn('test "$CURRENT_MAIN" = "$MERGED_SHA"', package_job)
        self.assertIn('gh workflow run publication-check.yml --repo "$REPO" --ref main', package_job)
        self.assertLess(
            package_job.rfind('test "$CURRENT_MAIN" = "$MERGED_SHA"'),
            package_job.rfind('gh workflow run publication-check.yml --repo "$REPO" --ref main'),
        )

    def test_public_boundary_blocks_common_sensitive_binary_formats(self):
        text = (ROOT / "scripts/check_publication.py").read_text(encoding="utf-8")
        for suffix in ('.doc', '.docx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.webp', '.heic'):
            self.assertIn(f'"{suffix}"', text)


if __name__ == "__main__":
    unittest.main()
