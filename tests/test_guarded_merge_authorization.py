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

    def test_html_comment_cannot_approve(self):
        self.assertFalse(has_explicit_approval("<!--\nMoonDog-Auto-Merge: yes\n-->"))
        self.assertFalse(has_explicit_approval("<!-- Markdown example:\nMoonDog-Auto-Merge: yes\n-->"))
        self.assertFalse(has_explicit_approval("<!-- MoonDog-Auto-Merge: yes -->"))
        self.assertFalse(has_explicit_approval("Note <!--\nMoonDog-Auto-Merge: yes\n-->"))

    def test_comment_fence_noise_cannot_approve(self):
        self.assertFalse(has_explicit_approval(
            "<!--\n```\nMoonDog-Auto-Merge: yes\n```\n-->"
        ))

    def test_visible_approval_after_comment_still_works(self):
        self.assertTrue(has_explicit_approval(
            "<!--\nMoonDog-Auto-Merge: no\n-->\nMoonDog-Auto-Merge: yes"
        ))

    def test_visible_revocation_after_comment_still_works(self):
        self.assertFalse(has_explicit_approval(
            "MoonDog-Auto-Merge: yes\n<!--\nMoonDog-Auto-Merge: yes\n-->\nMoonDog-Auto-Merge: no"
        ))

    def test_revocation(self):
        self.assertFalse(has_explicit_approval("MoonDog-Auto-Merge: yes\nMoonDog-Auto-Merge: no"))

    def test_hidden_html_block_is_not_authorization(self):
        self.assertFalse(has_explicit_approval(
            "<details>\nMoonDog-Auto-Merge: yes\n</details>"
        ))
        self.assertFalse(has_explicit_approval(
            "<div hidden>\nMoonDog-Auto-Merge: yes\n</div>"
        ))

    def test_fence_with_info_is_not_closed_by_another_opener(self):
        self.assertFalse(has_explicit_approval(
            "```python\n```javascript\nMoonDog-Auto-Merge: yes\n```"
        ))


if __name__ == "__main__":
    unittest.main()
