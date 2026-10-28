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


    def test_clean_install_does_not_fetch_parser_test_base(self):
        workflow = (ROOT / ".github/workflows/clean-install-proof.yml").read_text(encoding="utf-8")
        self.assertNotIn("Fetch immutable PR base for parser epoch checks", workflow)
        self.assertNotIn("LEARNED_PARSER_BASE_SHA", workflow)


    def test_clean_install_proof_does_not_repeat_publication_suites(self):
        publication = (ROOT / ".github/workflows/publication-check.yml").read_text(encoding="utf-8")
        clean_install = (ROOT / ".github/workflows/clean-install-proof.yml").read_text(encoding="utf-8")
        duplicated_commands = (
            "python3 -m unittest discover -s tests -p 'test_*.py'",
            "node --test tests/*.test.cjs",
            "python3 scripts/build_operating_modules.py --check",
            "python3 scripts/check_publication.py",
            "python3 scripts/build_distribution.py --check-source",
        )
        for command in duplicated_commands:
            with self.subTest(command=command):
                self.assertIn(command, publication)
                self.assertNotIn(command, clean_install)
        self.assertNotIn("Run repository safety checks", clean_install)
        for proof_step in (
            "Recreate and verify pinned browser dependencies",
            "Build twice and prove deterministic output",
            "Smoke-test extracted file application",
            "Prove 16:9 TV layouts and seven-slide rotation with synthetic data",
            "Install the verified Beta package and launch its runtime",
        ):
            with self.subTest(proof_step=proof_step):
                self.assertIn(proof_step, clean_install)


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
        self.assertIn("github.event.workflow_run.event == 'pull_request'", merge)
        self.assertIn("python3 scripts/guarded_merge_policy.py check-authorization", merge)
        self.assertIn("Clean Install Proof", merge)
        self.assertIn("pull_request_target:", merge)
        self.assertIn("issue_comment:", merge)
        self.assertIn("pull_request_review:", merge)
        self.assertIn("push:", merge)
        self.assertIn("branches: [main]", merge)
        self.assertIn("types: [opened, reopened, synchronize, ready_for_review, converted_to_draft, edited, closed]", merge)
        self.assertIn("github.event.pull_request.merged == false", merge)
        self.assertIn("advance-beta-queue:", merge)
        self.assertIn("beta-release-queue-${{ github.repository }}", merge)
        self.assertIn("select_next_runtime_pr", merge)
        self.assertIn("MOONDOG_RELEASE_APP_ID", merge)
        self.assertIn("MOONDOG_RELEASE_APP_PRIVATE_KEY", merge)
        self.assertIn("actions/create-github-app-token@67018539274d69449ef7c02e8e71183d1719ab42", merge)
        self.assertIn("pipeline_guard.py check-paths", merge)
        self.assertIn("Stable manifest changes are out of scope", merge)
        self.assertIn("pulls/$PR_NUMBER/update-branch", merge)
        self.assertIn("pulls/$PR_NUMBER/merge", merge)
        self.assertIn("merge-review-state", merge)
        self.assertIn("15368", merge)
        self.assertNotIn("workflow_dispatch", merge)
        self.assertNotIn("gh workflow run", merge)
        self.assertNotIn("statuses/$HEAD_SHA", merge)
        self.assertNotIn("sleep ", merge)
        self.assertNotIn("for attempt in {1..", merge)

        prepare = (ROOT / ".github/workflows/prepare-beta-package.yml").read_text(encoding="utf-8")
        self.assertIn("pull_request_target:", prepare)
        self.assertIn("actions/create-github-app-token@67018539274d69449ef7c02e8e71183d1719ab42", prepare)
        self.assertIn("scripts/guarded_merge_policy.py check-authorization", prepare)
        self.assertIn("scripts/pipeline_guard.py check-paths", prepare)
        self.assertIn("untrusted data", prepare)
        self.assertIn("scripts/build_beta_package.py", prepare)
        self.assertIn("No Workspace migration; Stable remains unchanged.", prepare)
        self.assertIn('push origin "HEAD:$HEAD_BRANCH"', prepare)
        self.assertNotIn("workflow_dispatch:", prepare)
        self.assertNotIn("gh workflow run", prepare)
        self.assertNotIn("statuses:", prepare)
        self.assertNotIn("for attempt in {1..", prepare)

        builder = (ROOT / "scripts/build_beta_package.py").read_text(encoding="utf-8")
        self.assertIn("Stable manifest changed; Beta preparation refuses Stable promotion", builder)
        self.assertIn("Automatic Beta preparation refuses migrations", builder)
        offline = (ROOT / ".github/workflows/offline-distribution.yml").read_text(encoding="utf-8")
        self.assertIn("Wait for matching Stable GitHub Release", offline)
        self.assertIn("Stable tag $TAG was not fetchable after retry window.", offline)
        self.assertIn("python3 scripts/build_distribution.py --check-source", offline)
        self.assertLess(offline.index("Wait for matching Stable GitHub Release"), offline.index("Check out immutable Stable source"))
        self.assertLess(offline.index("Check out immutable Stable source"), offline.index("Build deterministic clean-install ZIP"))

    def test_guarded_merge_skips_stale_heads_before_reviewing_approval(self):
        merge = (ROOT / ".github/workflows/guarded-pr-merge.yml").read_text(encoding="utf-8")
        guard = merge.split("      - name: Verify automation authorization and PR safety", 1)[1]
        guard = guard.split("      - name: Create scoped MoonDog release App token", 1)[0]
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

    def test_beta_candidate_is_not_dispatched_or_merged_by_the_packager(self):
        workflow = (ROOT / ".github/workflows/prepare-beta-package.yml").read_text(encoding="utf-8")
        self.assertIn("Push package commit to the same reviewed PR", workflow)
        self.assertIn("normal pull_request checks", workflow)
        self.assertNotIn("package-unadvertised-main-runtime:", workflow)
        self.assertNotIn("gh workflow run", workflow)
        self.assertNotIn("statuses:", workflow)
        self.assertNotIn("pulls/$PR_NUMBER/merge", workflow)

    def test_public_boundary_blocks_common_sensitive_binary_formats(self):
        text = (ROOT / "scripts/check_publication.py").read_text(encoding="utf-8")
        for suffix in ('.doc', '.docx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.webp', '.heic'):
            self.assertIn(f'"{suffix}"', text)


    def test_guarded_merge_is_event_driven_and_does_not_poll(self):
        merge = (ROOT / ".github/workflows/guarded-pr-merge.yml").read_text(encoding="utf-8")
        proof = merge.split("      - name: Evaluate exact-head Publication, Clean Install, and Codex proof", 1)[1]
        proof = proof.split("      - name: Additively refresh this PR if main advanced", 1)[0]
        self.assertIn("commits/$HEAD_SHA/check-runs", proof)
        self.assertIn("ready=false", proof)
        self.assertIn("workflow_run will reevaluate", proof)
        self.assertIn("merge-review-state", proof)
        self.assertNotIn("sleep ", proof)
        self.assertNotIn("for attempt in {1..", proof)




    def test_stale_main_is_refreshed_before_package_parity_and_proof(self):
        merge = (ROOT / ".github/workflows/guarded-pr-merge.yml").read_text(encoding="utf-8")
        app_token = merge.index("      - name: Create scoped MoonDog release App token")
        refresh = merge.index("      - name: Additively refresh this PR if main advanced")
        candidate = merge.index("      - name: Check out verified PR candidate as untrusted data")
        stable = merge.index("      - name: Refuse Stable manifest changes")
        parity = merge.index("      - name: Verify Beta package matches the exact PR runtime")
        proof = merge.index("      - name: Evaluate exact-head Publication, Clean Install, and Codex proof")
        self.assertLess(app_token, refresh)
        self.assertLess(refresh, candidate)
        self.assertLess(refresh, stable)
        self.assertLess(refresh, parity)
        self.assertLess(refresh, proof)

        refresh_section = merge[refresh:merge.index("      - name:", refresh + 1)]
        self.assertIn('repos/$REPO/pulls/$PR_NUMBER/update-branch', refresh_section)
        self.assertIn('expected_head_sha="$HEAD_SHA"', refresh_section)
        self.assertIn('echo "updated=true" >> "$GITHUB_OUTPUT"', refresh_section)

        for step, next_step in (
            ("      - name: Check out verified PR candidate as untrusted data", "      - name: Refuse Stable manifest changes"),
            ("      - name: Refuse Stable manifest changes", "      - name: Verify Beta package matches the exact PR runtime"),
            ("      - name: Verify Beta package matches the exact PR runtime", "      - name: Evaluate exact-head Publication, Clean Install, and Codex proof"),
            ("      - name: Evaluate exact-head Publication, Clean Install, and Codex proof", "      - name: Squash merge verified current PR"),
        ):
            start = merge.index(step)
            section = merge[start:merge.index(next_step, start + 1)]
            self.assertIn("steps.current.outputs.updated != 'true'", section)


    def test_beta_reservation_uses_trusted_checkout_paths(self):
        workflow = (ROOT / ".github/workflows/prepare-beta-package.yml").read_text(encoding="utf-8")
        section = workflow.split("      - name: Reserve the Beta version for the oldest authorized runtime PR", 1)[1]
        section = section.split("      - name: Build the Beta candidate with trusted code", 1)[0]
        self.assertIn("PYTHONPATH=trusted python3 - <<'PY'", section)
        self.assertIn('load_policy("trusted/.github/guarded-merge-policy.json")', section)


    def test_draft_conversion_releases_beta_reservation_to_next_runtime_pr(self):
        merge = (ROOT / ".github/workflows/guarded-pr-merge.yml").read_text(encoding="utf-8")
        trigger = merge.split("  pull_request_target:", 1)[1].split("  issue_comment:", 1)[0]
        queue = merge.split("  advance-beta-queue:", 1)[1]
        condition = queue.split("    runs-on:", 1)[0]
        self.assertIn("converted_to_draft", trigger)
        self.assertIn("github.event.pull_request.merged == false) ||", condition)
        self.assertIn("github.event.action == 'converted_to_draft'))", condition)
        self.assertIn("select_next_runtime_pr", queue)
        self.assertIn("edited", trigger)


    def test_empty_beta_queue_skips_release_app_token(self):
        merge = (ROOT / ".github/workflows/guarded-pr-merge.yml").read_text(encoding="utf-8")
        queue = merge.split("  advance-beta-queue:", 1)[1]
        select = queue.split("      - name: Create scoped MoonDog release App token", 1)[0]
        token = queue.split("      - name: Create scoped MoonDog release App token", 1)[1]
        token = token.split("      - name: Advance selected runtime PR", 1)[0]
        advance = queue.split("      - name: Advance selected runtime PR", 1)[1]
        self.assertIn("permissions:", queue)
        self.assertIn("GH_TOKEN: ${{ github.token }}", select)
        self.assertIn("has_candidate=false", select)
        self.assertIn("id: candidate", select)
        self.assertNotIn("create-github-app-token", select)
        self.assertIn("if: steps.candidate.outputs.has_candidate == 'true'", token)
        self.assertIn("if: steps.candidate.outputs.has_candidate == 'true'", advance)
        self.assertIn("EXPECTED_HEAD:", advance)
        self.assertIn("candidate changed after selection", advance)


    def test_pr_file_list_jq_streams_each_array_object(self):
        merge = (ROOT / ".github/workflows/guarded-pr-merge.yml").read_text(encoding="utf-8")
        self.assertEqual(merge.count(".[] | .filename, (.previous_filename // empty)"), 3)
        self.assertNotIn("'.[].filename, (.previous_filename // empty)'", merge)

if __name__ == "__main__":
    unittest.main()
