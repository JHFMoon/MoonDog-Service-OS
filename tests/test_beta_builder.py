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
        base = b"top\nshared\nbottom\n"
        current = b"top\nbeta-only\nshared\nbottom\n"
        candidate = b"top\nshared changed\nbottom\n"
        merged = MODULE.merge_text(current, base, candidate, "example.js").decode("utf-8")
        self.assertIn("beta-only", merged)
        self.assertIn("shared changed", merged)
        self.assertNotIn("<<<<<<<", merged)


if __name__ == "__main__":
    unittest.main()
