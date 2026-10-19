# Verified automatic GitHub issue closure

This is an **issue closer**, not a coding agent. It does not implement unfinished features, certify physical Windows hardware, invent test results, merge blocked drafts, or promote Stable.

## Runtime and security

- Workflow: .github/workflows/verified-issue-closure.yml
- Protected evaluator: scripts/issue_auto_close.py
- Evidence registry: docs/ISSUE-CLOSEOUT-EVIDENCE.json
- Criterion acceptance: docs/ROADMAP-ACCEPTANCE-MATRIX.md
- Synthetic tests: tests/test_issue_auto_close.py

The workflow runs trusted code checked out from **protected main** after successful main Publication Check runs, on main pushes, hourly, and by manual dry-run dispatch. It never executes text from issues or pull requests. It is serialized and receives contents, actions and pull request read permission, plus issues write permission. Its protected script and workflow must enter main via independently reviewed protected PR: the existing automatic merge guard refuses workflow/script/test changes.

## Rules required before automatic closure

1. Each acceptance criterion must exist in the roadmap matrix and be marked **VERIFIED COMPLETE** in the **last status column**. The registered IDs must match the matrix IDs exactly: no omissions, additions or fabricated checklist completion.
2. Every criterion must cite a merged main PR and a synthetic regression file delivered by that PR. For a runtime criterion the cited PR must actually change assets or index.html.
3. Every cited PR must have successful **exact-head Publication Check** and **prove-clean-install** from the ruleset-authorized GitHub Actions app (15368), and no outstanding review threads.
4. The exact current main must also have an authorized successful Publication Check; a failed, missing or stale check prevents closure.
5. The registered Beta package PR must be a successfully checked merged trusted PR containing the package and manifest matching the current live Beta. Runtime changes must be ancestors of the package's base; test-only changes must already be on current main. Stable 0.10.17 remains unchanged.
6. **No live/browser test from the owner is ever required to close an issue.** Windows Edge, OneDrive, physical-device performance, installation, owner attestations, and EDGE-01…EDGE-08 are optional post-engineering field follow-up, not blocking acceptance. Record them honestly as untested unless performed. Automated source tests, synthetic fault injection, trusted CI and release provenance remain mandatory for applicable production requirements.
7. The issue must still be open when the verified closure transaction starts.

## Future issues

Register the issue in the evidence registry and create a corresponding matrix section with uniquely named criteria in a reviewed PR. No workflow-code modification is necessary for ordinary future criteria, except adding specific field-sensitive requirements to the protected field policy. The evidence registry's structure is:

    {
      "schemaVersion": 1,
      "issues": {
        "999": {
          "package_pr": 261,
          "criteria": {
            "999-01": {
              "kind": "runtime",
              "pr": 260,
              "tests": ["tests/device-open-ro-preferences.test.cjs"]
            },
            "999-02": {
              "kind": "test",
              "pr": 262,
              "tests": ["tests/durable-write-fault-matrix.test.cjs"]
            }
          }
        }
      }
    }

This record is **only an illustrative schema example**, not proof that issue 999 or any MoonDog acceptance criterion is satisfied. The supported required proof kinds are runtime and test. Field-only proof is not an accepted completion substitute. Do not require or fabricate a field_comment; owner field evidence is optional supplemental feedback outside the closure gate.

Initially all six issues are registered with intentionally empty evidence. They must stay open. A merged PR, a checked box, or a general completion comment is never sufficient by itself.

## Closure, retries and diagnostics

When all gates pass, the workflow adds a single marker-bearing completion comment, changes the GitHub issue state to closed/completed and re-reads the state. Repeated runs do not post duplicate comments or close anything twice. If the comment succeeds but the PATCH fails, the next run reuses its marker without repeating the comment.

An API failure, missing engineering proof, blocked required software work, unmerged code, outdated package, failed tests or unresolved substantive review keeps the issue open. Absence of user/browser or physical Windows/OneDrive testing NEVER blocks closure by itself. The tool cannot complete unfinished engineering in the background. Do not use PR text with Closes #... on partial umbrella work.

For a non-mutating proof, run GitHub Actions > Verified Issue Closure > Run workflow with dry_run set true. After a complete evidence update reaches protected main and authorized CI succeeds, the workflow closes an eligible issue automatically without a separate instruction to press Close.

Preserve real customer/employee/VIN/RO privacy, Workspace state, Stable protections, and Advisor Meeting behavior. Any real Windows results published to GitHub must be de-identified summaries only.
