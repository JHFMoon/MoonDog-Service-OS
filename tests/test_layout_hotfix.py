import base64
import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class LayoutHotfixTests(unittest.TestCase):
    def test_meeting_presentation_is_hidden_off_tab(self):
        source = (ROOT / "src" / "meeting-presenter.js").read_text(encoding="utf-8")
        css = (ROOT / "src" / "meeting-presenter.css").read_text(encoding="utf-8")
        runtime_js = (ROOT / "assets" / "daily-ops.js").read_text(encoding="utf-8")
        runtime_css = (ROOT / "assets" / "meeting.css").read_text(encoding="utf-8")
        self.assertIn('const visible=state.enabled&&view.classList.contains("active");', source)
        self.assertIn('else if(event.detail?.view){stopTimer();paint();}', source)
        self.assertIn('#view-meeting.meeting-scoreboard.presentation-active:not(.active){display:none!important}', css)
        self.assertIn('const visible=state.enabled&&view.classList.contains("active");', runtime_js)
        self.assertIn('#view-meeting.meeting-scoreboard.presentation-active:not(.active){display:none!important}', runtime_css)

    def test_system_update_text_wraps(self):
        css = (ROOT / "assets" / "product-settings.css").read_text(encoding="utf-8")
        self.assertIn('#settings-update #updatePlan', css)
        self.assertIn('white-space:pre-wrap', css)
        self.assertIn('overflow-wrap:anywhere', css)
        self.assertIn('#settings-update .button-row{flex-wrap:wrap}', css)

    def test_beta_hotfix_package_contains_layout_fix(self):
        manifest = json.loads((ROOT / "updates" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual("0.10.12-beta.2", manifest["beta"]["version"])
        package_path = ROOT / "updates" / "packages" / "moondog-0.10.12-beta.2.json"
        raw = package_path.read_bytes()
        self.assertEqual(manifest["beta"]["sha256"], hashlib.sha256(raw).hexdigest())
        package = json.loads(raw)
        self.assertEqual("0.10.12-beta.2", package["version"])
        files = {entry["path"]: base64.b64decode(entry["contentBase64"]).decode("utf-8")
                 for entry in package["files"]}
        self.assertIn('const VERSION = "0.10.12-beta.2";', files["assets/app.js"])
        self.assertIn('#view-meeting.meeting-scoreboard.presentation-active:not(.active){display:none!important}',
                      files["assets/meeting.css"])
        self.assertIn('white-space:pre-wrap', files["assets/product-settings.css"])


if __name__ == "__main__":
    unittest.main()
