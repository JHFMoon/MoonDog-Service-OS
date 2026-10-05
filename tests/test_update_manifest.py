"""Validate the public update-contract placeholder without an updater."""

import json
from pathlib import Path
import re
import unittest


MANIFEST = Path(__file__).resolve().parents[1] / "updates" / "manifest.json"
FIELDS = {
    "stableVersion", "betaVersion", "channel", "minimumCompatibleVersion",
    "migrationRequired", "packageUrl", "sha256", "releaseNotes",
}
VERSION = re.compile(r"^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$")


class UpdateManifestTests(unittest.TestCase):
    def test_contract_is_plain_json_with_required_fields(self):
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        self.assertEqual(set(manifest), FIELDS)
        self.assertRegex(manifest["stableVersion"], VERSION)
        self.assertRegex(manifest["minimumCompatibleVersion"], VERSION)
        self.assertIsNone(manifest["betaVersion"])
        self.assertIn(manifest["channel"], ("stable", "beta"))
        self.assertIsInstance(manifest["migrationRequired"], bool)
        self.assertIsInstance(manifest["releaseNotes"], str)
        self.assertTrue(manifest["releaseNotes"].strip())

    def test_placeholder_cannot_advertise_a_download(self):
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        self.assertEqual(manifest["channel"], "stable")
        self.assertEqual(manifest["stableVersion"], "0.0.0")
        self.assertEqual(manifest["minimumCompatibleVersion"], "0.0.0")
        self.assertFalse(manifest["migrationRequired"])
        self.assertIsNone(manifest["packageUrl"])
        self.assertIsNone(manifest["sha256"])


if __name__ == "__main__":
    unittest.main()
