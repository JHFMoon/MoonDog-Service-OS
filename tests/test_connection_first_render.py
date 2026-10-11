"""Regression guard: connecting a folder should not repaint every dashboard view twice."""
from pathlib import Path
import unittest

SOURCE = (Path(__file__).resolve().parents[1] / "assets" / "app.js").read_text(encoding="utf-8")


class ConnectionRenderRegressionTests(unittest.TestCase):
    def test_post_connect_reconciliation_does_not_render_every_view(self):
        start = SOURCE.index("  async function postConnectReconciliation(")
        end = SOURCE.index("  async function connect(", start)
        body = SOURCE[start:end]
        self.assertIn('setConnectionState("CONNECTED")', body)
        self.assertNotIn("renderAll();", body)
        self.assertNotIn("renderSetup();", body)
        self.assertNotIn("renderRecovery();", body)

    def test_finish_connection_performs_first_full_render(self):
        start = SOURCE.index("  async function finishConnection(")
        end = SOURCE.index("  async function postConnectReconciliation(", start)
        body = SOURCE[start:end]
        self.assertIn("await postConnectReconciliation(permissionWasPending);", body)
        self.assertIn("renderAll(); renderSetup(); renderRecovery();", body)
        self.assertEqual(body.count("renderAll();"), 1)
        self.assertIn("startFolderWatch();", body)


if __name__ == "__main__":
    unittest.main()
