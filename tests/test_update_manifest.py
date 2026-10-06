"""Validate the public update manifest and controlled test package."""

import base64
import hashlib
import json
from pathlib import Path
import re
import unittest


MANIFEST = Path(__file__).resolve().parents[1] / "updates" / "manifest.json"
FIELDS = {"version", "packageUrl", "sha256", "minimumCompatibleVersion",
          "migrationRequired", "releaseNotes"}
VERSION = re.compile(r"^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$")


class UpdateManifestTests(unittest.TestCase):
    def test_contract_is_plain_json_with_required_fields(self):
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        self.assertEqual(set(manifest), {"stable", "beta"})
        for release in manifest.values():
            self.assertEqual(set(release), FIELDS)
            self.assertRegex(release["minimumCompatibleVersion"], VERSION)
            self.assertIsInstance(release["migrationRequired"], bool)
            self.assertTrue(release["releaseNotes"].strip())
        self.assertEqual(manifest["stable"]["version"], "0.10.6")
        self.assertEqual(manifest["beta"]["version"], "0.10.7-beta.1")
        self.assertIsNone(manifest["stable"]["packageUrl"])
        self.assertIsNone(manifest["stable"]["sha256"])

    def test_beta_package_has_exact_hashes_and_one_approved_file(self):
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        beta = manifest["beta"]
        self.assertEqual(beta["minimumCompatibleVersion"], "0.10.6")
        self.assertFalse(beta["migrationRequired"])
        package_path = MANIFEST.parent / "packages" / "moondog-0.10.7-beta.1.json"
        self.assertEqual(beta["packageUrl"],
                         "https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/updates/packages/moondog-0.10.7-beta.1.json")
        package_bytes = package_path.read_bytes()
        self.assertEqual(beta["sha256"], hashlib.sha256(package_bytes).hexdigest())
        package = json.loads(package_bytes)
        self.assertEqual(set(package), {"formatVersion", "version", "approvedFiles", "files"})
        self.assertEqual(package["formatVersion"], 1)
        self.assertEqual(package["version"], beta["version"])
        self.assertEqual(package["approvedFiles"], ["assets/product-settings.css"])
        self.assertEqual(len(package["files"]), 1)
        entry = package["files"][0]
        self.assertEqual(set(entry), {"path", "action", "sha256", "contentBase64"})
        self.assertEqual((entry["path"], entry["action"]),
                         ("assets/product-settings.css", "put"))
        content = base64.b64decode(entry["contentBase64"], validate=True)
        self.assertEqual(entry["sha256"], hashlib.sha256(content).hexdigest())
        marker = b"\n/* MoonDog controlled Beta update test 0.10.7-beta.1; no style changes. */\n"
        self.assertTrue(content.endswith(marker))
        self.assertNotIn(marker, content[:-len(marker)])


if __name__ == "__main__":
    unittest.main()
