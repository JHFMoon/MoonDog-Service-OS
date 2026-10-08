from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = spec_from_file_location("build_beta_package", ROOT / "scripts" / "build_beta_package.py")
MODULE = module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BetaBuilderTests(unittest.TestCase):
    def test_next_beta_only_increments_preview_number(self):
        self.assertEqual(MODULE.next_beta("0.10.18-beta.2"), "0.10.18-beta.3")

    def test_three_way_merge_preserves_beta_only_and_reviewed_source_changes(self):
        base = b"a\nbeta-anchor\nx1\nx2\nx3\nsource-anchor\nz\n"
        current = b"a\nbeta-anchor\nbeta-only\nx1\nx2\nx3\nsource-anchor\nz\n"
        candidate = b"a\nbeta-anchor\nx1\nx2\nx3\nsource-anchor changed\nz\n"
        merged = MODULE.merge_text(current, base, candidate, "example.js").decode("utf-8")
        self.assertIn("beta-only", merged)
        self.assertIn("source-anchor changed", merged)
        self.assertNotIn("<<<<<<<", merged)


if __name__ == "__main__":
    unittest.main()
