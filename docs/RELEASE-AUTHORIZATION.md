# James-approved MoonDog release contract

**Standing authorization:** James authorizes automatic merging of all existing and future same-repository pull requests after the exact-head Publication Check, Clean Install Proof, an exact-head Codex review **or an owner-attested GitHub PR review**, applicable tests, and GitHub protections pass. This includes previously gated PRs and Stable release-related PRs. Do not ask for per-PR merge approval. The repository PR template carries the standalone `MoonDog-Auto-Merge: yes` directive; the trusted main-branch policy is the source of the standing authorization.


Merging a Stable promotion PR is authorized by this standing instruction. Publication still runs only through the existing `.github/workflows/stable-release.yml` workflow after protected merge and successful main Publication Check; never install it or dispatch a separate manual deployment merely because a PR merged.

## Beta delivery (default)
- Base feature work on the active Beta line. Run Publication Check and relevant regression/security/update-package compatibility tests.
- When tests pass, merge eligible Beta work and update the Beta manifest + package + digest atomically so installed Beta clients see the new version. Never point Beta at unvalidated branch files.
- Preserve protected local Workspace, customer and store operational data. Fail closed on checksum, data-boundary, rollback or compatibility failures.
- The agent performs GitHub actions; if an account permission, required status check, or repo setting prevents completion, report the exact blocker rather than claiming publication.
- GitHub does not autonomously interpret issues as instructions or execute an agent. A live execution agent or configured bot must create/test/merge changes. Issue #34 tracks infrastructure to remove remaining manual steps.

## Stable promotion
- Stable changes may be proposed in a reviewed main PR under the standing authorization above; no separate PR merge approval is required.
- The existing Stable release workflow remains the only publication path. It validates the current main commit, complete synthetic test suite, publication and history audits, manifest/package version, tagged package URL, and SHA-256 before creating or repairing a formal release.
- Do not install a Stable release. A merged PR is source integration, not installation.
- The GitHub Stable workflow checks a successful post-merge main Publication Check against the Stable manifest version authorized by the reviewed PR. It only publishes when the matching formal non-prerelease GitHub Release, SHA-256-verified asset, or Latest designation is missing. Completed Stable releases are not republished on ordinary changes.
- A manual emergency Stable workflow dispatch must provide an approval reference. The input is an operator assertion, not identity proof; grant dispatch permissions only to trusted maintainers.
- Publish immutable versioned release asset and clean-install package, verify SHA-256 and update discovery; if any gate fails, keep prior Stable.

## Installation
- Application may automatically **check** for verified new Stable releases and show a visible non-blocking notification with release notes.
- Installation into a local browser-authorized folder requires James's confirmation. No silent overwrite of locally held operational files.
- Deliver a concise completion record: change, Beta/Stable version, validation result, deployment URL, and any blockers.

## Automation boundary
After the protected policy change is merged, the trusted main-branch Guarded PR Merge workflow enforces the standing authorization for eligible open PRs. It waits for exact-head Publication Check, Clean Install Proof, and either a clean Codex review or a qualifying owner-attested GitHub PR review, then uses the ordinary GitHub merge API so active rulesets and required checks remain authoritative. If it refreshes a branch, it waits for the new head to include current main and dispatches both verification workflows for that exact branch before another merge attempt.

The PR template supplies the standalone `MoonDog-Auto-Merge: yes` line to future PRs, and existing open PRs carry that line. The policy document alone is not an executor; no continuous agent run or installation is implied. Issue #34 tracks broader release/update and workflow integration work that remains independent of this merge authorization.

## Chat-only review mode (no external coding agent)

At James's direction, trusted release workflows must **not automatically summon Codex or any other external agent**. The packaging workflow publishes a same-PR candidate without posting an agent-review request. The guarded merger evaluates GitHub's existing authenticated, exact-head owner-attested review alternative, the exact-head Publication Check and Clean Install Proof, any already-present authenticated unresolved findings, protected paths, and GitHub merge controls. A missing or stale review is a pending condition, **not** permission to request another agent or bypass the gate.

The trusted policy and workflows themselves remain protected automation files. A change to them requires a separately reviewed bootstrap PR using ordinary GitHub-authorized merge permissions; the automatic merger does not merge its own policy changes. This mode does not constitute independent human review or device validation.

## Owner-attested manual review when Codex review is unavailable

James explicitly permits a review submitted through the connected ChatGPT GitHub account to satisfy the *repository automation review gate*, including a self-attested PR by `JHFMoon`. This is **not an independent Codex or third-party review**. The reviewer must actually inspect the current PR diff and the exact SHA, report findings, and submit a **GitHub pull-request review** using the authenticated `JHFMoon` account, with these two standalone lines:

```text
MoonDog-Owner-Review: approved
Reviewed-Commit: <full 40-character lowercase PR head SHA>
```

A PR description, issue comment, review by another account, stale commit, or summary without those lines does not pass. A newer owner request for changes or *any authenticated Codex findings on that same SHA* vetoes the fallback. The review is stored in the GitHub review audit trail. On every new PR head (including an additive main refresh), a fresh review and fresh CI are required. The ordinary branch protection and required status checks remain mandatory: this exception neither forges a Codex bot receipt nor bypasses GitHub merge restrictions.

The trusted main-branch `.github/guarded-merge-policy.json` explicitly enables the alternative. Changes to this policy, merge workflows, guard scripts, and their tests are **protected automation changes**: propose them in a separate PR, run proof checks, and use the established protected bootstrap/manual merge path. The automatic guarded merger must continue rejecting its own protected policy files.
