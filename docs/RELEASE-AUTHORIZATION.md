# James-approved MoonDog release contract

**Standing authorization:** James requests changes; the agent implements, audits, tests, corrects and publishes **Beta** without requiring routine manual GitHub interaction. James alone chooses when to promote a Beta to **Stable** by explicitly requesting a promotion in conversation. A normal feature request is **not** Stable authorization.

## Beta delivery (default)
- Base feature work on the active Beta line. Run Publication Check and relevant regression/security/update-package compatibility tests.
- When tests pass, merge eligible Beta work and update the Beta manifest + package + digest atomically so installed Beta clients see the new version. Never point Beta at unvalidated branch files.
- Preserve protected local Workspace, customer and store operational data. Fail closed on checksum, data-boundary, rollback or compatibility failures.
- The agent performs GitHub actions; if an account permission, required status check, or repo setting prevents completion, report the exact blocker rather than claiming publication.
- GitHub does not autonomously interpret issues as instructions or execute an agent. A live execution agent or configured bot must create/test/merge changes. Issue #34 tracks infrastructure to remove remaining manual steps.

## Stable promotion (requires explicit James request)
- Do NOT edit `updates/manifest.json` `stable.version`, corresponding Stable package URL/digest or Stable release tag without James saying to promote/push to Stable.
- On explicit approval, agent selects the tested Beta package and runs the final full audit: updater compatibility, migration plan, Workspace preservation, backup/rollback, version/digest integrity and formal release package validation.
- Commit the new Stable version in a reviewed main PR **only after** the approval and checks. Document James's approval and the precise version in PR description; don't copy confidential conversations into the public repository.
- The GitHub Stable workflow automatically reacts to successful validated main pushes *only if* `stable.version` changed on that commit; ordinary Beta changes do not re-release Stable. It does not decide to promote Beta.
- A manual emergency Stable workflow dispatch must provide an approval reference. The input is an operator assertion, not identity proof; grant dispatch permissions only to trusted maintainers.
- Publish immutable versioned release asset and clean-install package, verify SHA-256 and update discovery; if any gate fails, keep prior Stable.

## Installation
- Application may automatically **check** for verified new Stable releases and show a visible non-blocking notification with release notes.
- Installation into a local browser-authorized folder requires James's confirmation. No silent overwrite of locally held operational files.
- Deliver a concise completion record: change, Beta/Stable version, validation result, deployment URL, and any blockers.

## Remaining engineering tasks
See #34 for unattended PR merges, automatic Beta package generation, verified notification on dashboard open and end-to-end integration tests. These are not guaranteed by this policy document alone.
