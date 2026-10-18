"""Ensure unreadable Files To Learn sources cannot silently complete update follow-up."""
from pathlib import Path
import unittest

APP=(Path(__file__).resolve().parents[1]/"assets"/"app.js").read_text(encoding="utf-8")

class LearnedFileRetryTests(unittest.TestCase):
    def test_unreadable_files_hold_followup_receipt(self):
        segment=APP.split("async function reconcileLearnedFiles(",1)[1].split("async function runVerifiedUpdateFollowup()",1)[0]
        self.assertIn('handle.getFile()', segment)
        self.assertIn('failures++;const diagnostic=`Learned-source open deferred:', segment)
        self.assertIn('importFailed:true,readError:true,diagnostic,failedAt:now()', segment)
        self.assertIn('recordDiagnostic("FILES TO LEARN",diagnostic)', segment)
        self.assertNotIn('} catch (_) {} }', segment)
        self.assertIn('return {failures,attempts,recovered,unsupported,skipped};', segment)

    def test_retry_receipt_is_only_cleared_on_success(self):
        segment=APP.split("async function runVerifiedUpdateFollowup()",1)[1].split("const folderWatch=",1)[0]
        self.assertIn('result?.deferred||result?.failures',segment)
        self.assertIn('localStorage.removeItem(key)',segment)
        self.assertLess(segment.index('result?.deferred||result?.failures'),segment.rindex('localStorage.removeItem(key)'))

if __name__=="__main__":
    unittest.main()
