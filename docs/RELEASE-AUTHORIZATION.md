# James-approved MoonDog release contract

**Standing authorization:** James authorizes automatic merging of eligible same-repository pull requests under the risk-based review policy below. Every merge requires applicable tests and verification on the exact PR head and compliance with GitHub protections. The trusted main-branch policy defines eligibility.


A Stable promotion PR requires separate owner authorization before merge. Publication still runs only through the existing `.github/workflows/stable-release.yml` workflow after protected merge and successful main Publication Check; never install it or dispatch a separate manual deployment merely because a PR merged.

## Verified changes without mandatory GitHub reviews

For ordinary engineering, Beta, distribution, and operational-code changes, no human or AI review is a prerequisite. The trusted merge guard requires a complete same-repository PR scope, accepted author, current-main ancestry, no draft, exact-head successful Publication Check and Clean Install Proof, privacy/security scans, package parity, authenticated unresolved-findings veto, and GitHub branch protection. These checks are not optional. Changes to security enforcement, protected workflows, the classifier itself, Stable promotion, and destructive or real-store operations retain their existing separate authorization boundaries. An optional review can identify a finding but cannot replace failed checks.

Ordinary changes already use this review-free policy. The in-chat protected-manual-merge procedure below becomes operative only after its separately authorized protected bootstrap PR is legitimately merged. It does not authorize its own bootstrap merge.

## Permanent engineering review policy

Routine engineering and Beta work operate under standing owner authorization. An independent human or AI reviewer is optional. Routine eligibility relies on exact-head automated evidence. Where the classification requires formal review, record the inspection against the exact PR head, including scope, findings, resolutions and verification limits. Refresh required review evidence when the head changes. No particular coding interface or model is required.

- Routine changes and data-affecting changes with accepted scoped preservation proof follow the existing automated path. Ordinary data-affecting changes use mandatory exact-head CI and authenticated findings veto without requiring review; security/release enforcement changes remain separately protected. No AI reviewer, model, vendor, comment, or AI artifact is required. Historical optional review evidence remains readable for audit compatibility. Owner attestation can document AI-assisted inspection without an independent reviewer.
- Protected changes, including security enforcement, workflows and this policy, remain on the separate manually authorized/bootstrapped route. After the one-time bootstrap of this procedure, James can authorize a **specific protected scope in the active ChatGPT conversation**; no separate GitHub owner-review submission is required for that scope. The connected session must inspect the exact-head changes and unresolved findings, verify the current base and mandatory checks, record the owner authorization and exact-head evidence in the PR audit trail, and use the ordinary GitHub PR merge route. An instruction to execute a specific change is not authorization to remove unrelated safeguards. If user authorization is absent, ambiguous, revoked or out of scope, stop. The guarded workflow still refuses automatic merges for protected changes, regardless of tests or GitHub account permissions.
- Required automated tests, Publication Check, Clean Install Proof, security scans, applicable package integrity verification, and GitHub branch protections continue to apply. Resolve authenticated findings before merging.
- Stable promotion, real-store deployment, and destructive actions on actual dealership data each require separate owner authorization.


## Session-to-publication acceptance (standing execution intent)

A request in ChatGPT or Work authorizes ordinary non-destructive engineering in the stated scope; it does **not** authorize a Stable promotion or actual store data changes. Within a single active session the agent should create a reviewable PR, run focused and mandatory exact-head checks, resolve defects, obtain any **separate scope-specific protected authorization in the conversation**, merge through normal GitHub protections, confirm post-merge main and release/package evidence, and verify the published website or Beta state. Preserve an honest checkpoint if checks remain in progress; never claim background execution, automatic installation, or publication from a merge alone.

For protected changes, the owner can include the bounded protected scope in the initial request, which removes the need to repeat a GitHub review for that same scope. **Protected manual merge remains an explicit action by an authorized account after inspection and successful mandatory checks; it is not automatically performed by a workflow.** If a PR gains a different protected scope, ask for authorization in chat instead of inventing it. Stop on failed privacy/integrity checks, untrusted origin, denied permissions, stale heads or unresolved findings. Preserve the existing Stable promotion and real-store operations approval boundaries.

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

