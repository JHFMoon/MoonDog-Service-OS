# Beta 0.10.18 Operational Audit

This audit reviews the dashboard against the operating goal: control the day, finish work, protect customer experience, and make the system easier to run without manager intervention.

## Changes included in Beta 0.10.18-beta.1

- Home now includes a compact manager control pulse for overdue commitments, due-today work, missing finish plans, 2+ day vehicles, 5+ day vehicles, customer updates, and comebacks.
- Open RO Control is placed ahead of Assign Next in the primary navigation so finishing work is visually prioritized before starting more.
- Open RO Control gains direct filters for 2+ day vehicles, 5+ day vehicles, customer updates, and comebacks.
- Monday is restored as a normal Daily Walk day. Sunday remains the non-review day.
- Store overview counts only active ROs as open.
- CSI refresh needs are surfaced ahead of lower-priority report refreshes.
- Customer-update and comeback work receive stronger daily-task priority than routine waiter work when no higher commitment is already due.
- Unsaved Home task drafts and Open RO edits require confirmation before being discarded.
- Keyboard focus visibility and active-page navigation semantics are improved.
- Obsolete owner-authority wording is removed from Beta UI.
- The Beta updater no longer depends on the retired owner-editing policy. It still requires explicit browser write permission, package verification, approved paths, rollback backup, and read-back verification.

## Audit conclusions

### Home
Keep Home focused on one next action plus a compact control pulse. Do not turn it back into a dense dashboard.

### Open RO Control
This remains the operational center of gravity. Long vehicles, missing plans, customer communication, comebacks, and due commitments should stay one click away.

### Assign Next
Use it after current work is controlled. Workload should continue to be based on current Open ROs rather than appointment count alone.

### Advisor Performance
Continue suppressing metrics when source freshness or reconciliation is not verified. Accuracy is more important than filling every card.

### Advisor Meeting
Keep the TV view presentation-first and manager diagnostics out of fullscreen. Meeting metrics should remain source-reconciled and clearly comparable.

### Arrivals
Keep this focused on today, rush windows, advisor load, and check-in execution. Do not expand it into a second WIP screen.

### Tools / Imports
Keep report acquisition centralized here and let Home show only the highest-value missing-data requests.

### Settings
Avoid adding routine operating controls here. Settings should remain configuration, recovery, update, and setup—not daily workflow.

## Next improvements to consider after Beta feedback

1. A real cross-device coordination model for the OneDrive workspace, replacing the removed single-computer owner lock without bringing back brittle browser identity.
2. Technician-capacity planning only if a reliable technician schedule/hours source is available; do not estimate capacity from appointment count.
3. Parts-delay ownership and ETA aging if a trustworthy parts/SOR source can tie delays to individual ROs.
4. Explicit inspection-completion opportunity tracking when a reliable vehicle-level inspection source becomes available.
5. A controlled customer-escalation queue if escalation data can be captured without duplicating Open RO management state.

These are intentionally not fabricated from incomplete data. The dashboard should add a control only when the underlying source can support it.
