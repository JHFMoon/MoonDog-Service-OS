# MoonDog Engineering Continuation Ledger

This is a non-sensitive execution checkpoint, not proof of a continuously running coding agent. Always reconcile it against the latest GitHub commits, pull requests, manifests, workflow runs, and protected release policy before acting.

## Standing guardrails
- Approved direction: scalable, offline-capable Fixed Operations platform; progressive modernization; action-first command center; constrained autonomous internal operations.
- Routine verified changes may enter Beta only through approved gates. Stable promotion always requires separate explicit authorization.
- Customer, VIN, employee, repair-order, source-report, Files To Learn, backup, and Workspace data never belong in this public repository.
- Work in small, independently testable increments. Do not skip a failing check or claim an unverified publication.
- An agent needs a separately configured, authorized runner to resume execution after a session ends. No continuously running code agent has been verified here.

## Latest verified GitHub checkpoint (October 18, 2026)

**Read this first as a dated snapshot.** Re-fetch public `main`, open issues/PRs, CI and the live manifest whenever resuming. The older October 17 record below is preserved only as historical evidence; its Beta, PR and local-branch statuses are not current.

- Last verified `main`: `9d8d3ce7cf8ed45297811a85b6e3644995be8b44`.
- Manifest Beta: `0.10.18-beta.99`, SHA-256 `34e3b982012688c6b0821e47ded75ecc6f73429387712bb52fc783ae80611277`. Published **does not mean installed**.
- Protected Stable: `0.10.17`; no promotion authorized.
- Six open issues: **#164, #58, #59, #60, #61, #212**. #212 remains explicitly deferred.
- Merged/verified increments: PR #219 bounded backup scan, PR #221 Beta 98, PR #222 Windows/Edge field-validation guide, **PR #223** fail-closed OneDrive recovery journal/installer UI preflight (squash `70db8c773f0b381286597da97fcf100c81aacfcb`), and **PR #226** trusted Beta 99 publication (`f6c5a46c64e890d3d146b11fcd4ef1ca8d30fc80`). PR #223's last exact-head Publication Check and Clean Install Proof passed, and the substantive review thread was resolved.
- **Draft PR #220**, `feature/59-history-workspace-isolation-20261018`, head `56e0d2224aa6c49a1f487897996b7d2e61216239`: production cache-generation safeguard is preserved but the needed *new* overlapping-workspace regression write was blocked by tool safety. Existing CI green is not sufficient for merge. Do not bypass denial or merge this draft.
- **PR #224 merged** as `9d8d3ce7cf8ed45297811a85b6e3644995be8b44` after exact-head Publication Check, Clean Install Proof and P2 review correction. Its 240-cycle test flushes each completed Home, Meeting, Performance and Open RO visit, checks cache reuse, and verifies source/day refresh. This is synthetic coverage, not a real hardware speed benchmark.
- **PR #225**, `docs/61-refresh-continuation-ledger-20261018`: this date-stamped continuation update. This documentation-only PR must pass current exact-head checks and protected merge.
- **Draft PR #227**, `fix/61-reviewed-beta-release-notes-20261018`: removes generic post-merge Beta note override so the existing builder can summarize the reviewed commit title. Protected workflow/test modification **not yet reviewed or merged**; do not auto-merge before validation.
- Real Windows Edge/OneDrive, installed dashboard, and hardware startup/memory metrics have **not** been verified. Field protocol: `docs/EDGE-ONEDRIVE-FIELD-VALIDATION.md`. Do not upload raw traces or protected operational files.

**Next executable sequence:** Merge this documentation PR #225 through fresh exact-head CI after bringing forward current `main`. Review the protected workflow/test diff in draft PR #227 independently before any merge, keep #220 draft under its denied regression-writing constraint, then continue remaining #164/#58/#59/#60/#61 work with real Windows Edge evidence only where available.

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
