"""Regression tests for update-gated Files To Learn reconciliation."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/"assets"/"app.js").read_text(encoding="utf-8")
UPDATER=(ROOT/"assets"/"moondog-update-settings.js").read_text(encoding="utf-8")
RECEIPT="moondog-verified-update-followup-v1"


class VerifiedUpdateFollowupTests(unittest.TestCase):
    def test_success_only_creates_receipt(self):
        section=UPDATER[UPDATER.index('if (outcome.status === "installed") {'):]
        self.assertIn(RECEIPT,section)
        self.assertIn('version: outcome.version',section)
        self.assertIn('verifiedAt:',section)

    def test_connection_followup_gated_by_exact_installed_version(self):
        section=APP[APP.index("async function runVerifiedUpdateFollowup()"):APP.index("const folderWatch=",APP.index("async function runVerifiedUpdateFollowup()"))]
        self.assertIn('receipt?.version!==VERSION',section)
        self.assertIn('!writeAuthority.canWrite',section)
        self.assertIn('await reconcileLearnedFiles()',section)
        self.assertIn('result?.deferred||result?.failures',section)
        self.assertIn('localStorage.removeItem(key)',section)

    def test_layout_audit_is_read_only_and_preserves_legacy_origin(self):
        section=APP[APP.index("async function runVerifiedUpdateFollowup()"):APP.index("const folderWatch=",APP.index("async function runVerifiedUpdateFollowup()"))]
        self.assertIn('getDirectoryHandle("System Files")',section)
        self.assertIn('getFileHandle("00 - OPEN DASHBOARD.html")',section)
        self.assertIn('["assets","vendor","Workspace"]',section)
        self.assertNotIn('removeEntry(',section)
        self.assertNotIn('create:true',section)
        self.assertNotIn('root.getFileHandle("index.html")',section)

    def test_no_unconditional_full_learning_scan_on_connection(self):
        connect=APP[APP.index('async function finishConnection('):APP.index('async function connect()',APP.index('async function finishConnection('))]
        self.assertIn("runVerifiedUpdateFollowup()",connect)
        self.assertNotIn("['Learning-file reconciliation',()=>reconcileLearnedFiles()]",connect)
        self.assertIn("await new Promise(resolve=>setTimeout(resolve,0))",APP)

if __name__=="__main__":
    unittest.main()
