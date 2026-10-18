# MoonDog Engineering Continuation Ledger

This is a non-sensitive execution checkpoint, not proof of a continuously running coding agent. Always reconcile it against the latest GitHub commits, pull requests, manifests, workflow runs, and protected release policy before acting.

## Standing guardrails
- Approved direction: scalable, offline-capable Fixed Operations platform; progressive modernization; action-first command center; constrained autonomous internal operations.
- Routine verified changes may enter Beta only through approved gates. Stable promotion always requires separate explicit authorization.
- Customer, VIN, employee, repair-order, source-report, Files To Learn, backup, and Workspace data never belong in this public repository.
- Work in small, independently testable increments. Do not skip a failing check or claim an unverified publication.
- An agent needs a separately configured, authorized runner to resume execution after a session ends. No continuously running code agent has been verified here.

## Latest verified GitHub checkpoint (October 18, 2026)

**Read this section first, but treat it as a dated snapshot.** Re-fetch GitHub `main`, open issues/PRs, required checks and the active manifest on every continuation. The older October 17 record below is retained solely for historical evidence, **not** for current branch, release or PR decisions.

- Last checked `main`: `d0459abf1fd9ee65533287dab7b4ba458ffc5dbc`.
- Manifest Beta: `0.10.18-beta.98`, SHA-256 `e7c4af07bff3d83104cb58e2735c42fe7476be47e547626b6cdb3dfa1f4fbea1`. **Published is not installed.**
- Protected Stable: `0.10.17`; no Stable promotion authorized.
- Open GitHub issues: **#164, #58, #59, #60, #61, #212** (six). #212 is deliberately deferred.
- Merged and verified: PR #219 bounded update-recovery inventory scan; PR #221 trusted Beta 98 publication; PR #222 hardware-validation procedure `docs/EDGE-ONEDRIVE-FIELD-VALIDATION.md`.
- **Draft PR #220** on `feature/59-history-workspace-isolation-20261018` (last verified head `56e0d2224aa6c49a1f487897996b7d2e61216239`) preserves the per-Workspace history-cache isolation fix. Existing CI passed, but the required new overlapping-workspace regression was denied by a GitHub tool safety control. Do **not** merge or attempt the denied operation via another route. Record the limitation and work on independent requirements.
- **PR #223** on `feature/164-backup-list-io-fail-closed-20261018` addresses transient recovery-journal read errors so OneDrive locks cannot silently enable a second update. A substantive review found the update-settings caller would clear the recovery flag on scan failure; this was corrected with fail-closed install/UI gates and more synthetic tests. **Exact-head CI and review outcome must be rechecked before any merge.**
- **PR #224** on `tests/58-164-navigation-endurance-20261018` adds 240-cycle synthetic Meeting/Performance/Open RO navigation-regression coverage. Its last observed exact-head Publication Check and Clean Install Proof passed, but it was still **unmerged** at this checkpoint.
- Real Windows Edge/OneDrive and installed-app validation are **not performed**. Use the privacy-safe guide from PR #222, and do not upload raw traces, private Workspace files or machine-local paths.

**Next action:** Verify PR #223's latest required checks and resolve substantive review feedback; once independently green, deliver through protected merge and confirm post-merge Beta. Then reconcile the latest `main` into #224, rerun exact-head checks and deliver the validated synthetic endurance increment. Keep #220 draft until its regression blocker is resolved through an explicitly authorized path. Continue independent #58/#59/#60/#61 requirements without duplicating existing work.

## Verified baseline at checkpoint (October 17, 2026)
- Public `main`, local `main`, and the recovery work branch base: `50ebbdfdfe5386fa77a90883eeac16317ed36f68`.
- Public Stable manifest: `0.10.17`, package SHA-256 `10d9801feb53063c5b88ea69e3250622b498bfbef04aef58cd8f1ffe08bf6141`.
- Public Beta manifest: `0.10.18-beta.85`, package SHA-256 `cce5cf59a07b76ec69222b69c095aa269efa354dc547dc1fbae177953cf748a9`; the public manifest was independently read from `main`.
- The previously reported local Beta 86 package and SHA-256 `4f9b3958374ac835dcb3cd3e7fccacd38479870f1219e42903e466d9eb489842` were not present in the checkout, Git refs, or session artifacts. A replacement local candidate was built from the current recovery source as `0.10.18-beta.86`, SHA-256 `1a149c10b6c7b4ae340846e80d2618ec89cb90ff7f20bc287f43614340993515`. It is verified but unpublished; do not treat the old reported digest as evidence.
- Exact-head GitHub CI for PR #190 exposed two public-history tests that depended on bytecode objects present only in local agent-checkpoint refs. Follow-up commit `c41dab1b42ba0bbcd7c03f6df6ec09e014ef779d` removes those unnecessary synthetic-test bytecode allowlists and makes the regression test self-contained. The follow-up passes local Python and JavaScript suites but has not been pushed; rerun exact-head checks after it is pushed. Local all-ref audits may still flag local-only checkpoint objects, which are not part of GitHub's public refs.
- PRs #184 and #185 are represented in current `main`; #185 is closed. PR #186 and #187 are open with successful Publication Check and Clean Install Proof runs on their observed heads. PR #189 is open and draft; its exact-head checks passed and its synthetic selection/isolation tests passed, but it has no review and remains unapproved.
- PR #183 is open and draft, based on an older `main` commit, with no review. Its branch contains a strict positive/negative/revoked/quoted-token parser and regression tests, and its workflow checks out the trusted parser from `main` and rechecks live PR consent before merging. This local source change applies that parser to the active guarded-merge checks and the other consent-validation helpers; it still requires a current base, independent security review, and required exact-head checks.
- PR #182 remains draft and behind current `main`; PR #144 is behind its older base. Neither should be treated as ready to merge.
- This checkout contains uncommitted recovery work. Local tests do not constitute GitHub CI on a new commit.
- Issue #161's current runtime already keys Meeting/Performance reuse on the business date and the 18:00 working-day boundary. Local regression coverage now verifies midnight refresh, one-time close/open cutoff refresh, unchanged-state reuse, and stale-navigation cancellation; the issue remains open remotely until reviewed/published.

## Automation status
On the observed public `main`, Publication Check is scheduled Monday at 11:23 UTC and the public-history audit runs daily at 09:23 UTC. Clean Install Proof currently runs on pull requests and manual dispatch, not on a schedule. Therefore the installed Monday workflow does not yet guarantee a Chromium clean-install proof before the 10 AM Pacific review.

This local change moves the weekly full verification to Clean Install Proof at 13:23 UTC Monday and removes the duplicate Publication Check schedule. It is not installed on GitHub until reviewed and merged. The job runs regression, publication, module-sync, deterministic ZIP, Chromium clean-install, TV/navigation, and Beta install/launch checks; GitHub schedule delivery can be delayed.

No unattended code-editing agent or authorized persistent runner was verified. GitHub Actions provides scheduled checks and guarded packaging, not autonomous code editing. A separately configured and authorized runner is still required for changes to be researched, implemented, reviewed, and submitted after this session ends.

## Autonomous execution status
The repository contains GitHub Actions for verification, packaging and publication; this alone is **not** an autonomous coding agent. Before enabling recurring engineering work, verify a real authorized runner, supported identity and permission boundaries, budgets, safe stop/rollback, and an on-call owner for security findings. Do not create unbounded continuous work or claim background progress without those capabilities.
