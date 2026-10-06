# Changelog

This file summarizes user-relevant release milestones. The Git commit history remains the detailed engineering record.

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

## 0.10.9-beta.3 — current Beta

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

## 0.10.8 — current Stable

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
