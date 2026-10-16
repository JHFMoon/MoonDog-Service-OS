"""Regression tests for explicit, revocable PR merge authorization."""
import unittest
from scripts.guarded_merge_authorization import has_explicit_approval


class ConsentTests(unittest.TestCase):
    def test_positive(self):
        self.assertTrue(has_explicit_approval("MoonDog-Auto-Merge: yes"))

    def test_negation_and_quote(self):
        self.assertFalse(has_explicit_approval("No `MoonDog-Auto-Merge: yes` marker."))
        self.assertFalse(has_explicit_approval("> MoonDog-Auto-Merge: yes"))
        self.assertFalse(has_explicit_approval("- MoonDog-Auto-Merge: yes"))
        self.assertFalse(has_explicit_approval("Do not use MoonDog-Auto-Merge: yes"))

    def test_fenced_example(self):
        self.assertFalse(has_explicit_approval("~~~\nMoonDog-Auto-Merge: yes\n~~~"))

    def test_revocation(self):
        self.assertFalse(has_explicit_approval("MoonDog-Auto-Merge: yes\nMoonDog-Auto-Merge: no"))


if __name__ == "__main__":
    unittest.main()
