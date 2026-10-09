# Changelog

## 0.10.18-beta.7 — current Beta

- Add optional read-only phone PDF snapshot with zero data upload. Verified automated Beta; no Workspace migration.
- Automatically layered onto the previous Beta so existing preview features are preserved.


## 0.10.18-beta.6 — current Beta

- Add optional read-only phone PDF snapshot with zero data upload. Verified automated Beta; no Workspace migration.
- Automatically layered onto the previous Beta so existing preview features are preserved.


## 0.10.18-beta.5 — current Beta

- Manager Top 3 and background noon update notification. Verified automated Beta; no Workspace migration.
- Automatically layered onto the previous Beta so existing preview features are preserved.


## 0.10.18-beta.4 — current Beta

- Proof hardened hands-off Beta delivery. Verified automated Beta; no Workspace migration.
- Automatically layered onto the previous Beta so existing preview features are preserved.


## 0.10.18-beta.3 — current Beta

- Proof: fully automated Beta delivery. Verified automated Beta; no Workspace migration.
- Automatically layered onto the previous Beta so existing preview features are preserved.


## 0.10.18-beta.2 — current Beta

- Uses validated CSI report coverage, not survey response dates or local import time, to determine freshness.
- Imports valid CSI reports with zero scored responses without erasing retained survey history.
- Keeps old CSI report scopes stale even when reimported today.
- Adds parser-to-ingestion and Beta package/runtime regression coverage.
- No Workspace migration; Stable stays 0.10.17.

## 0.10.18-beta.1 — previous Beta

- Adds a compact Home control pulse for overdue commitments, due-today work, missing plans, long vehicles, customer updates, and comebacks.
- Puts Open RO Control ahead of Assign Next so finishing work is visually prioritized before starting more.
- Adds direct 2+ day, 5+ day, customer-update, and comeback filters.
- Corrects the Daily Walk calendar so Monday is active and Sunday is the non-review day.
- Counts only active ROs in the Store overview open-RO metric.
- Prioritizes CSI in the Data Needed refresh queue.
- Protects unsaved Home task drafts and Open RO edits from accidental navigation/close.
- Improves keyboard focus visibility and active-navigation semantics.
- Removes obsolete owner-authority wording from workspace state.
- Decouples application update/recovery from the retired owner-editing policy while retaining explicit folder permission, package verification, rollback backup, approved-path enforcement, and read-back verification.
- No Workspace migration.


## 0.10.17 — current Stable

- Removes the single-computer owner-editing designation requirement.
- Allows editing from any connected dashboard folder when Edge has read/write permission.
- Removes the owner designation and Recover owner editing UI.
- Keeps transaction journaling, revision checks, protected Workspace paths, update verification, and rollback protections.
- Does not let stale legacy transaction journals force the entire dashboard into read-only mode.
- No Workspace migration.

## 0.10.16 — previous Stable

- Treats temporary OneDrive/file-ingestion File System Access conflicts as transient workspace synchronization instead of lost owner authority.
- Retries owner-authority validation automatically while synchronized files settle.
- Shows a neutral **Updating workspace files…** state instead of a red application failure for the known transient interface-state condition.
- Keeps **Recover owner editing** hidden while the workspace is only temporarily busy, then restores editing automatically when validation succeeds.
- Preserves the existing protected Workspace and update rollback boundaries with no migration.

## 0.10.15 — previous Stable

- Adds **Recover owner editing** for a connected local copy that has lost its matching browser identity.
- Requests folder write permission directly from the final recovery click so Edge retains required user activation.
- Preserves the existing write gate: ordinary read-only copies cannot mutate operational data without deliberate owner recovery and verified local folder write access.
- Keeps recovery usable for the current session if browser storage is unavailable, without deleting or publishing operational data.
- Preserves the protected Workspace with no migration.

## 0.10.14 — previous Stable

- Keeps every validated full backup for the first 30 days.
- After 30 days, compacts full backups to one validated recovery point per calendar month across a 12-month window.
- Always preserves the newest three validated full backups, even when they are older than the monthly window.
- Never prunes a full backup unless a newer validated full backup exists.
- Updates the Backup & Recovery policy text and regression coverage for monthly retention.

## 0.10.15-beta.1 — previous Beta

- Carries forward Stable 0.10.14 as the next optional Beta baseline.

## 0.10.13 — previous Stable

- Replaces indefinite backup accumulation with bounded rolling retention across all normal recovery families.
- Keeps at most 3 validated full backups for 90 days and automatically refreshes a full backup every 30 days when current durable state validates.
- Keeps at most 3 resolved system-update rollback backups for 30 days, 2 restore-safety backups for 30 days, and 50 automatic pre-change backups for 30 days.
- Keeps active interrupted-update recovery artifacts out of ordinary pruning, but blocks another software install until that recovery is resolved so the exception cannot multiply.
- Prunes nested resolved system-update rollback folders safely only after their files are unchanged and verified for removal.
- Shows the rolling retention limits directly in Backup & Recovery.

