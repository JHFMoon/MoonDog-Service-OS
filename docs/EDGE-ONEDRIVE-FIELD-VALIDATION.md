# Windows Edge / OneDrive field-validation protocol

**Scope:** Open issues #164, #58, #59 and #61. This protocol defines what must be measured on an actual Windows Microsoft Edge installation. GitHub Actions Chromium/Linux green results are useful synthetic regression evidence, **not proof** that Windows Edge or OneDrive works on an installed machine.

## Non-negotiable evidence boundary

- Use a separate, disposable **synthetic** MoonDog installation and synthetic Workspace. Never experiment with live operational files, real customer/employee/RO/VIN data, or the owner's production backup directories.
- Do not upload Edge traces, screenshots, original report files, Workspace, OneDrive content or machine-specific paths to the public GitHub repository. A browser performance trace may retain resource paths, text, and URLs.
- Public GitHub comments may contain only redacted aggregate timings, scenario IDs, outcomes, software versions, and reproducible synthetic-fixture descriptions. Preserve raw traces only in an access-controlled private location outside the repo.
- Record the exact tested Beta version and SHA-256 from `updates/manifest.json`; verify the installed application's own version separately. Beta publication is not installation proof.
- Do not claim Stable approval or automatic installation based on this procedure.

## Required measurement record

For each scenario capture: scenario ID; Windows/Edge version and architecture; tested MoonDog version; whether the folder is local or OneDrive-synced; cold versus warm start; dataset size; number of runs; p50/p95 elapsed milliseconds; peak browser CPU and memory; main-thread long tasks and interaction delay; outcome; whether a permission prompt appeared; and any locally retained diagnostic reference (never its raw contents in GitHub).

**Timing definition:** start at the user's launcher action and end at the first verified, usable Home state (not merely first rendered HTML). Measure navigation separately from first usable Home. Keep baseline and candidate tests on the same machine and dataset. Use at least five repetitions where feasible; do not invent latency budgets.

## Synthetic field matrix

| ID | Situation | Required outcome |
|---|---|---|
| EDGE-01 | Cold and warm `file://` launches with empty synthetic Workspace | Usable Home; safe source confidence; no unexplained spinner or unhandled rejection |
| EDGE-02 | Synthetic 2,100+ event records, realistic mixed reports, repeated Search and tab changes | p50/p95 and peak memory recorded; current data remains correct |
| EDGE-03 | 70+ synthetic update-backup folders, including prepared, applying, completed and malformed journals | Only valid incomplete backups are offered; bounded inventory; no deletion or Workspace mutation |
| EDGE-04 | Permission denied, folder unavailable, and later manually regranted | Explicit read-only or unavailable state; recovery after approved reconnection; no unauthorized writes |
| EDGE-05 | OneDrive-synced **synthetic** directory with delayed/hydrating files, offline/online transition and temporary file-use errors | No partial operational save claimed; no runaway retry; eventual safe reconnect |
| EDGE-06 | Two independent Edge tabs pointing to the same disposable Workspace and attempted conflicting synthetic edits | No silent conflicting durable writes; preserved originals and observable resolution path |
| EDGE-07 | Repeated 200+ tab transitions, simulated report imports, minimize/resume and overnight-like idle cycle | Memory, long-task and handler growth evaluated; no duplicated timers, stale data or lockup |
| EDGE-08 | Synthetic interrupted update and damaged late-entry rollback backup | Incomplete journal preserved; no partial restore before all backup members pass preflight |

Synthetic scenarios must validate no real customer-facing messages, no unauthorized RO changes and no migration of protected Workspace material. Never perform destructive interruption against a real installation.

## On-device capture procedure

1. Record the version and hash from the verified package/manifest. Create a **separate synthetic copy** of the installation and ensure its synthetic Workspace is not a link into the operational Workspace.
2. Open the copy in Windows Microsoft Edge. Use Edge Browser Task Manager (`Shift+Esc`) to record CPU and memory for the application's tab while reproducing each scenario.
3. In Edge DevTools, record a Performance profile for a short, reproducible operation. Look for long main-thread tasks, repeated parsing, expensive DOM/layout work, and stalled file operations. Do not publicly share the raw capture.
4. Repeat the same operation on the baseline Beta and candidate Beta with comparable synthetic data and environment. Record p50/p95 rather than selecting a single best run.
5. Separate **browser/application** delays from **OneDrive** hydration or file-lock delays. Log whether Windows reports the synthetic file as online-only or locally available; do not infer an application's parser defect from a dehydrated file.
6. Verify that failed saves/recovery requests leave original synthetic bytes and journals intact; inspect read-back status before treating a write as complete.
7. Share only de-identified result summaries in the corresponding GitHub issue. Mark unrun or unsupported scenarios **blocked / unverified**, never passed.

## Release decision

An improvement may ship to Beta on trusted synthetic CI, but #164 cannot be declared fully verified until its high-priority Windows/Edge/OneDrive outcomes have genuine field evidence or an explicit recorded external-environment blocker. Keep Stable unchanged without separate owner authorization.
