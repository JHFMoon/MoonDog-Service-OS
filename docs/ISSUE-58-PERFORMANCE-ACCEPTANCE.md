# Issue 58 — verified software performance acceptance evidence

**Evidence reconciliation, 2026-11-03 (UTC).** This document records **automated synthetic** verification of the shipped MoonDog Service Operations Dashboard. It does **not** claim performance measured on James's physical Windows/Edge installation, actual OneDrive/network latency, native picker, or live customer data. Per issue 58's 2026-10-19 owner-approved closure policy, such field results are optional; the source, CI, preservation, and protected Beta gates are not.

## Trusted release state and safeguards

- Protected main after [PR 731](https://github.com/JHFMoon/MoonDog-Service-OS/pull/731): `f71c5cc405b9ef45240801e46fd962af48c511b7`; Beta `0.10.18-beta.323` with manifest SHA-256 `4c4ea850a5d5f895c5deed5c9d17ec9e2f4c1e15ac2962d4862228e937f7ac7b`. Stable remains **0.10.17**, unchanged.
- Exact packaged-head Publication Check [41732445881](https://github.com/JHFMoon/MoonDog-Service-OS/actions/runs/41732445881) and Clean Install Proof [41732445951](https://github.com/JHFMoon/MoonDog-Service-OS/actions/runs/41732445951) **SUCCESS**; protected PR 731 merged. Main Publication [41733770651](https://github.com/JHFMoon/MoonDog-Service-OS/actions/runs/41733770651) and public reachable-history/public-surface scan [41733770674](https://github.com/JHFMoon/MoonDog-Service-OS/actions/runs/41733770674) **SUCCESS**.
- All six criterion-specific cited runtime PRs (#627, #726, #590, #722, #725 and #728) were independently queried through GitHub: **merged into main**, exact-head GitHub Actions **Publication Check** and **prove-clean-install** **SUCCESS** from app 15368, and **zero unresolved review threads** at audit time. Each changed the shipped `assets/` runtime and directly changed/adds the named regression test. These source merges predate PR 731's Beta source base.
- No protected workflow change, telemetry upload, external dependency, physical device manipulation or Workspace modification is introduced by this evidence-only reconciliation.

## Criterion-to-source-and-test proof

| Criterion | Shipped verified contribution and additional coverage | Registered merge + regression |
|---|---|---|
| 58-01 | Authenticated saved-folder preflight reuses the validated settings snapshot (#627); first usable Home is measured with complete hydrated data and dashboard DOM, not a shell-only success. Empty, 2,100 RO, delayed-read, permission and recovery scenarios use repeated synthetic fixtures. | [PR 627](https://github.com/JHFMoon/MoonDog-Service-OS/pull/627), `tests/connected-home-readiness-baseline.test.cjs`; supporting `tests/workspace-connect-performance.test.cjs`, `scripts/smoke_overdrive.mjs` |
| 58-02 | Reconnect does not reread an already verified absent bootstrap adapter (#726), and fails closed on invalid/racing adapter evidence. Background maintenance waits until first usable Home, then runs ordered/isolated with cancellation on root changes; routine reconnect does not reparse Files To Learn, while explicit update/manual retry remains. | [PR 726](https://github.com/JHFMoon/MoonDog-Service-OS/pull/726), `tests/workspace-connection-data-preservation.test.cjs`; supporting `tests/workspace-connect-performance.test.cjs`, `tests/workspace-connection-latency.test.cjs` |
| 58-03 | Hidden Overview, Open RO and report panels do not rebuild eagerly. Source/data revision, date cutoff, navigation rapid-exit, and back-navigation invalidate/redraw only the correct view. | [PR 590](https://github.com/JHFMoon/MoonDog-Service-OS/pull/590), `tests/advisor-section-visibility.test.cjs`; supporting `tests/navigation-render-reuse.test.cjs` |
| 58-04 | Assign Next active/opened-today counts use one roster pass without changing advisor ordering or source authority. Synthetic 0, 1, 6, 2,100 and 15,000 RO cases include 24 paired before/after selector samples. Packaged browser tests independently exercise 2,100 RO search, editor, note disclosure, durable save and nine complete retry/reconnect tasks; business-date, refresh and large-table regression coverage remains. | [PR 722](https://github.com/JHFMoon/MoonDog-Service-OS/pull/722), `tests/assign-next-linear-counts-performance.test.cjs`; supporting `tests/open-ro-search-edit-roundtrip-performance.test.cjs`, `scripts/smoke_overdrive.mjs` |
| 58-05 | Collapsed Paste & Learn detail rows are built only upon explicit expansion, while remaining read-only until confirmed import. Duplicate reimport skips unnecessary merge-map work only **after** durable comparison and existing permission/serialization checks. Packaged Chromium tests repeat 300-RO import plus 8 idempotent imports and verify source readback, no duplicate writes, Meeting full-screen 7-slide rotation, navigation and keyboard-compatible presentation. | [PR 725](https://github.com/JHFMoon/MoonDog-Service-OS/pull/725), `tests/paste-preview-import-data-preservation.test.cjs`; supporting [PR 723](https://github.com/JHFMoon/MoonDog-Service-OS/pull/723), `tests/paste-idempotent-commit-performance.test.cjs`, `scripts/smoke_overdrive.mjs` |
| 58-06 | Supervisor Workbook lock compares durable Open, Closed, source lineage/digests, and review queue state to reject another tab's change **before writes**, including malformed types; source and manual edits are retained. Production-source tests cover permission denial/retry, business-date rollover, refresh during search, unsaved editor navigation and invalid RO roster reconnect. | [PR 728](https://github.com/JHFMoon/MoonDog-Service-OS/pull/728), `tests/workbook-source-lineage-preservation.test.cjs`; supporting [PRs 727](https://github.com/JHFMoon/MoonDog-Service-OS/pull/727), [729](https://github.com/JHFMoon/MoonDog-Service-OS/pull/729), [731](https://github.com/JHFMoon/MoonDog-Service-OS/pull/731), `tests/open-ro-search-edit-roundtrip-performance.test.cjs` |

## Verified representative measurements (synthetic, not installed-machine SLAs)

These are repeated **measurements**, not invented hard budgets. Values vary by CI host; complete scoped evidence is in [Clean Install Proof 41732445951](https://github.com/JHFMoon/MoonDog-Service-OS/actions/runs/41732445951).

| Scenario | n / fixture | p50 | p95 |
|---|---|---:|---:|
| New app page, launcher shell + verified connected Home, empty ROs | 9 page starts | 447.2 ms | 468.8 ms |
| New app page, launcher shell + verified connected Home, 2,100 ROs | 9 page starts | 640.4 ms | 649.8 ms |
| New app page, same 2,100 ROs with 25 ms synthetic JSON read delay | 9 page starts | 1711.0 ms | 1762.8 ms |
| Already open app, verified connection-to-first Home frame, 2,100 ROs | 9 | 218.0 ms | 228.7 ms |
| First Open RO tab activation, 2,100 ROs | 9 | 14.9 ms | 22.3 ms |
| First Assign Next tab activation, 2,100 ROs | 9 | 2.7 ms | 5.1 ms |
| Connected Open RO search to rendered match, 2,100 ROs | 9 | 61.5 ms | 68.3 ms |
| Connected Open RO editor to frame, 2,100 ROs | 9 | 13.5 ms | 23.5 ms |
| Connected Open RO save through verified durable readback, 2,100 ROs | 9 | 888.5 ms | 897.9 ms |
| Paste & Learn explicit first import + eight idempotent reimports, 300 report ROs | 9 | 1820.6 ms | 3062.9 ms |

**Scope precision:** The nine new-page runs share an already launched Chromium process and do **not** model a cold operating-system/browser process. The connection fixture supplies an in-memory File System Access-compatible folder. The tab metrics time click-to-first animation frame, then separately verify DOM usability after deferred rendering; they do **not** include slow local file access. The paste figures mix one first import and eight unchanged reimports, so they are **not** a paired causal before/after browser speedup. No live source data was used.

### Paired optimization evidence (separate from browser timings)

- PR 726 synthetic source-adapter absence: a previously duplicate protected bootstrap-adapter read is removed (2 reads → 1) without removing preflight validation; paired production-function tests measure p50/p95 with simulated 25 ms I/O. Do not extrapolate to physical OneDrive.
- PR 725, 24 paired synthetic production-renderer fake-DOM samples: collapsed 300-row preview initially created **1,208 nodes → 7** (about 99.4% fewer); p50/p95 **1.206/1.845 ms → 0.008/0.031 ms** in that synthetic harness. This is not the end-to-end preview time.
- PR 723, 24 paired VM calculations of unchanged reimport: 2,100 Open ROs p50/p95 **7.574/9.071 → 5.509/6.849 ms** (about 27% median reduction), 15,000 ROs **14.146/22.985 → 7.717/13.710 ms** (about 45% median reduction). These exclude durability I/O.
- PR 722, 24 paired production-selector measurements compare the prior repeated per-advisor filtering to a single roster pass at 2,100/15,000 records; actual source results and preserved advisor ordering are asserted by the shipped test. Do not fabricate a fixed machine-independent percent.

### Remaining known limitations — measured, not hidden

- The repeated import run still observed **39** main-thread long tasks (largest **1,236 ms**, within its commit phase; 27 in preview, 12 in commit). It verified durable readback and preserved import timestamps; no customer data was used. This is a useful **future optimization lead**, not a performance budget violation the issue ever specified. It should not be represented as jank-free or a matched full-browser improvement.
- Real Windows/Edge/OneDrive sync latency, interruptions and installation performance remain unknown. The issue's explicit owner closure policy makes physical measurements optional; no synthetic result substitutes for them.
- Broader source-authority and recovery acceptance remains under separate issue 59. This evidence does not promote Stable or declare unrelated architecture work complete.

## Acceptance and release decision

The six issue-specific **software** outcomes are evidenced by shipped production, synthetic regression/benchmarks, and protected checked Beta. Record the six exact criterion IDs in `docs/ISSUE-CLOSEOUT-EVIDENCE.json`, update the authoritative roadmap matrix and let the repository's **Verified Issue Closure** evaluator independently recheck the exact-live checks, PR ancestry, test provenance, and current main. Do not bypass or manually overwrite a failed verification.