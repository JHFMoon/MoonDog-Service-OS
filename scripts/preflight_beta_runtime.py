#!/usr/bin/env python3
"""Fail fast on an un-packaged PR head before expensive verification starts."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import TextIO

from scripts.build_beta_package import current_beta_runtime_mismatches


def verify_candidate(root: Path, candidate_sha: str, output: TextIO | None = None) -> int:
    if output is None:
        output = sys.stdout
    try:
        mismatches = current_beta_runtime_mismatches(root)
    except SystemExit as error:
        detail = str(error) or "Beta package parity could not be established"
        print(f"FAIL: candidate head {candidate_sha}: {detail}", file=output)
        return 1

    if mismatches:
        print("WAIT: this PR head contains runtime changes not yet covered by the trusted Beta package.", file=output)
        print(f"Candidate PR head: {candidate_sha}", file=output)
        print("Action: the same-PR trusted Prepare Beta Package workflow must add the verified package; checks will rerun on that updated head.", file=output)
        print("Expensive tests were not run on this superseded package state.", file=output)
        print("Unmatched runtime paths: " + ", ".join(mismatches), file=output)
        return 1

    print(f"PASS: candidate head {candidate_sha} matches the digest-verified current Beta runtime.", file=output)
    return 0


def main() -> int:
    return verify_candidate(Path.cwd(), os.environ.get("CANDIDATE_SHA", "unknown"))


if __name__ == "__main__":
    raise SystemExit(main())
