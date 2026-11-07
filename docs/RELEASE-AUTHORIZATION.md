# James-approved MoonDog release contract

**Standing authorization:** James authorizes automatic merging of eligible same-repository pull requests under the risk-based review policy below. Every merge requires applicable tests and verification on the exact PR head and compliance with GitHub protections. The trusted main-branch policy defines eligibility.


A Stable promotion PR requires separate owner authorization before merge. Publication still runs only through the existing `.github/workflows/stable-release.yml` workflow after protected merge and successful main Publication Check; never install it or dispatch a separate manual deployment merely because a PR merged.

## Permanent engineering review policy

Routine engineering and Beta work operate under standing owner authorization. An independent human or AI reviewer is optional. Routine eligibility relies on exact-head automated evidence. Where the classification requires formal review, record the inspection against the exact PR head, including scope, findings, resolutions and verification limits. Refresh required review evidence when the head changes. No particular coding interface or model is required.

- Routine changes and data-affecting changes with accepted scoped preservation proof follow the existing automated path. Data-affecting changes without that proof require authenticated exact-head review evidence under the existing owner-attestation route. No AI reviewer, model, vendor, comment, or AI artifact is required. Historical optional review evidence remains readable for audit compatibility. Owner attestation can document AI-assisted inspection without an independent reviewer.
- Protected changes, including this policy and its workflow, require the existing separate manual or bootstrap route. For future protected PRs, record a formal exact-head owner-attested GitHub review that explicitly identifies the protected scope and evidence. An authorized maintainer verifies the review, any findings veto, the current base and mandatory checks before using the ordinary GitHub PR merge route. The guarded workflow continues refusing automatic merges for protected changes.
- Required automated tests, Publication Check, Clean Install Proof, security scans, applicable package integrity verification, and GitHub branch protections continue to apply. Resolve authenticated findings before merging.
- Stable promotion, real-store deployment, and destructive actions on actual dealership data each require separate owner authorization.

## Beta delivery (default)
- Base feature work on the active Beta line. Run Publication Check and relevant regression/security/update-package compatibility tests.
- When tests pass, merge eligible Beta work and update the Beta manifest + package + digest atomically so installed Beta clients see the new version. Never point Beta at unvalidated branch files.
- Preserve protected local Workspace, customer and store operational data. Fail closed on checksum, data-boundary, rollback or compatibility failures.
- The agent performs GitHub actions; if an account permission, required status check, or repo setting prevents completion, report the exact blocker rather than claiming publication.
- GitHub does not autonomously interpret issues as instructions or execute an agent. A live execution agent or configured bot must create/test/merge changes. Issue #34 tracks infrastructure to remove remaining manual steps.

## Stable promotion
- Stable changes may be proposed in a reviewed main PR under the standing authorization above; separate owner authorization is required before promotion.
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
After the protected policy change is merged, the trusted main-branch Guarded PR Merge workflow enforces the standing authorization for eligible open PRs. It waits for exact-head Publication Check and Clean Install Proof, applies the risk-based decision and unresolved-findings veto, and uses the ordinary GitHub merge API so active rulesets and required checks remain authoritative. If it refreshes a branch, it waits for the new head to include current main and dispatches both verification workflows for that exact branch before another merge attempt.

The PR template supplies the standalone `MoonDog-Auto-Merge: yes` line to future PRs, and existing open PRs carry that line. The policy document alone is not an executor; no continuous agent run or installation is implied. Issue #34 tracks broader release/update and workflow integration work that remains independent of this merge authorization.

## Chat-only review mode (no external coding agent)

At James's direction, trusted release workflows must **not automatically summon Codex or any other external agent**. The packaging workflow publishes a same-PR candidate without posting an agent-review request. The guarded merger evaluates exact-head checks, risk classification, scoped preservation proof, authenticated unresolved findings, and applicable review evidence. A missing or stale formal review keeps a review-required change pending. Routine and scoped-proof changes proceed when their own gates pass.

The trusted policy and workflows themselves remain protected automation files. A change to them requires a separately reviewed bootstrap PR using ordinary GitHub-authorized merge permissions; the automatic merger does not merge its own policy changes. This mode does not constitute independent human review or device validation.

## Exact-head owner-attested inspection

Where formal review is required, James permits an AI-assisted owner attestation submitted through the connected GitHub account, including for a PR authored by `JHFMoon`. The reviewer must actually inspect the current PR diff and the exact SHA, report findings, and submit a **GitHub pull-request review** using the authenticated `JHFMoon` account, with these two standalone lines:

```text
MoonDog-Owner-Review: approved
Reviewed-Commit: <full 40-character lowercase PR head SHA>
```

A PR description, issue comment, review by another account, stale commit, or summary without those lines does not pass. An authenticated owner request for changes or unresolved authenticated findings on the same commit vetoes the guarded merge. GitHub records the formal review in the PR audit trail. Each new head requires fresh inspection and CI, and a fresh formal review where the policy requires one. GitHub branch protections and required checks apply throughout.

The trusted main-branch `.github/guarded-merge-policy.json` explicitly enables the alternative. Changes to this policy, merge workflows, guard scripts, and their tests are **protected automation changes**: propose them in a separate PR, run proof checks, and use the established protected bootstrap/manual merge path. The automatic guarded merger must continue rejecting its own protected policy files.

## Provider-independent routine operation

OWNER OBJECTIVE → IMPLEMENTATION → AUTOMATED TESTS → PRIVACY VERIFICATION → AUTHORIZED MERGE → VERIFIED BETA → EVIDENCE.

Routine and accepted scoped-proof changes require no owner attestation, manual review, independent AI review, Codex execution, review comments or vendor-specific metadata. The trusted risk classifier still refuses protected controls; missing or failed mandatory checks block merge and publication. ChatGPT contributions use the same authenticated contributor and verification rules as any other contribution. Packaging/version reservation and queue advancement remain trusted workflow responsibilities. No Stable promotion or real-store installation is authorized by this flow.

An old automated finding does not require its original provider to return. An authorized exact-head owner GitHub review may resolve it only after investigating each finding, recording fixes and verification evidence, and adding `Resolved-Review-Comments: <numeric-comment-id>,<numeric-comment-id>` as one standalone line alongside the existing owner-review and exact-commit lines. The review must be newer than every referenced finding and cover every authenticated blocking comment for that head. Missing IDs, stale reviews, missing timestamps, malformed evidence, or a later finding remain blocked. A bare approval never clears findings. This resolution does not override privacy scans, functional checks, protected classification or GitHub branch protection.

Changes to these controls require separate protected bootstrap review. They must never approve or merge themselves. Read this section as proposed behavior until this protected change is reviewed and merged to main; the live main revision remains authoritative.
