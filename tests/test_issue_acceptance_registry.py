"""Prevent verified roadmap criteria losing structured completion evidence."""
import json
from unittest import TestCase

from scripts.issue_auto_close import EVIDENCE, MATRIX, evidence_shape, parse_matrix


class AcceptanceRegistryTests(TestCase):
    def test_each_verified_criterion_has_valid_structured_evidence(self):
        matrix = parse_matrix(MATRIX.read_text(encoding="utf-8"))
        registry = json.loads(EVIDENCE.read_text(encoding="utf-8"))
        self.assertEqual(registry["schemaVersion"], 1)
        self.assertEqual(set(map(str, matrix)), set(registry["issues"]))
        for issue, criteria in matrix.items():
            proofs = registry["issues"][str(issue)]["criteria"]
            self.assertIsInstance(proofs, dict)
            self.assertFalse(set(proofs) - set(criteria),
                             "Unknown evidence criterion for #" + str(issue))
            for key, verified in criteria.items():
                if not verified:
                    continue
                with self.subTest(criterion=key):
                    self.assertIn(key, proofs, key + " missing structured proof")
                    problems = evidence_shape(issue, {issue: {key: True}},
                                              {"criteria": {key: proofs[key]}})
                    self.assertEqual(problems, [], key + ": " + "; ".join(problems))
