"""Validate the public update manifest and current Stable/Beta packages."""

import base64
import hashlib
import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "updates" / "manifest.json"
PACKAGES = MANIFEST.parent / "packages"
FIELDS = {"version", "packageUrl", "sha256", "minimumCompatibleVersion",
          "migrationRequired", "releaseNotes"}
STABLE_VERSION = re.compile(r"^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$")
BETA_VERSION = re.compile(r"^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-beta\.(?:0|[1-9]\d*)$")
PACKAGE_FIELDS = {"formatVersion", "version", "approvedFiles", "files"}
FILE_FIELDS = {"path", "action", "sha256", "contentBase64"}


class UpdateManifestTests(unittest.TestCase):
    def load_manifest(self):
        return json.loads(MANIFEST.read_text(encoding="utf-8"))

    def validate_package(self, channel, release):
        version = release["version"]
        package_path = PACKAGES / f"moondog-{version}.json"
        self.assertTrue(package_path.is_file(), f"Missing {channel} package {package_path.name}")
        self.assertEqual(
            release["packageUrl"],
            f"https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/updates/packages/{package_path.name}",
        )

        package_bytes = package_path.read_bytes()
        self.assertEqual(release["sha256"], hashlib.sha256(package_bytes).hexdigest())

        package = json.loads(package_bytes)
        self.assertEqual(set(package), PACKAGE_FIELDS)
        self.assertEqual(package["formatVersion"], 1)
        self.assertEqual(package["version"], version)
        self.assertTrue(package["approvedFiles"])
        self.assertEqual(len(package["approvedFiles"]), len(set(package["approvedFiles"])))

        entries = package["files"]
        self.assertEqual([entry["path"] for entry in entries], package["approvedFiles"])
        for entry in entries:
            self.assertEqual(set(entry), FILE_FIELDS)
            self.assertEqual(entry["action"], "put")
            content = base64.b64decode(entry["contentBase64"], validate=True)
            self.assertEqual(entry["sha256"], hashlib.sha256(content).hexdigest())
            path = entry["path"]
            self.assertTrue(
                path == "index.html" or path.startswith("assets/"),
                f"Package contains non-application path: {path}",
            )
            self.assertNotRegex(path, r"(^|/)(data|backups?|history|reports|imports|exports)(/|$)")

        return package

    def test_manifest_contract_and_current_packages(self):
        manifest = self.load_manifest()
        self.assertEqual(set(manifest), {"stable", "beta"})

        stable = manifest["stable"]
        beta = manifest["beta"]
        self.assertRegex(stable["version"], STABLE_VERSION)
        self.assertRegex(beta["version"], BETA_VERSION)

        for release in (stable, beta):
            self.assertEqual(set(release), FIELDS)
            self.assertRegex(release["minimumCompatibleVersion"], STABLE_VERSION)
            self.assertIsInstance(release["migrationRequired"], bool)
            self.assertTrue(release["releaseNotes"].strip())
            self.assertRegex(release["sha256"], r"^[0-9a-f]{64}$")

        self.assertFalse(beta["migrationRequired"])

        stable_package = self.validate_package("stable", stable)
        beta_package = self.validate_package("beta", beta)

        self.assertTrue(
            set(beta_package["approvedFiles"]).issubset(stable_package["approvedFiles"]),
            "Stable must restore every file touched by the current Beta package",
        )

    def test_retained_package_names_do_not_override_manifest(self):
        manifest = self.load_manifest()
        current = {
            f"moondog-{manifest['stable']['version']}.json",
            f"moondog-{manifest['beta']['version']}.json",
        }
        self.assertTrue(current.issubset({path.name for path in PACKAGES.glob("moondog-*.json")}))


if __name__ == "__main__":
    unittest.main()
