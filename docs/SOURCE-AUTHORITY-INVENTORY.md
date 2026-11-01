# Source authority and lineage inventory

**Scope:** This is a source-code audit of current contracts, not a claim that every dashboard metric has complete end-to-end provenance. It uses generic source names only. No store-specific mappings, report data, or operational records belong here.

## Authority layers

| Domain | Authoritative input | Derived or retained values | Conflict rule and limit |
| --- | --- | --- | --- |
| Current Open RO roster and raw repair status | The latest validated CDK Open RO snapshot for the current operating view | Parsed RO facts, advisor/technician source identities, workload summaries | A filename or timestamp alone does not prove report coverage. A manager's saved follow-up plan remains a separate authority. If a later verified complete roster adds a valid VIN to a uniquely identifiable previously VIN-less RO, the report may enrich the source identity without discarding its manager plan or counting it as closed; conflicting known VINs or ambiguous RO matches must not inherit management records. A full-VIN conflict with a colliding last-eight-character generated stable ID fails closed and retains the source for review. The aggregate Open RO summary is reference data, not a replacement for the current roster. |
| Manager-reviewed RO status and follow-up | Protected local management fields and saved activity history | Daily Focus, manager attention, owner/action/date presentation | A saved manager status with `management.updatedAt` takes precedence in the management-status view. CDK status disagreement remains source evidence. An intentionally blank owner is stored with `ownerAssignmentSource: manager-cleared` so later source-identity reconciliation or a workbook round trip cannot silently assign the source advisor; legacy blank owners without the explicit manager marker still receive the verified source writer. Import does not silently replace a manager's saved decision. |
| SAPR performance and operating-day denominator | Validated SAPR period and values | Gross, ELR, RO counts, advisor production, and working-day comparisons listed in the generic refresh catalog | SAPR is the authority for reported days worked. An in-progress current-day report is paced as half a day while the reported count remains available. Prior-year comparisons require a close verified working-day count; calendar-date similarity is not enough. Missing values remain unknown. |
| CSI customer responses | Validated cumulative CSI export, survey event dates, advisor mapping, and verified report scope | NPS, promoter/passive/detractor counts, response coverage | Report observation/scope determines freshness; a survey event date or local import time alone does not. Zero new responses is valid. Response dates and report observation dates are distinct. CSI is recoverable from a verified cumulative export; an empty day is not a missing daily report. |
| Menu Sales | Validated workbook snapshot for its represented Monday release week | Store/advisor presentation and penetration measures | The release week and covered period travel with the imported snapshot. Presentation and penetration remain distinct measures. A current release cannot recreate an absent earlier release. |
| VIR | Validated VIR Use Utilization report | VIR utilization trend | VIR is an optional dated trend source. An explicitly supplied but impossible VIR observation date is invalid and must not fall back to the file modification time; genuinely undated reports retain point-in-time file provenance. VIR does not establish SAPR production, CSI responses, or the current Open RO roster. Missing optional history is not a zero. |
| Appointments and next appointments | Accepted appointment/pre-RO snapshot with a saved, valid observation date; Next Appointments report or the explicitly approved service-only substitute for that source | Today's arrivals and upcoming appointment view | An undated or impossible-date saved Arrivals snapshot is INVALID, even if imported today; its period cannot be inferred from the day lookup key. The substitute satisfies only the defined Next Appointments authority. Appointment activity and aggregate Open RO summaries remain reference/archival inputs, not current operational snapshots. |
| Other dated reference feeds | Their validated report period: SOR, appointment activity, efficiency, Media ASR advisor/technician | Period-specific or optional trend values | A source is valid only for its stated period. Its freshness category does not make it authoritative for another feed's facts. |
| Durable history, settings, and manual edits | Protected local Workspace records written through verified save/read-back paths | Saved management decisions, source locations, refresh cadence, user actions | Public source and packages do not overwrite Workspace state. Manual management edits remain distinguishable from imported observations; synchronization is not a distributed multi-writer lock. |

## Implemented evidence

The contracts above are grounded in:

- `assets/freshness.js`: canonical source labels/cadences, status evaluation, CSI observation/scope freshness, SAPR and weekly Menu Sales trend rules, optional/reference classifications, and report-need decisions.
- `assets/app.js`: actual source parsers/importers, persisted operational metrics, CDK status lineage, manager overrides, and verified writes.
- `assets/daily-ops.js`: protected local history and manager activity.
- `docs/OPERATING-INTELLIGENCE.md`: documented SAPR pacing and the scoped CDK-versus-manager Open RO status contract.
- `tests/context-aware-freshness.test.cjs`: synthetic stale/current cases, including zero-response CSI, old-scope CSI, and missing sources.
- `tests/csi-ingestion-path.test.cjs`, `tests/menu-sales-durable-readback.test.cjs`, `tests/cdk-operational-status.test.cjs`, and `tests/open-ro-source-identity.test.cjs`: production-function import, read-back, status, and identity regressions.
- `tests/source-boundary.test.cjs`: public source has no store-specific targets or identities and the package excludes protected Workspace data.

- PR #661 (Beta .250) hardens the production Arrivals source-confidence adapter against missing/impossible report dates and tests its active report-need and metric-confidence results with synthetic production-function fixtures. It is incremental evidence for #59-01, not criterion closure.
- An independent current Open RO workload snapshot may satisfy a missing source under the documented fallback, but must never suppress an explicitly INVALID or conflicting Open RO source. The #59-04 readiness guard is separately pending protected validation.

## Remaining verification

This inventory does **not** close criterion 59-01. The following cross-view checks remain necessary:

1. Feed one synthetic dated source snapshot through import, stored metrics, Home, Meeting, reports, and history; assert each view uses the same authorized period and calculation inputs.
2. For each source family above, inject missing, stale, unsupported, duplicate, and conflicting-period records; assert the UI distinguishes unknown, stale, conflict, and true zero without silently selecting a weaker source.
3. Trace imported and manually edited RO fields through save, reload, reimport, and recovery; verify both the selected authority and its provenance remain visible.
4. Add source-specific cases for VIR and the reference feeds, plus any metric whose current UI has no explicit input lineage.

The code inventory identifies the present authority rules and their limits. Cross-view lineage coverage remains **PARTIALLY COMPLETE** until those tests pass in a protected Beta change.
