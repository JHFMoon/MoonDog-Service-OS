"""Regression tests for update-gated Files To Learn reconciliation."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/"assets"/"app.js").read_text(encoding="utf-8")
UPDATER=(ROOT/"assets"/"moondog-update-settings.js").read_text(encoding="utf-8")
RECEIPT="moondog-verified-update-followup-v1"


class VerifiedUpdateFollowupTests(unittest.TestCase):
    def test_success_only_uses_installation_bound_journal(self):
        section=UPDATER[UPDATER.index('if (outcome.status === "installed") {'):]
        self.assertNotIn(RECEIPT,section)
        self.assertIn('installedVersion = outcome.version',section)
        self.assertIn('MoonDogUpdateInstall.apply(',UPDATER)

    def test_connection_followup_gated_by_exact_installed_version(self):
        section=APP[APP.index("async function runVerifiedUpdateFollowup()"):APP.index("const folderWatch=",APP.index("async function runVerifiedUpdateFollowup()"))]
        self.assertIn('if(!durableReceipt&&!parserRevisionChanged)return;',section)
        self.assertIn('await findVerifiedUpdateFollowup(connectedApplicationRoot)',section)
        self.assertIn('model.root===connectedRoot',section)
        self.assertIn('if(!selectedRootStillCurrent())return;',section)
        self.assertNotIn('localStorage.getItem',section)
        self.assertIn('!writeAuthority.canWrite',section)
        self.assertIn('parserRevisionChanged=previousParser?previousParser!==LEARNED_PARSER_REVISION:legacyImportState',section)
        self.assertIn('entry.kind||entry.importFailed||entry.recognized',section)
        self.assertIn('await reconcileLearnedFiles(LEARNED_PARSER_REVISION)',section)
        self.assertIn('model.autoImport.learnedParserRevision=LEARNED_PARSER_REVISION',section)
        self.assertIn('result?.deferred||result?.failures',section)
        self.assertNotIn('localStorage.removeItem',section)

    def test_layout_audit_is_read_only_and_preserves_legacy_origin(self):
        helper=APP[APP.index("async function auditInstalledRuntimeLayout("):APP.index("async function runVerifiedUpdateFollowup()",APP.index("async function auditInstalledRuntimeLayout("))]
        self.assertIn('hasDirectory(root, "System Files")',helper)
        self.assertIn('hasFile(root, "00 - OPEN DASHBOARD.html")',helper)
        self.assertIn('hasDirectory(system, "Workspace")',helper)
        self.assertIn('hasFile(root, "index.html")',helper)
        self.assertNotIn('await examine(workspace',helper)
        self.assertNotIn('removeEntry(',helper)
        self.assertNotIn('create:true',helper)

    def test_no_unconditional_full_learning_scan_on_connection(self):
        connect=APP[APP.index('async function finishConnection('):APP.index('async function connect()',APP.index('async function finishConnection('))]
        self.assertIn("runVerifiedUpdateFollowup()",connect)
        self.assertNotIn("['Learning-file reconciliation',()=>reconcileLearnedFiles()]",connect)
        self.assertIn("await new Promise(resolve=>setTimeout(resolve,0))",APP)

if __name__=="__main__":
    unittest.main()