## Single-session authorized execution (no GitHub UI requirement)

At James's direction, trusted release workflows must **not automatically summon Codex or any other external agent**. The packaging workflow publishes a same-PR candidate without posting an agent-review request. The guarded merger evaluates exact-head checks, risk classification, scoped preservation proof and authenticated unresolved findings. Eligible routine changes need no reviewer. Protected controls remain manual, but a specific in-session owner authorization may replace the repetitive **GitHub owner-review ritual** only after the separately reviewed bootstrap of this policy. No ChatGPT session can waive failed checks or GitHub permissions.

The trusted policy and workflows themselves remain protected automation files. Their changes still require a separately authorized manual/bootstrap merge using ordinary GitHub-authorized permissions; the automatic merger cannot approve its own controls. The assistant must state when inspection is AI-assisted and non-independent. A recorded instruction from the owner is authorization, not independent code review or device validation.

## In-chat authorization and optional exact-head GitHub review

For protected PRs after this policy's authorized bootstrap, James may approve the **specific protected scope in the active conversation** rather than clicking GitHub review buttons. The connected session must still examine the exact-head PR diff, required checks and authenticated findings; leave a truthful PR audit comment recording the scope authorization and inspected SHA, clearly noting that AI inspection is non-independent; and use the protected ordinary manual merge route only if every gate passes. This may be completed in the same session from inception to publication. Do not treat broad standing authorization, agent-authored text, or a guessed approval as James's authorization for a different protected scope.

A formal exact-head owner-attested GitHub PR review is **optional after this bootstrap** and remains available for transparency, reviewer findings, and legacy evidence. If one is submitted, the reviewer must actually inspect the PR and use the authenticated `JHFMoon` account with these two standalone lines:

```text
MoonDog-Owner-Review: approved
Reviewed-Commit: <full 40-character lowercase PR head SHA>
```

A PR description, issue comment, review by another account, stale commit, or summary without those lines must never be misrepresented as a formal owner-attested GitHub review. For protected in-chat authorization, an agent-written PR audit note **cannot itself supply the owner's missing authorization**; the owner must have authorized that exact kind of change in the active conversation. An authenticated owner request for changes or unresolved authenticated findings vetoes the merge. Each new PR head requires fresh inspection and CI. Required status checks, branch protection, integrity checks and permissions apply throughout.

The trusted main-branch `.github/guarded-merge-policy.json` explicitly enables the alternative. Changes to this policy, merge workflows, guard scripts, and their tests are **protected automation changes**: propose them in a separate PR, run proof checks, and use the established protected bootstrap/manual merge path. The automatic guarded merger must continue rejecting its own protected policy files.

## Provider-independent routine operation

OWNER OBJECTIVE → IMPLEMENTATION → AUTOMATED TESTS → PRIVACY VERIFICATION → AUTHORIZED MERGE → VERIFIED BETA → EVIDENCE.

Routine and accepted scoped-proof changes require no owner attestation, manual review, independent AI review, Codex execution, review comments or vendor-specific metadata. The trusted risk classifier still refuses protected controls; missing or failed mandatory checks block merge and publication. ChatGPT contributions use the same authenticated contributor and verification rules as any other contribution. Packaging/version reservation and queue advancement remain trusted workflow responsibilities. No Stable promotion or real-store installation is authorized by this flow.

An old automated finding does not require its original provider to return. An authorized exact-head owner GitHub review may resolve it only after investigating each finding, recording fixes and verification evidence, and adding `Resolved-Review-Comments: <numeric-comment-id>,<numeric-comment-id>` as one standalone line alongside the existing owner-review and exact-commit lines. The review must be newer than every referenced finding and cover every authenticated blocking comment for that head. Missing IDs, stale reviews, missing timestamps, malformed evidence, or a later finding remain blocked. A bare approval never clears findings. This resolution does not override privacy scans, functional checks, protected classification or GitHub branch protection.

**Bootstrap boundary:** This change to the release contract itself must still follow the prior policy's separate exact-head owner-attested review and authorized manual merge. It cannot approve or merge itself. Once legitimately merged, the in-chat protected-manual-merge procedure applies prospectively. Until then the current main revision remains authoritative.
