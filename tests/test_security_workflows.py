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
        self.assertNotIn("  schedule:\n", text)
        clean_install = (ROOT / ".github/workflows/clean-install-proof.yml").read_text(encoding="utf-8")
        self.assertNotIn("  schedule:\n", clean_install)
        self.assertNotIn("cron:", clean_install)
        self.assertIn("  pull_request:\n", clean_install)
        self.assertIn("  workflow_dispatch:\n", clean_install)
        self.assertIn("fetch-depth: 0", text)
        self.assertIn("git fetch --force --tags origin '+refs/heads/*:refs/remotes/origin/*'", text)
        self.assertIn("python3 scripts/audit_git_history.py", text)
        self.assertIn("name: Publication Check", text)


    def test_clean_install_fetches_immutable_pr_base_before_safety_checks(self):
        workflow = (ROOT / ".github/workflows/clean-install-proof.yml").read_text(encoding="utf-8")
        fetch_step = "Fetch immutable PR base for parser epoch checks"
        safety_step = "Run repository safety checks"
        self.assertLess(workflow.index(fetch_step), workflow.index(safety_step))
        self.assertIn('git fetch --no-tags --depth=1 origin "$BASE_SHA"', workflow)
        self.assertIn('git cat-file -e "$BASE_SHA^{commit}"', workflow)


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

    def test_candidate_tests_have_no_elevated_status_token(self):
        workflow = (ROOT / ".github/workflows/publication-check.yml").read_text(encoding="utf-8")
        self.assertNotIn("statuses: write", workflow)
        self.assertNotIn("GH_TOKEN:", workflow)
        self.assertIn("persist-credentials: false", workflow)

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

    def test_guarded_merge_workflow_has_no_unindented_command_continuations(self):
        # YAML run: | content must stay indented. A previous Codex request
        # accidentally put its body at column zero, making this entire
        # protected workflow invalid even though all PR proofs were green.
        merge = (ROOT / ".github/workflows/guarded-pr-merge.yml").read_text(encoding="utf-8")
        top_level = re.compile(r"^(?:name|on|permissions|concurrency|jobs|env):(?:\s|$)")
        for line_no, line in enumerate(merge.splitlines(), 1):
            if line.strip() and not line[0].isspace() and not line.startswith("#"):
                self.assertRegex(line, top_level, f"Unexpected column-zero text at line {line_no}")

    def test_guarded_merge_and_offline_distribution_are_hands_off_safe(self):
        merge = (ROOT / ".github/workflows/guarded-pr-merge.yml").read_text(encoding="utf-8")
        self.assertIn('workflows: ["Publication check", "Clean Install Proof"]', merge)
        self.assertIn("ref: main", merge)
        self.assertIn("python3 scripts/guarded_merge_policy.py check-authorization", merge)
        self.assertEqual(merge.count("'authorization': has_merge_authorization("), 2)
        self.assertEqual(merge.count("'association': has_accepted_pr_author(pr, os.environ['REPO'])"), 2)
        self.assertIn("has_accepted_pr_author(pr, os.environ['REPO'])", merge)
        self.assertEqual(merge.count("from scripts.guarded_merge_policy import has_accepted_pr_author, has_merge_authorization, load_policy"), 1)
        self.assertIn("from scripts.guarded_merge_policy import merge_review_state, load_policy", merge)
        self.assertNotIn('contains("MoonDog-Auto-Merge: yes")', merge)
        self.assertIn("Clean Install Proof", merge)
        self.assertIn("workflow_dispatch", merge)
        self.assertIn('pulls?state=open&head=$OWNER:$HEAD_BRANCH', merge)
        self.assertIn("Classify verified release channel", merge)
        self.assertIn("Stable changed under standing authorization", merge)
        self.assertIn("merge_base_commit.sha", merge)
        self.assertIn("Final guarded merge refused", merge)
        self.assertIn("PR is no longer based on current main", merge)
        self.assertIn("exact-head Codex or owner-attested review", merge)
        proof_wait = merge.split("Wait for Publication, Clean Install, and exact-head Codex proof", 1)[1].split("Bring branch current with main if needed", 1)[0]
        self.assertLess(
            proof_wait.index("python3 scripts/pipeline_guard.py check-paths"),
            proof_wait.index("# A GITHUB_TOKEN branch refresh"),
        )
        self.assertIn('head_sha=$HEAD_SHA', proof_wait)
        self.assertIn('head_repository.full_name==$repo', proof_wait)
        self.assertIn("CURRENT_PR_BRANCH", merge)
        self.assertIn('HEAD_BRANCH="$CURRENT_PR_BRANCH"', merge)
        self.assertLess(merge.index('HEAD_BRANCH="$CURRENT_PR_BRANCH"'), merge.index('gh workflow run publication-check.yml --repo "$REPO" --ref "$HEAD_BRANCH"'))
        self.assertIn('gh workflow run publication-check.yml --repo "$REPO" --ref "$HEAD_BRANCH"', proof_wait)
        self.assertIn('gh workflow run clean-install-proof.yml --repo "$REPO" --ref "$HEAD_BRANCH"', proof_wait)
        self.assertIn('MoonDog-Codex-Review-Request:$HEAD_SHA', proof_wait)
        self.assertIn('if [ "$HARD_FAIL" = "0" ]; then', proof_wait)
        self.assertIn('if [ "$REVIEW_STATE" = "pending" ] && [ "$CODEX_STATE" = "pending" ] && [ "$REVIEW_REQUESTED" = "0" ]; then', proof_wait)
        poll_loop = proof_wait.index("for attempt in {1..")
        self.assertLess(
            proof_wait.index("MoonDog-Codex-Review-Request:$HEAD_SHA"),
            poll_loop,
        )
        current_refresh = merge.split("Bring branch current with main if needed", 1)[1].split("Squash merge verified current PR", 1)[0]
        self.assertIn('pulls/$PR_NUMBER/update-branch', current_refresh)
        self.assertIn("for settle in {1..42}", current_refresh)
        self.assertIn('repos/$REPO/compare/$CURRENT_MAIN...$REFRESHED_HEAD', current_refresh)
        self.assertIn('gh workflow run publication-check.yml --repo "$REPO" --ref "$REFRESHED_BRANCH"', current_refresh)
        self.assertIn('gh workflow run clean-install-proof.yml --repo "$REPO" --ref "$REFRESHED_BRANCH"', current_refresh)
        self.assertIn('gh api -X POST "repos/$REPO/issues/$PR_NUMBER/comments"', current_refresh)
        self.assertIn('-f body="@codex review', current_refresh)
        self.assertIn('$REFRESHED_HEAD against current main $CURRENT_MAIN', current_refresh)
        self.assertLess(current_refresh.index('if [ "$UPDATED" != "true" ]'), current_refresh.index('gh workflow run publication-check.yml'))
        self.assertIn("pull_request_target:", merge)
        self.assertIn("issue_comment:", merge)
        self.assertIn("pull_request_review:", merge)
        self.assertIn("MoonDog-Owner-Review: approved", merge)
        self.assertIn("repos/$REPO/pulls/$PR_NUMBER/reviews?per_page=100", merge)
        self.assertIn("merge-review-state", merge)
        self.assertIn("final-pr-reviews.json", merge)
        self.assertIn("chatgpt-codex-connector[bot]", merge)
        self.assertIn("codex-review-state:v1", merge)
        self.assertIn("gh workflow run publication-check.yml", merge)
        self.assertIn('pulls/$PR_NUMBER/update-branch', merge)
        refresh = merge.split("Refresh other open same-repository PRs", 1)[1].split("exit 0", 1)[0]
        update = 'gh api -X PUT "repos/$REPO/pulls/$OTHER_PR/update-branch"'
        self.assertIn(update, refresh)
        self.assertIn('pulls/$OTHER_PR/files?per_page=100', refresh)
        self.assertIn('python3 scripts/pipeline_guard.py check-paths /tmp/other-pr-paths.txt', refresh)
        self.assertLess(
            refresh.index('python3 scripts/pipeline_guard.py check-paths /tmp/other-pr-paths.txt'),
            refresh.index(update),
        )
        self.assertIn('gh workflow run publication-check.yml --repo "$REPO" --ref "$REFRESHED_BRANCH"', refresh)
        self.assertIn('gh workflow run clean-install-proof.yml --repo "$REPO" --ref "$REFRESHED_BRANCH"', refresh)
        self.assertIn('gh api -X POST "repos/$REPO/issues/$OTHER_PR/comments"', refresh)
        self.assertIn('-f body="@codex review', refresh)
        self.assertIn('$REFRESHED_HEAD against current main $CURRENT_MAIN', refresh)
        self.assertLess(refresh.index(update), refresh.index('gh workflow run publication-check.yml'))
        self.assertLess(refresh.index('gh workflow run publication-check.yml'), refresh.index('gh workflow run clean-install-proof.yml'))
        self.assertIn("for settle in {1..42}", refresh)
        self.assertIn('repos/$REPO/compare/$CURRENT_MAIN...$REFRESHED_HEAD', refresh)
        self.assertIn('REFRESH_STATUS" = "ahead"', refresh)
        self.assertIn('REFRESH_BASE" = "$CURRENT_MAIN"', refresh)
        self.assertLess(refresh.index('if [ "$UPDATED" != "true" ]'), refresh.index('gh workflow run publication-check.yml'))
        self.assertIn('pulls/$PR_NUMBER/merge', merge)
        self.assertIn("-f merge_method=squash", merge)
        self.assertIn("exact-head Publication, Clean Install, and Codex review proof to settle", merge)
        self.assertIn("Required status check.*(in progress|expected)", merge)

        prepare = (ROOT / ".github/workflows/prepare-beta-package.yml").read_text(encoding="utf-8")
        package_job = prepare.split("  package-unadvertised-main-runtime:", 1)[1]
        self.assertIn('[ "$REVIEW_STATE" = "clean" ]; then', package_job)
        self.assertNotIn("\n  pull_request_target:", prepare)
        self.assertIn("  workflow_dispatch:", prepare)
        self.assertIn("  package-unadvertised-main-runtime:", prepare)
        self.assertIn("reviewed_commit:", prepare)
        self.assertIn("python3 trusted/scripts/guarded_merge_policy.py check-authorization", prepare)
        self.assertIn("check-pr-author /tmp/authorized-pr.json", prepare)
        self.assertIn("github.event.pull_request.user.login == 'github-actions[bot]'", prepare)
        self.assertIn("has_accepted_pr_author(pr, os.environ['REPO'])", prepare)
        self.assertIn("has_merge_authorization(pr.get('body'), policy)", prepare)
        self.assertIn("exact_review", prepare)
        self.assertNotIn("contains(github.event.pull_request.body", prepare)
        self.assertIn("Refuse automatic changes to trusted proof/automation files", prepare)
        self.assertIn("merge-review-state", prepare)
        self.assertIn("MoonDog-Auto-Merge: yes", prepare)
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

    def test_guarded_merge_skips_stale_heads_before_reviewing_approval(self):
        merge = (ROOT / ".github/workflows/guarded-pr-merge.yml").read_text(encoding="utf-8")
        guard = merge.split("      - name: Verify automation authorization and PR safety", 1)[1]
        guard = guard.split("      - name: Classify verified release channel", 1)[0]
        fetch = 'gh api "repos/$REPO/pulls/$PR_NUMBER" > /tmp/pr.json'
        self.assertEqual(guard.count(fetch), 1)
        self.assertIn("CURRENT_PR_HEAD=", guard)
        self.assertIn('[ -z "$HEAD_SHA" ] || [ -z "$CURRENT_PR_HEAD" ]', guard)
        self.assertIn('if [ "$CURRENT_PR_HEAD" != "$HEAD_SHA" ]; then', guard)
        stale = guard.index('if [ "$CURRENT_PR_HEAD" != "$HEAD_SHA" ]; then')
        end = guard.index("          fi", stale)
        self.assertIn('echo "skip=true" >> "$GITHUB_OUTPUT"', guard[stale:end])
        self.assertIn("exit 0", guard[stale:end])
        self.assertLess(guard.index(fetch), guard.index("CURRENT_PR_HEAD="))
        self.assertLess(stale, guard.index("python3 scripts/guarded_merge_policy.py check-authorization"))
        self.assertLess(stale, guard.index('echo "skip=false" >> "$GITHUB_OUTPUT"'))
        self.assertIn("'head': pr.get('head',{}).get('sha')==expected", merge)
        self.assertIn("Final guarded merge refused", merge)

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


    def test_guarded_merge_wait_budget_covers_long_clean_install_proof(self):
        merge = (ROOT / ".github/workflows/guarded-pr-merge.yml").read_text(encoding="utf-8")
        wait = merge.split(
            "      - name: Wait for Publication, Clean Install, and exact-head Codex proof",
            1,
        )[1].split("      - name: Bring branch current with main if needed", 1)[0]
        loop_line = ""
        interval_line = ""
        for line in wait.splitlines():
            candidate = line.strip()
            if candidate.startswith("for attempt in {1..") and candidate.endswith("}; do"):
                loop_line = candidate
            if not interval_line and candidate.startswith("sleep "):
                interval_line = candidate
        self.assertTrue(loop_line, "the exact-head proof wait must stay bounded")
        self.assertTrue(interval_line, "the proof wait must keep an explicit polling interval")
        attempts = int(loop_line.removeprefix("for attempt in {1..").removesuffix("}; do"))
        interval_seconds = int(interval_line.removeprefix("sleep "))
        budget_seconds = attempts * interval_seconds
        self.assertGreaterEqual(budget_seconds, 30 * 60)
        self.assertLessEqual(budget_seconds, 45 * 60)
        for required_gate in ("PUB_OK", "CLEAN_OK", "HARD_FAIL", "REVIEW_STATE"):
            self.assertIn(required_gate, wait)


if __name__ == "__main__":
    unittest.main()
