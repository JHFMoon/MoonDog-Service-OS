"""Synthetic negative-control for issue #799 live failure-reporting proof.

This test is intentionally failing ONLY on an unmerged draft PR. Never merge.
Close the draft after the GitHub Actions bot posts its privacy-safe checkpoint.
No store, customer, employee, RO/VIN, credentials or operational data is used.
"""
import unittest


class IntentionalLiveFailure(unittest.TestCase):
    def test_expected_failure_checkpoint_delivery(self):
        self.fail("Synthetic #799 negative-control: prove trusted failure checkpoint, not a product regression")


if __name__ == "__main__":
    unittest.main()
