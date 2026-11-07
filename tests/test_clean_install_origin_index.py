"""Prove that a newly extracted release is immediately update-compatible.

Only synthetic application bytes are used; no dealership Workspace or browser
state is accessed, and pinned vendor downloads are not needed for the test.
"""
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "moondog_clean_distribution", ROOT / "scripts" / "build_distribution.py"
)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

SYNTHETIC_HTML = (
    '<!doctype html>\n<html lang="en"><head><title>Synthetic Store</title>'
    '</head><body>Unconfigured application</body></html>\n'
).encode("utf-8")


class CleanInstallOriginIndexTests(unittest.TestCase):
    def test_clean_package_has_exact_root_bridge_before_first_launch(self):
        runtime = ["index.html", "assets/app.js", *builder.VENDOR_BINARIES]
        def source_bytes(path, _vendor_dir):
            if path == "index.html":
                return SYNTHETIC_HTML
            return ("synthetic runtime " + path).encode("utf-8")

        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "Service-Operations-Dashboard.zip"
            with (patch.object(builder, "load_contract", return_value=("0.10.17", runtime)),
                  patch.object(builder, "source_bytes", side_effect=source_bytes),
                  patch.object(builder, "validate_vendor")):
                builder.build(archive_path, Path(directory))
            with zipfile.ZipFile(archive_path) as archive:
                package = "Service Operations Dashboard/"
                names = set(archive.namelist())
                self.assertIn(package + "00 - OPEN DASHBOARD.html", names)
                self.assertIn(package + "index.html", names)
                self.assertIn(package + "System Files/index.html", names)
                self.assertIn(package + "System Files/Workspace/data/", names)
                self.assertNotIn(package + "System Files/Workspace/data/settings.json", names)
                self.assertNotIn(package + "System Files/Workspace/data/current-state.json", names)
                root_index = archive.read(package + "index.html")
                app_index = archive.read(package + "System Files/index.html")
                self.assertEqual(app_index, SYNTHETIC_HTML)
                self.assertEqual(root_index, builder.compatibility_html(app_index))
                self.assertIn(b'<base href="System Files/">', root_index)
                manifest = json.loads(archive.read(package + "INSTALLATION-MANIFEST.json"))
                self.assertEqual(manifest["applicationRoot"], "System Files")
                self.assertEqual(manifest["workspaceRoot"], "System Files/Workspace")
                self.assertTrue(manifest["workspaceProtectedFromUpdates"])
                self.assertIn("index.html", [entry["path"] for entry in manifest["files"]])

    def test_origin_bridge_rejects_existing_base_and_invalid_application_html(self):
        for candidate in (
            b"<html><head><base href='other/'></head></html>",
            b"<html><head></head></html>",
            SYNTHETIC_HTML.replace(b"<head>", b"<head><base href='/'>"),
        ):
            with self.subTest(candidate=candidate):
                with self.assertRaises(SystemExit):
                    builder.compatibility_html(candidate)


if __name__ == "__main__":
    unittest.main()
