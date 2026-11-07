# MoonDog Beta publisher

This repository-managed PowerShell command publishes an already-reviewed feature branch through the existing GitHub pull-request and guarded-merge process. It does not create Beta packages itself. A test-only change must not invent a Beta version.

## Requirements and installation

- Open the MoonDog repository root as the VS Code workspace.
- Install PowerShell 7 (`pwsh`), Git, Python, and Node.js. The publisher runs the existing Python and Node checks in a temporary Git worktree with `core.autocrlf=false`; this preserves byte-for-byte package/source integrity checks on Windows.
- Configure Git Credential Manager for the GitHub account that is authorized to push to `JHFMoon/MoonDog-Service-OS`. The script reads credentials through `git credential fill` into process memory for GitHub API calls. Do not put tokens in task arguments, files, shell history, or logs.
- The repository includes `.vscode/tasks.json` and `.vscode/publish-moondog-beta.ps1`; no user-profile copy or machine-specific path is needed. Reload the VS Code window after checking out a version that adds or changes tasks.
- Copilot can discover the repository skill in `.github/skills/moondog-beta-publisher/SKILL.md`. ChatGPT and other assistants should read this guide and the skill before acting.

## Run a dry run

From the repository root, on a named feature branch based on current `origin/main`:

```powershell
pwsh -NoProfile -NonInteractive -File ./.vscode/publish-moondog-beta.ps1 -RepositoryRoot . -DryRun
```

Omitting both `-Publish` and `-DryRun` also selects dry-run mode. A dry run performs repository, scope, classification, test, source/package integrity, and publication-boundary checks, but does not push, create a PR, approve, merge, or release anything.

For a focused, read-only outgoing-history check that can also be used for protected publisher changes, run:

```powershell
pwsh -NoProfile -NonInteractive -File ./.vscode/publish-moondog-beta.ps1 -RepositoryRoot . -VerifyOutgoingHistory
```

This scans all objects reachable from the verified `origin/main` base and current candidate using both history scanners sourced from that base. It does not publish or change refs.

## Publish explicitly

First review and commit only the intended changes. Confirm the branch scope and run the dry run. Then either:

1. In VS Code, choose **Terminal → Run Task… → MoonDog: Publish Beta** (or **Ctrl+Shift+P → Tasks: Run Task**).
2. Or explicitly run:

   ```powershell
   pwsh -NoProfile -NonInteractive -File ./.vscode/publish-moondog-beta.ps1 -RepositoryRoot . -Publish
   ```

The task has no save/startup trigger. Its `-Publish` argument runs only when a person explicitly selects the task. The separate **MoonDog: Update main** task retains its existing safe folder-open synchronization behavior and never publishes.

The publisher requires a clean worktree, correct repository and remote, a committed feature branch based on `origin/main`, and a trusted-policy classification that permits the candidate. It runs trusted-main change classification and full outgoing-history scans, Python and Node tests, source/package integrity checks, and the publication-boundary check in an exact-byte temporary worktree. Before pushing, it rejects ambiguous remotes, alternate push URLs, mirrors, push refspecs, push options, tag pushes, changed source commits, and unexpected destination branches. The push names the verified commit SHA and one explicit branch ref; the remote ref is read back and checked against that SHA. It creates or reuses the PR using the repository template, verifies the exact PR file list/head and required exact-head checks, and then waits for the repository's guarded merge. It never approves or merges itself.

Protected automation, policy, workflow, security-scanner, critical preservation-test, or unknown paths must remain blocked unless the trusted repository policy explicitly permits them. Owner review does not override a `protected` classification. Do not edit the classifier or guarded workflow as part of a publisher PR to make that PR eligible.

## Reports, timeouts, and recovery

- `DRY RUN`: checks passed; no remote publication action occurred.
- `PUBLISHED — WAITING FOR GUARDED REVIEW`: a PR exists; no merge is claimed.
- `VERIFIED`: guarded merge, post-merge checks, manifest checks, and safe local-main synchronization completed.
- `BLOCKED`: stop and follow the exact reported owner action. Do not repeatedly retry a failing or unchanged candidate.

The CI and post-merge waits are bounded by `-TimeoutMinutes` (1–60; default 25). At timeout, the publisher makes one final PR/check-state query so an externally completed merge or completed check is recognized. If the run still times out or the process is interrupted:

1. Inspect the printed PR number and exact SHA on GitHub. Do not start another publish until the PR status and exact-head checks are known.
2. If the PR is still open, let the guarded review/check process proceed; the publisher will not approve or merge.
3. If GitHub already merged it, obtain the exact reviewed PR head SHA from the PR's commit history and use recovery mode:

   ```powershell
   pwsh -NoProfile -NonInteractive -File ./.vscode/publish-moondog-beta.ps1 -RepositoryRoot . -RecoverMergedPR -PullRequestNumber 123 -ExpectedHeadSha 0123456789abcdef0123456789abcdef01234567
   ```

   Recovery requires an already-merged same-repository PR targeting `main`, and refuses a PR whose current head differs from `-ExpectedHeadSha`. It verifies the actual GitHub merge event, a successful Guarded PR Merge job that completed its merge step for that PR, successful exact-head Publication Check and Clean Install Proof, and successful post-merge Publication Check and Public Repository History Safety Audit on the exact merge commit. It verifies the complete Stable manifest entry and the Beta package identity/digest at the merge parent and merge commit; later `main` commits are not treated as this PR's release evidence. Recovery performs no push, PR creation, approval, merge, package build, or release, but it can fast-forward a clean local `main` worktree after verification.
4. If local `main` is dirty or has local-only commits, recovery stops without modifying it. Preserve and resolve that work explicitly before syncing.
5. If checks failed, do not rerun an unchanged candidate. Follow the workflow failure details and repository review policy.

## Data and release boundaries

PR scope must not contain real customer, employee, store, dealership, VIN, repair-order, report, history, diagnostics, backup, Files To Learn, credential, token, private-key, machine-state, or private Workspace data. Use only synthetic fixtures. The script does not read or modify private Workspace contents.

Stable remains under the existing reviewed Stable Release workflow. No local installation, dealership deployment, force push, direct merge, protection bypass, or private Workspace modification is permitted.
