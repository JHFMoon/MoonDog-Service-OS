# MoonDog: Data-Preservation-First Beta Release Policy

**Status: proposal; not active until protected main integration and verified Beta publication.**
Owner direction: November 3, 2026.

## Owner's release priority

The owner accepts repairable Beta usability or functionality regressions to reduce continuous supervision. **Previously recorded operational data must not be lost, overwritten, silently reclassified, altered without provenance, or made irrecoverable.** This specifically includes RO notes, entered metrics, manual adjustments, advisor history, trend comparison baselines, original imported source values, record identities, and saved status/owner/action changes. An automated test pass reduces risk; it does not guarantee no possible loss.

## Protections retained for every change

- Prevent customer, employee, dealer and other private data, raw operational reports, VINs, secrets and Workspace contents from entering public GitHub. Enforce known public-boundary, history, public-surface and release-package scans. **These block/detect; they do not anonymize.**
- Preserve durable readback, retry/locks, backup/rollback, file connection permissions, historical source lineage and unknown-versus-zero semantics. Check before/after invariants for any data-path change, including interrupted and concurrent operations.
- Require exact-current-head Publication Check, Clean Install Proof, trusted Beta artifact hashes and the existing GitHub protected-branch merge path. Maintain existing trusted packaging and public-history/public-surface audits.
- **Stable 0.10.17 is unchanged**; Stable promotion requires separate owner authorization.
- Stop on unresolved privacy, credential, data-loss, provenance, authorization, packaging or protected-security findings. Never force a failing merge.

## Automatic Beta flow and classification

**Routine:** narrowly classified changes that cannot affect persistent data, security or the release chain may merge after the existing CI/security/clean-install verification, with no ritual owner self-attestation.

**Data-affecting:** edits that could touch imports, RO records, notes, histories, metrics, overrides, local storage, file I/O, backups, reconciliation, migration, recovery or permissions must retain the full baseline data-integrity suite and supply a focused changed synthetic test with relevant assertions. The exact-head CI must pass. If scoped proof is absent, keep the existing exact-head review requirement; a passing test is risk reduction, not a guarantee that no possible data loss can occur. No routine owner technical sign-off is presumed.

**Protected:** changes to workflows, trust/permission boundaries, security scanners, merge authorization, policy classifiers, packaging, or Stable require a separately reviewed protected bootstrap. The system must not self-authorize changes to its own safeguards.

Unknown classification defaults to protected or data-affecting, never routine. A previously reported authenticated review finding continues to veto automatic publication until resolved by fresh validated evidence. A review authored by AI through the owner's GitHub login is **not independent human review**.

## Privacy before public upload (remaining limitation)

A post-push CI scan is too late to prevent immediate exposure on a public branch. Require private candidate staging and scan before any public push from all supported writers. Git hooks alone do **not** protect GitHub-API writers and must not be advertised as a complete guarantee. Until such a protected writer is actually wired and verified, maintain current public-boundary CI and clearly report the remaining pre-push limitation.

## Operation and reporting

One request => implement => pre-push privacy gate where available => one scoped PR => exact-head verified CI plus no-loss checks => protected Beta merge => postmerge safety scan => short completion report.

No repeated discretionary owner signoffs for routine Beta work. Notify the owner only for a genuinely unresolved data/privacy/security risk, protected-control change, or Stable release decision. Do not claim chat sessions can keep working after the session ends; an independently configured executor is required for unattended coding.

## Activation requirements

1. Implement and test a deterministic risk classifier and guarded merge decision, with deliberate protected-code review; do not self-approve this policy bootstrap.
2. Demonstrate no-loss tests for changed data paths and negative cases where missing proof fails closed.
3. Retain all current privacy, package, GitHub ruleset and Stable controls.
4. Verify actual merge, publication and postmerge outcomes before describing this as live.
