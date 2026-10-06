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
        self.assertEqual(manifest["beta"]["version"], "0.10.7-beta.2")
        self.assertTrue(manifest["stable"]["packageUrl"].endswith("/moondog-0.10.6.json"))
        self.assertFalse(manifest["beta"]["migrationRequired"])
        stable_bytes = (MANIFEST.parent / "packages" / "moondog-0.10.6.json").read_bytes()
        self.assertEqual(manifest["stable"]["sha256"], hashlib.sha256(stable_bytes).hexdigest())
        stable_package = json.loads(stable_bytes)
        self.assertEqual(stable_package["version"], "0.10.6")
        self.assertEqual(stable_package["approvedFiles"], ["assets/product-settings.css", "assets/daily-ops.css", "assets/daily-ops.js"])
        stable_css = base64.b64decode(stable_package["files"][0]["contentBase64"], validate=True)
        self.assertEqual(stable_package["files"][0]["sha256"], hashlib.sha256(stable_css).hexdigest())
        retained = json.loads((MANIFEST.parent / "packages" / "moondog-0.10.7-beta.1.json").read_bytes())
        retained_css = base64.b64decode(retained["files"][0]["contentBase64"], validate=True)
        marker = b"\n/* MoonDog controlled Beta update test 0.10.7-beta.1; no style changes. */\n"
        self.assertEqual(retained_css, stable_css + marker)
        beta_package = json.loads((MANIFEST.parent / "packages" / "moondog-0.10.7-beta.2.json").read_bytes())
        self.assertEqual(beta_package["approvedFiles"], ["assets/daily-ops.css", "assets/daily-ops.js"])
        self.assertTrue(set(beta_package["approvedFiles"]).issubset(stable_package["approvedFiles"]))

    def test_beta_package_has_exact_hashes_and_two_approved_files(self):
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        beta = manifest["beta"]
        self.assertEqual(beta["minimumCompatibleVersion"], "0.10.6")
        self.assertFalse(beta["migrationRequired"])
        package_path = MANIFEST.parent / "packages" / "moondog-0.10.7-beta.2.json"
        self.assertEqual(beta["packageUrl"],
                         "https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/updates/packages/moondog-0.10.7-beta.2.json")
        package_bytes = package_path.read_bytes()
        self.assertEqual(beta["sha256"], hashlib.sha256(package_bytes).hexdigest())
        package = json.loads(package_bytes)
        self.assertEqual(set(package), {"formatVersion", "version", "approvedFiles", "files"})
        self.assertEqual(package["formatVersion"], 1)
        self.assertEqual(package["version"], beta["version"])
        self.assertEqual(package["approvedFiles"], ["assets/daily-ops.css", "assets/daily-ops.js"])
        self.assertEqual(len(package["files"]), 2)
        for entry in package["files"]:
            self.assertEqual(set(entry), {"path", "action", "sha256", "contentBase64"})
            self.assertEqual(entry["action"], "put")
            content = base64.b64decode(entry["contentBase64"], validate=True)
            self.assertEqual(entry["sha256"], hashlib.sha256(content).hexdigest())
            self.assertEqual(content, (MANIFEST.parents[1] / entry["path"]).read_bytes())
        self.assertTrue(base64.b64decode(package["files"][1]["contentBase64"]).endswith(
            b"\n/* Service Operations Hub theme Beta 0.10.7-beta.2. */\n"))


if __name__ == "__main__":
    unittest.main()
