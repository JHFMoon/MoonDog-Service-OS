"""Prove the discoverable Beta package contains the reviewed source runtime."""
import base64
import hashlib
import json
import os
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def should_verify_runtime_parity(event_name, ref, package_change_in_pr):
    if event_name == "pull_request":
        return package_change_in_pr
    if event_name == "workflow_dispatch":
        return ref == "refs/heads/main" or ref.startswith("refs/heads/beta/post-merge-")
    return True


class BetaRuntimeGateSelection(unittest.TestCase):
    def test_manual_feature_branch_does_not_require_post_merge_beta_parity(self):
        self.assertFalse(should_verify_runtime_parity(
            "workflow_dispatch", "refs/heads/test/open-ro-edit", False))

    def test_manual_generated_beta_package_requires_runtime_parity(self):
        self.assertTrue(should_verify_runtime_parity(
            "workflow_dispatch", "refs/heads/beta/post-merge-123", False))

    def test_manual_main_validation_requires_runtime_parity(self):
        self.assertTrue(should_verify_runtime_parity(
            "workflow_dispatch", "refs/heads/main", False))

    def test_pull_request_requires_parity_only_for_package_changes(self):
        self.assertFalse(should_verify_runtime_parity(
            "pull_request", "refs/pull/508/merge", False))
        self.assertTrue(should_verify_runtime_parity(
            "pull_request", "refs/pull/507/merge", True))


class BetaRuntimeContract(unittest.TestCase):
    def test_beta_manifest_package_and_runtime_match(self):
        manifest = json.loads((ROOT / "updates/manifest.json").read_text())
        beta = manifest["beta"]
        stable = manifest["stable"]
        version = beta["version"]
        self.assertEqual(stable["version"], "0.10.17")
        self.assertRegex(version, r"^\d+\.\d+\.\d+-beta\.\d+$")
        relative = f"updates/packages/moondog-{version}.json"
        self.assertEqual(beta["packageUrl"], f"https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/{relative}")
        raw = (ROOT / relative).read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), beta["sha256"])
        package = json.loads(raw)
        self.assertEqual(package["version"], version)
        self.assertEqual(package["formatVersion"], 1)
        self.assertEqual(package["approvedFiles"], [item["path"] for item in package["files"]])
        entries = {item["path"]: item for item in package["files"]}
        self.assertEqual(len(entries), len(package["files"]))
        for item in package["files"]:
            path = item["path"]
            self.assertFalse(path.startswith(("Workspace/", "data/", "history/", "backups/")))
            self.assertEqual(item["action"], "put")
            self.assertEqual(hashlib.sha256(base64.b64decode(item["contentBase64"], validate=True)).hexdigest(), item["sha256"])
        self.assertIn("assets/app.js", entries)
        self.assertIn("assets/freshness.js", entries)
        app = base64.b64decode(entries["assets/app.js"]["contentBase64"]).decode("utf-8")
        source = (ROOT / "assets/app.js").read_text(encoding="utf-8")
        self.assertIn(f'const VERSION = "{version}";', app)
        source = source.replace(f'const VERSION = "{stable["version"]}";', f'const VERSION = "{version}";')
        package_build = re.search(r'const BUILD_DATE = "(20\d{2}-\d{2}-\d{2})";', app)
        self.assertIsNotNone(package_build)
        source = re.sub(r'const BUILD_DATE = "20\d{2}-\d{2}-\d{2}";',
                        f'const BUILD_DATE = "{package_build.group(1)}";', source)
        # A normal feature PR may legitimately change runtime before post-merge
        # packaging. But an actual package/manifest PR MUST already contain
        # the complete reviewed runtime. Previously all PRs skipped this check.
        event_name = os.environ.get("GITHUB_EVENT_NAME")
        package_change_in_pr = False
        if event_name == "pull_request":
            changed = subprocess.check_output(
                ["git", "diff", "--name-only", "HEAD^", "HEAD"], cwd=ROOT, text=True
            ).splitlines()
            package_change_in_pr = (
                "updates/manifest.json" in changed
                and any(path.startswith("updates/packages/moondog-") and path.endswith(".json") for path in changed)
            )
        # Generated Beta branches use the explicit beta/post-merge-* prefix in
        # prepare-beta-package.yml and receive workflow_dispatch validation.
        # Preserve full parity for that publication gate while allowing manual
        # validation of an ordinary source feature branch before Beta sync.
        verify_runtime = should_verify_runtime_parity(
            event_name, os.environ.get("GITHUB_REF", ""), package_change_in_pr
        )
        if verify_runtime:
            self.assertEqual(app, source, "Beta app.js differs from reviewed source beyond version/build date")
            self.assertEqual(
                base64.b64decode(entries["assets/freshness.js"]["contentBase64"]).decode("utf-8"),
                (ROOT / "assets/freshness.js").read_text(encoding="utf-8"),
                "Beta freshness.js differs from reviewed source")
        self.assertFalse(beta["migrationRequired"])

if __name__ == "__main__":
    unittest.main()