## 0.10.14-beta.1

- Carries forward Stable 0.10.13 as the next optional Beta baseline.

## 0.10.12 — previous Stable

- Promotes the validated Advisor Meeting navigation hotfix so presentation mode cannot remain visible on other tabs.
- Keeps long System Updates workspace paths, file plans, status text, and buttons contained on portrait and narrow layouts.
- Carries forward the full 0.10.11 operating-intelligence feature set with no Workspace migration.
- Publishes through the formal GitHub Stable Release contract with the protected rollback/update path unchanged.

## 0.10.13-beta.1

- Carries forward Stable 0.10.12 as the next optional Beta baseline for future testing.

## 0.10.11 — previous Stable

- Adds a compact Home **Data needed** strip with report/source, date, location, purpose, Update, and Not now, using existing validated freshness evidence.
- Learns typical report arrival times and deferrals in protected local settings; repeated uploads improve scheduling without writing operational data to GitHub.
- Shows a maximum of five distinct, actionable Home priorities with direct navigation and no unnecessary Wins Today feed.
- Uses the reported SAPR days worked, counting an open day as 0.5 for pace/remaining-day calculations, and matches prior-year snapshots by the closest verified working-day count.
- Presents the Store and each advisor as a single 30-second rotating meeting slide, with configurable duration and automatic 16:9 or 9:16 composition.
- Bundles new generic modules into existing updater-approved runtime paths for a normal protected update; preserves browser-origin compatibility and all Workspace data.
- Publishes a formal GitHub Stable Release and an opt-in next-version Beta from the same verified baseline.

## 0.10.12-beta.2

- Keeps Advisor Meeting presentation mode isolated to the Meeting tab; switching tabs immediately restores the normal page layout.
- Wraps long System Updates workspace paths, plan details, and status text so portrait/narrow screens do not overflow the card.
- Preserves the protected update, rollback, and Workspace-data boundaries with no migration required.

## 0.10.12-beta.1

- Carries forward the validated 0.10.11 experience as the new optional Beta baseline for future testing.

## 0.10.10 — previous Stable

- Promotes the locally validated single-store architecture with one authoritative writable computer and read-only synchronized copies.
- Keeps maintained application files under `System Files/` and protected operational state under `System Files/Workspace/`.
- Preserves the root browser-origin compatibility document used by migrated Edge installations while keeping `00 - OPEN DASHBOARD.html` as the normal launcher.
- Adds revision-safe durable writes, persistent write/delete recovery, protected updater paths, and verified rollback behavior.
- Publishes the reviewed first-party runtime source and third-party license notices required by the current installation.
- Requires updater version `0.10.9` or later; 0.10.8-era installs are intentionally rejected rather than exposed to an unsafe layout migration.
- Uses neutral Service Operations Dashboard wording while retaining legacy internal identifiers where compatibility requires them.
- Establishes the Stable publication contract: public Stable versions are formal GitHub Releases with matching `v<version>` tags and verified updater package assets; the Stable manifest points to the same tag-pinned, SHA-256-verified package through the browser-compatible GitHub raw service.

This file summarizes user-relevant release milestones. The Git commit history remains the detailed engineering record.

## 0.10.9-beta.8

- Shows live installation progress, including percentage, current step, file count, verified completion, and rollback or recovery progress in System Updates.

## 0.10.9-beta.7

- Uses the authoritative CDK workflow statuses for new Open RO reviews, with explicit management details for authorization, technician wait, and ready-for-review states.
- Preserves saved reviews and follow-up commitments while showing a cue when a confirmed CDK status changes.

## 0.10.9-beta.6

- Fixes CDK Repair Orders DOCX ingestion for the actual browser-export layout where VIN/vehicle and date/time are split across separate lines.
- Requires the parsed All/Open/Closed population to reconcile before the DOCX can replace current Open RO data.
- Finalizes source-material triage: service-flow/action-plan audits, QIR alerts, outreach transcripts, and video-MPI standards remain useful local sources; incident claims and collision estimates are recognized and retired; decorative image fragments remain disposable.
- No uploaded source file or dealership operational data is published to GitHub.

## 0.10.9-beta.5

- Promotes the CDK Repair Orders DOCX browser export to a reconciled primary Open RO source, including active RO detail and Assign Next workload evidence.
- Adds useful learned-source ingestion for Mopar QIR parts alerts, Express Lane/service-consulting audits and action plans, customer outreach transcripts, and the Technician Video MPI coaching standard.
- Feeds current service-consulting actions, unresolved outreach handoffs, and recent parts-quality alerts into Manager Attention without changing authoritative KPI families.
- Treats claim/loss forms and collision estimates as verified non-service records; their inbox or Files To Learn copies are retired instead of accumulating as unknown files.
- Keeps all uploaded source material local and out of GitHub.

