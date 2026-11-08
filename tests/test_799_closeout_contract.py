"""The real #799 registry cannot turn partial UI evidence into a closure."""
import copy
import json
from pathlib import Path
import unittest
from scripts.issue_auto_close import parse_matrix, evidence_shape, close_if_ready

ROOT=Path(__file__).resolve().parents[1]

class LowTouchCloseoutContractTests(unittest.TestCase):
    def setUp(self):
        self.matrix=parse_matrix((ROOT/'docs/ROADMAP-ACCEPTANCE-MATRIX.md').read_text())
        self.record=json.loads((ROOT/'docs/ISSUE-CLOSEOUT-EVIDENCE.json').read_text())['issues']['799']
        self.manifest=json.loads((ROOT/'updates/manifest.json').read_text())

    def test_registered_criteria_are_complete_but_rendered_summary_is_explicitly_unverified(self):
        self.assertEqual(set(self.matrix[799]),{f'799-{n:02}'for n in range(1,8)})
        self.assertTrue(all(self.matrix[799][f'799-{n:02}']for n in range(1,7)))
        self.assertFalse(self.matrix[799]['799-07'])
        self.assertEqual(evidence_shape(799,self.matrix,self.record),['799-07 has not reached VERIFIED COMPLETE'])
        for proof in self.record['criteria'].values():
            for name in proof['tests']:self.assertTrue((ROOT/name).is_file(),name)

    def test_actual_unverified_registry_never_reads_closeout_proofs_or_mutates_github(self):
        class ReadOnlyIssue:
            repo='JHFMoon/MoonDog-Service-OS'
            def __init__(self):self.actions=[]
            def request(self,method,endpoint,data=None):
                self.actions.append((method,endpoint))
                if method=='GET'and endpoint.endswith('/issues/799'):return {'state':'open'}
                raise AssertionError('Incomplete acceptance must not proceed to proof reads or mutations')
        api=ReadOnlyIssue()
        result=close_if_ready(api,799,self.record,self.matrix,self.manifest,'a'*40,False)
        self.assertEqual(result['status'],'open/not-eligible')
        self.assertEqual(result['reasons'],['799-07 has not reached VERIFIED COMPLETE'])
        self.assertEqual(api.actions,[('GET','repos/JHFMoon/MoonDog-Service-OS/issues/799')])

    def test_marking_the_ui_row_complete_cannot_substitute_for_missing_structured_proof(self):
        matrix=copy.deepcopy(self.matrix);matrix[799]['799-07']=True
        self.assertIn('799-07 is missing a structured evidence entry',evidence_shape(799,matrix,self.record))
        record=copy.deepcopy(self.record);record['criteria']['799-07']={'kind':'field','pr':806,'tests':['tests/test_ci_failure_checkpoint.py']}
        self.assertIn('799-07 has no recognized verification kind',evidence_shape(799,matrix,record))

if __name__=='__main__':unittest.main()
