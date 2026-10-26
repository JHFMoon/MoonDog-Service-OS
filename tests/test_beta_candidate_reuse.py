import hashlib
import json
import unittest

from scripts.beta_candidate_reuse import (
    eligible_package_pr,
    package_metadata_matches,
    select_matching_pr,
)

REPO = "JHFMoon/MoonDog-Service-OS"


def package_pr(number=510, version="0.10.18-beta.169", sha=None, author="github-actions[bot]",
               branch="beta/post-merge-40276787562", stable=None, body=None):
    package_bytes = json.dumps({"version": version, "files": []}, separators=(",", ":")).encode()
    digest = sha or hashlib.sha256(package_bytes).hexdigest()
    stable = stable or {"version": "0.10.17", "sha256": "stable-digest"}
    beta = {
        "version": version,
        "packageUrl": f"https://example.invalid/moondog-{version}.json",
        "sha256": digest,
        "minimumCompatibleVersion": "0.10.9",
        "migrationRequired": False,
        "releaseNotes": "candidate",
    }
    pr = {
        "number": number,
        "state": "open",
        "draft": False,
        "user": {"login": author},
        "body": body or "MoonDog-Automation-Package: yes\nMoonDog-Auto-Merge: yes",
        "base": {"ref": "main"},
        "head": {"ref": branch, "sha": "a" * 40, "repo": {"full_name": REPO}},
    }
    return pr, {"stable": stable, "beta": beta}, package_bytes


class BetaCandidateReuseTests(unittest.TestCase):
    def test_reuses_only_exact_authorized_trusted_candidate(self):
        pr, candidate, package = package_pr()
        expected = {**candidate, "beta": {**candidate["beta"], "releaseNotes": "new pipeline run notes"}}
        self.assertTrue(eligible_package_pr(pr, REPO))
        self.assertTrue(package_metadata_matches(expected, candidate, package))
        self.assertEqual(select_matching_pr([pr], {"510": candidate}, {"510": package}, expected, REPO), pr)

    def test_rejects_wrong_author_branch_markers_or_repository(self):
        pr, candidate, package = package_pr()
        for modified in (
            {**pr, "user": {"login": "ordinary-user"}},
            {**pr, "head": {**pr["head"], "ref": "feature/package"}},
            {**pr, "body": "MoonDog-Automation-Package: yes"},
            {**pr, "head": {**pr["head"], "repo": {"full_name": "fork/other"}}},
        ):
            self.assertFalse(eligible_package_pr(modified, REPO))
        self.assertFalse(package_metadata_matches({**candidate, "stable": {"version": "0.10.18"}}, candidate, package))

    def test_bad_digest_or_package_version_fails_closed(self):
        pr, candidate, package = package_pr()
        tampered = package + b" "
        self.assertFalse(package_metadata_matches(candidate, candidate, tampered))
        wrong = json.dumps({"version": "0.10.18-beta.168", "files": []}).encode()
        candidate_with_wrong_digest = {**candidate, "beta": {**candidate["beta"], "sha256": hashlib.sha256(wrong).hexdigest()}}
        self.assertFalse(package_metadata_matches(candidate_with_wrong_digest, candidate_with_wrong_digest, wrong))

    def test_duplicate_matching_candidates_are_rejected(self):
        first, candidate, package = package_pr(number=510)
        second, _, _ = package_pr(number=512)
        with self.assertRaisesRegex(ValueError, "Multiple open trusted Beta PRs"):
            select_matching_pr([first, second], {"510": candidate, "512": candidate},
                               {"510": package, "512": package}, candidate, REPO)

    def test_conflicting_open_package_pr_is_not_silently_duplicated(self):
        pr, candidate, package = package_pr()
        expected = {**candidate, "beta": {**candidate["beta"], "sha256": "different"}}
        with self.assertRaisesRegex(ValueError, "refusing a duplicate"):
            select_matching_pr([pr], {"510": candidate}, {"510": package}, expected, REPO)


if __name__ == "__main__":
    unittest.main()