## 0.10.9-beta.4

- Adds isolated supplemental ingestion for Mopar Retail Rewards, ServiceView, CX/NPS, TireWorks, Controllable Ranking, appointment-summary, Cash Clearing, Credit Holds, and CDK browser-export summaries.
- Recognizes valid-but-empty Media ASR, Efficiency Tracking, and Service Daily Log exports without fabricating KPI zeroes.
- Keeps supplemental snapshots out of active KPI promotion unless a future explicit mapping is implemented.
- Recognizes claims, collision estimates, QIR bulletins, outreach transcripts, and training playbooks as non-KPI reference documents and keeps them in Files To Learn.
- Keeps all source reports local; no source PDF, spreadsheet, CSV, or DOCX is published to GitHub.

## 0.10.9-beta.3

- Repairs the Publication check after the sanitized Git history rewrite and updates its tests to use the active Stable/Beta packages.
- Corrects the local-target publication regex so target values are actually blocked from future public source and release packages.
- Keeps the Home queue free of the vague appointment-preparation task introduced in earlier Beta work.
- Expands Open RO source parsing for advisor/writer and technician fields, including common advisor/tech number headers.
- Recovers missing advisor ownership from the current Open RO workload ledger when the detailed record lacks it.
- Resolves technician names from stored source fields and the protected local technician directory when possible.
- Shows **Written by**, **Source technician**, and **Source status** directly on the Home RO review card.
- Renames **Owner** to **Follow-up owner** and defaults an unassigned follow-up owner to the source service advisor without overwriting an existing manual owner.
- Reconciles existing durable Open RO records on connection, so the fix is not limited to newly imported ROs.

## 0.10.9-beta.2

- Removes the vague “Prepare for this arrival” Home task and its arrival-status form.
- Stops tomorrow-planning prompts from being triggered merely because appointments are scheduled.
- Keeps the useful end-of-day “Make tomorrow ready” task when unresolved RO follow-ups, customer updates, or finish plans still need attention.
- Keeps Today’s Arrivals as an intentional operational view for schedule, rush-window, and porter/check-in work.

## 0.10.9-beta.1

- Moves store performance targets, required thresholds, gross minimum/stretch values, and dollar goals out of public application defaults.
- Preserves target values already saved in the connected local settings file.
- Adds local-only fields for store gross, Dealer NPS, VIR, Menu, Media Viewed, Texting, CP ELR, and CP Hours / RO.
- Leaves newly introduced local target fields unconfigured until the manager enters them.
- Adds publication checks that reject numeric literals in protected target keys and public goal/target text.
- Uses sanitized Stable 0.10.8 as the reversible return baseline.

## 0.10.8

- Sanitized restoration baseline with store performance targets removed from public defaults.
- Preserves protected local operational data and locally saved settings during updates and rollback.

## 0.10.8-beta.3

- Replaces a stale “reconnecting” banner with a verified connected state after folder restoration completes.
- Shows installed-version availability more clearly after an update and labels the Beta install action consistently even before a fresh check.
- Gives the System Updates panel more useful desktop width when it is the selected Tools section.
- Adds focused regression coverage for the screenshot-state issues.

## 0.10.8-beta.2

- Uses the operating system Light/Dark preference on first run until the user makes an explicit theme choice.
- Makes the installed Beta/Stable channel visible immediately in System Updates.
- Labels Beta installation actions explicitly and keeps the verified Stable-return path visible.
- Refreshes runtime build metadata to October 6, 2026.
- Adds repository runtime mirrors for the browser updater and a test that prevents those mirrors from drifting.

## 0.10.8-beta.1

- Moves the generic application core, including `index.html` and `assets/app.js`, under GitHub source authority.
- Reads store/employee/report-specific parser mappings from protected local configuration instead of embedding dealership identity in public source.
- Preserves the browser-local Light/Dark theme.
- Keeps the installed Hub offline-capable.
- Uses the existing verified dry-run, backup, readback, rollback, and recovery update path.

## 0.10.7

- Establishes the sanitized generic application source as the Stable restoration baseline.
- Covers every application file touched by the current Beta path.
- Keeps dealership configuration and operational data local.

## 0.10.7-beta.2

- Added the browser-local Light/Dark mode control.
- Proved GitHub → update package → System Updates → local installation end to end.

## 0.10.7-beta.1

- Controlled no-op Beta used to prove package verification, channel switching, install, and Stable return behavior.

## 0.10.6

- Pre-Beta Stable baseline retained for compatibility/history.
