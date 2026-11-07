---
name: moondog-beta-publisher
description: "Use when asked to publish MoonDog Beta, run the MoonDog: Publish Beta VS Code task, or recover/verify an existing MoonDog Beta publication."
---

# MoonDog Beta publisher

Read [the publisher operator guide](../../../docs/BETA-PUBLISHER.md) before using the repository-managed script at `.vscode/publish-moondog-beta.ps1`.

- A plain request to explain or dry-run publishing is not authorization to publish. Invoke the real workflow only after the user explicitly requests publication.
- The publisher never stages or commits files and rejects dirty worktrees.
- Never approve, merge, force-push, promote Stable, deploy to dealerships, install locally, modify private Workspace data, or bypass a protected review.
- Treat a `BLOCKED` result as final until the named owner action is completed; do not retry an unchanged failure.
- For a timed-out run, inspect the existing PR and checks first. Use `-RecoverMergedPR -PullRequestNumber <number> -ExpectedHeadSha <exact-reviewed-head>` only for a PR already merged by GitHub's guarded process. Recovery verifies that exact head and may fast-forward a clean local `main` worktree; it is not wholly read-only.
- Report `VERIFIED`, `BLOCKED`, or `NOT APPLICABLE` with PR, SHA, tests, Beta version, Stable version, and owner action.
