import base64
import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class BackupRetentionReleaseTests(unittest.TestCase):
    def package(self, channel):
        manifest = json.loads((ROOT / "updates" / "manifest.json").read_text(encoding="utf-8"))
        release = manifest[channel]
        path = ROOT / "updates" / "packages" / f"moondog-{release['version']}.json"
        raw = path.read_bytes()
        self.assertEqual(release["sha256"], hashlib.sha256(raw).hexdigest())
        package = json.loads(raw)
        self.assertEqual(release["version"], package["version"])
        self.assertIn("assets/maintenance.js", package["approvedFiles"])
        files = {
            entry["path"]: base64.b64decode(entry["contentBase64"]).decode("utf-8")
            for entry in package["files"]
        }
        return release, files

    def test_current_channels_publish_bounded_retention(self):
        stable, stable_files = self.package("stable")
        beta, beta_files = self.package("beta")
        self.assertEqual("0.10.14", stable["version"])
        self.assertEqual("0.10.15-beta.1", beta["version"])
        self.assertEqual("0.10.9", stable["minimumCompatibleVersion"])
        self.assertFalse(stable["migrationRequired"])
        self.assertIn('fullRecentDays:30,fullMonthlyMonths:12,fullMax:3,fullRefreshDays:30', stable_files["assets/maintenance.js"])
        self.assertIn('systemUpdateDays:30,systemUpdateMax:3', stable_files["assets/maintenance.js"])
        self.assertIn('automaticDays:30,automaticMax:50', stable_files["assets/maintenance.js"])
        self.assertIn("Automatic rolling retention backup", stable_files["assets/app.js"])
        self.assertIn("state.hasRecoverable || !currentOffer()", stable_files["assets/moondog-update-settings.js"])
        self.assertIn('const VERSION = "0.10.14";', stable_files["assets/app.js"])
        self.assertIn('const VERSION = "0.10.15-beta.1";', beta_files["assets/app.js"])

    def test_retention_policy_is_visible_in_runtime(self):
        app = (ROOT / "assets" / "app.js").read_text(encoding="utf-8")
        maintenance = (ROOT / "assets" / "maintenance.js").read_text(encoding="utf-8")
        self.assertIn("then 1/month for", app)
        self.assertIn("Interrupted update recovery is still active", maintenance)
        self.assertIn("SYSTEM UPDATE ROLLBACK PRUNED", maintenance)


if __name__ == "__main__":
    unittest.main()
