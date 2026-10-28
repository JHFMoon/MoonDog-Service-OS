"""Keep guarded post-merge Beta packaging free of untracked bytecode."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]

class BetaPackagingBytecodeTests(unittest.TestCase):
    def test_python_bytecode_is_disabled_for_all_beta_pipeline_jobs(self):
        workflow=(ROOT/".github"/"workflows"/"prepare-beta-package.yml").read_text(encoding="utf-8")
        env_block=workflow.split("\nenv:\n",1)[1].split("\nconcurrency:",1)[0]
        self.assertIn("PYTHONDONTWRITEBYTECODE: '1'",env_block)
        self.assertIn("git status --porcelain",workflow)
        self.assertIn("Verify explicit authorization and protected path boundaries",workflow)
        self.assertIn("check-paths",workflow)

if __name__=="__main__":
    unittest.main()
