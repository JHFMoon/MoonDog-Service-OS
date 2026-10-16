"""Protect redaction and history-coverage behavior of local audit diagnostics."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "audit_vin_provenance.py"
spec = importlib.util.spec_from_file_location("vin_provenance", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def synthetic_vin():
    base = "1HGCM826" + "0" + "3A004352"
    total = sum(mod.VALUES[ch] * weight for ch, weight in zip(base, mod.WEIGHTS))
    check = "X" if total % 11 == 10 else str(total % 11)
    return base[:8] + check + base[9:]


class HistoryTriageTests(unittest.TestCase):
    def test_matches_valid_check_digit_without_embedded_vin_literal(self):
        candidate = synthetic_vin().encode()
        self.assertTrue(mod.valid_vin(candidate))
        self.assertFalse(mod.valid_vin(candidate[:8] + b"Z" + candidate[9:]))

    def test_history_objects_and_redacted_private_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = root / "source"
            repo.mkdir()
            def git(*args):
                subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)
            git("init", "-q")
            git("config", "user.email", "tester@example.com")
            git("config", "user.name", "Fixture Author")
            target = repo / "tests" / "synthetic.txt"
            target.parent.mkdir()
            target.write_text("Synthetic fixture " + synthetic_vin(), encoding="utf-8")
            git("add", ".")
            git("commit", "-qm", "synthetic one")
            target.write_text("No identifiers in current file", encoding="utf-8")
            git("commit", "-qam", "remove synthetic fixture")
            report = mod.inspect(repo)
            self.assertEqual(report["candidate_blobs"], 1)
            self.assertEqual(report["candidates"][0]["path_category"], "tests")
            self.assertEqual(report["candidates"][0]["classification"], "UNVERIFIED_REQUIRES_PRIVATE_REVIEW")
            self.assertNotIn(synthetic_vin(), json.dumps(report))
            output = root / "private.json"
            mod.private_write(output, repo, report)
            self.assertEqual(json.loads(output.read_text())["candidate_blobs"], 1)
            with self.assertRaises(ValueError):
                mod.private_write(repo / "unsafe-report.json", repo, report)


    def test_temporary_redacted_ci_history_inventory(self):
        """Temporary investigation only: emit aggregate category counts, never identifiers."""
        import os
        from collections import Counter
        if os.environ.get("GITHUB_WORKFLOW") != "Publication check":
            self.skipTest("Deep history inventory runs only in Publication Check")
        data = mod.inspect(Path(__file__).resolve().parents[1])
        by_category = Counter(entry["path_category"] for entry in data["candidates"])
        print("HISTORY_TRIAGE_REDACTED_COUNT", data["candidate_blobs"], flush=True)
        print("HISTORY_TRIAGE_CATEGORIES", json.dumps(dict(sorted(by_category.items()))), flush=True)
        print("HISTORY_TRIAGE_NO_IDENTIFIERS_LOGGED", flush=True)


if __name__ == "__main__":
    unittest.main()
