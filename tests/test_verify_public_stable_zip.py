"""Synthetic production-validator regressions; no dealership data or release mutation."""
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from verify_public_stable_zip import PACKAGE_ROOT, digest, verify

VERSION = "0.10.17"
WORKSPACE = "System Files/Workspace/README.txt"
FILES = {
    "00 - OPEN DASHBOARD.html": b"<html>synthetic launcher</html>",
    "System Files/index.html": b"<html>synthetic runtime</html>",
    WORKSPACE: b"SYNTHETIC EMPTY WORKSPACE README ONLY",
}


def fixture(root, extras=None, *, corrupt=False, bad_sidecar=False, extra_dirs=()):
    root = Path(root)
    entries = dict(FILES)
    entries.update(extras or {})
    catalog = [{"path": name, "size": len(data), "sha256": digest(data)}
               for name, data in sorted(entries.items()) if not name.startswith("PRIVATE-EXTRA")]
    embedded = {"format": "service-operations-dashboard-clean-install", "formatVersion": 1,
                "version": VERSION, "packageRoot": PACKAGE_ROOT, "applicationRoot": "System Files",
                "workspaceRoot": "System Files/Workspace", "workspaceProtectedFromUpdates": True,
                "files": catalog}
    zip_path = root / "Service-Operations-Dashboard.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(PACKAGE_ROOT + "/", b"")
        archive.writestr(PACKAGE_ROOT + "/System Files/Workspace/data/", b"")
        for name in extra_dirs:
            archive.writestr(PACKAGE_ROOT + "/" + name.rstrip("/") + "/", b"")
        for path, content in entries.items():
            archive.writestr(PACKAGE_ROOT + "/" + path, content)
        archive.writestr(PACKAGE_ROOT + "/INSTALLATION-MANIFEST.json", json.dumps(embedded))
    expected = digest(zip_path.read_bytes())
    if corrupt:
        zip_path.write_bytes(zip_path.read_bytes() + b"tampered")
    sidecar = root / "Service-Operations-Dashboard.zip.sha256"
    sidecar.write_text(("0" * 64 if bad_sidecar else expected) +
                       "  Service-Operations-Dashboard.zip\n")
    release = {"format": "service-operations-dashboard-release-asset", "version": VERSION,
               "asset": "Service-Operations-Dashboard.zip", "workspaceProtectedFromUpdates": True,
               "sha256": expected, "runtime": [item for item in catalog if item["path"].startswith("System Files/")]}
    manifest = root / "Service-Operations-Dashboard.manifest.json"
    manifest.write_text(json.dumps(release))
    return zip_path, manifest, sidecar


class PackageTests(unittest.TestCase):
    def test_official_inventory_and_byte_contract(self):
        with tempfile.TemporaryDirectory() as path:
            self.assertRegex(verify(*fixture(path), VERSION), r"^[0-9a-f]{64}$")

    def test_release_digest_cannot_be_rewritten_or_tampered(self):
        for kw in ({"bad_sidecar": True}, {"corrupt": True}):
            with self.subTest(kw=kw), tempfile.TemporaryDirectory() as path:
                with self.assertRaisesRegex(ValueError, "Checksum|hash mismatch"):
                    verify(*fixture(path, **kw), VERSION)

    def test_rejects_private_workspace_even_when_manifest_and_hashes_are_consistent(self):
        with tempfile.TemporaryDirectory() as path:
            args = fixture(path, {"System Files/Workspace/data/current-state.json": b'{}'})
            with self.assertRaisesRegex(ValueError, "initialized/private"):
                verify(*args, VERSION)

    def test_rejects_unlisted_zip_file(self):
        with tempfile.TemporaryDirectory() as path:
            args = fixture(path, {"PRIVATE-EXTRA.json": b'"synthetic"'})
            with self.assertRaisesRegex(ValueError, "Unlisted"):
                verify(*args, VERSION)

    def test_rejects_unlisted_directory_metadata(self):
        with tempfile.TemporaryDirectory() as path:
            args = fixture(path, extra_dirs=["System Files/Workspace/Dealer-Acme"])
            with self.assertRaisesRegex(ValueError, "unlisted directory"):
                verify(*args, VERSION)

    def test_rejects_escape_and_case_alias(self):
        for name in ("../outside.txt", "System Files/INDEX.HTML"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as path:
                args = fixture(path, {name: b"synthetic"})
                with self.assertRaisesRegex(ValueError, "Unsafe ZIP|case collision"):
                    verify(*args, VERSION)


if __name__ == "__main__":
    unittest.main()
