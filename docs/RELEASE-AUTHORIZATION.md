# James-approved MoonDog release contract

**Standing authorization:** James authorizes automatic merging of all existing and future same-repository pull requests after the exact-head Publication Check, Clean Install Proof, Codex review, applicable tests, and GitHub protections pass. This includes previously gated PRs and Stable release-related PRs. Do not ask for per-PR merge approval. The repository PR template carries the standalone `MoonDog-Auto-Merge: yes` directive; the trusted main-branch policy is the source of the standing authorization.


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
After the protected policy change is merged, the trusted main-branch Guarded PR Merge workflow enforces the standing authorization for eligible open PRs. It waits for exact-head Publication Check, Clean Install Proof, and Codex review with no findings, then uses the ordinary GitHub merge API so active rulesets and required checks remain authoritative. If it refreshes a branch, it waits for the new head to include current main and dispatches both verification workflows for that exact branch before another merge attempt.

The PR template supplies the standalone `MoonDog-Auto-Merge: yes` line to future PRs, and existing open PRs carry that line. The policy document alone is not an executor; no continuous agent run or installation is implied. Issue #34 tracks broader release/update and workflow integration work that remains independent of this merge authorization.
