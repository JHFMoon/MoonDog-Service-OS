# Additional reporting intake — security-first source registry

This implementation was designed against several *local, uncommitted source files* representing exported reporting families. No customer, VIN, advisor, employee, store-specific code, report workbook, PDF, raw screenshot, or local configuration is part of this repository or any updater package.

## Source families and disposition

| Source family | Source shape | Destination and trust level | Intended operational use |
| --- | --- | --- | --- |
| Appointment Activity (daily or multi-day) | XLSX, header row, `Merged` or first worksheet; optional `Remarks` | Existing `appointmentActivity` local snapshots; configured store filtering; **aggregates only**, not a roster or primary appointments | Creation-date activity, interaction mix, scheduling lead-time bands |
| Menu Sales | XLSX, `HyperBi Report` + `Parameters` | Existing configured-advisor, uniquely identified store importer (already supported) | Existing local menu scorecards; never infer store from filename |
| Advisor-grouped Open ROs | XLSX, repeated `SVCADV` sections, global rows-returned count and RO headers | **Primary automatically from the dedicated Report Inbox only after strict group/global count reconciliation**; unverified workbook layouts never replace the roster | Verified active RO roster when complete; otherwise nonauthoritative counts with no individual detail retained |
| Trade AR Error Report | XLSX, `Trade AR Error Report` detail worksheet | **Supplemental**, store-filtered aggregate with no customer or invoice detail retained | Open receivables aging and follow-up-attempt context; no KPI promotion |
| ATO task report | PDF with TASK_WEEK / TASK_DATE, category, submarket and task measures | **Supplemental**, filter context not verified, no KPI promotion | Market/task completion benchmark, response-time context |
| Stellantis Events Calendar guide | PDF instructional document | **Supplemental procedural reference**, not employee training records | Training registration checking procedure |
| Decorative images/icons | PNG without source report data | Deliberately not ingested | No report use |

## Protections built into these new adapters

- Real input documents must stay in the installed `System Files/Workspace/` or approved company-controlled files. Never attach them to public GitHub issues, PRs, commits, release assets, package outputs, logs, or screenshots.
- The public repository stores only reusable code, this general documentation, and **synthetic tests**.
- Appointment Activity requires a configured local store code and evidence the source contains multiple stores. It retains only counts by creation date, interaction type, and elapsed booking-day bands. Names, customer numbers, VIN, appointment notes and remarks are never retained.
- Appointment lead time is **appointment date minus creation date**. Negative, implausibly long, or unparsable date pairs are excluded from lead-time bands, not replaced with zeros.
- An unreconciled advisor-grouped Open RO export **must not** replace or close the live Open RO population. It is not necessarily complete, does not supply authoritative CDK workflow facts, and may contain repeated headings or non-vehicle rows. Its supplemental fallback records counts with an explicit completeness flag and does not persist individual identifiers or financial rows.
- A grouped Open RO export **can** become a primary roster when every advisor-section count, the global rows-returned count, repeated headers, distinct numeric RO identities, dates, and statuses reconcile. The source's counted `WEB*` placeholder is not a repair order. The primary path requires an explicitly selected source and preserves richer manager/CDK state. A failed reconciliation routes only to supplemental review without changing the active roster.
- Trade AR is a **multi-store** workbook. Only rows with the locally configured `AN Store#` may contribute to its supplemental snapshot; use a private `sourceAdapters.reports.tradeAr.storeCode` mapping if this differs from the dashboard's store code. No matched store means review, not a misleading zero balance. The detail worksheet is required; the cross-store Summary pivot is not promoted into store metrics.
- Trade AR retains only a scoped invoice count, monetary totals, aging buckets, follow-up-attempt counts and source-validation counts. Customer numbers/names, invoice numbers, purchase orders, narrative reasons, last notes, and other stores' money are never stored. The optional file-name date is marked unverified; the report does not establish an authoritative receivables or service KPI.
- ATO exports may reflect arbitrary applied filters (market, store, role, category and dates). Reading a grand total does not prove it belongs to the configured store. This family stays supplemental, and the first-page summary is used only if the totals independently reconcile.
- The training PDF describes **how to confirm** registration. It is not a training roster; **Approved** and calendar color alone do not prove an enrolled seat. No actual employee training status may be inferred from this reference document.
- Supplemental sources are not allowed to overwrite SAPR, Menu, CSI, VIR, official Open RO, or primary appointment data. Supplemental observations remain protected local snapshots with `kpiPromotion:false`.
- If a source does not match its expected structure, preserve the original and route it through local review. Never silently accept a partially matched family as the wrong primary source.

## Reporting UI and expansion path

Use the existing **Reports & Data / supplemental-report** local interface for these additional observations first. Do not add a second home-page tile for every new report. Promote a new visual panel only when verified store scope, denominator, date coverage, meaningful action and stable source cadence have been established. Favor the manager's daily workflow and top three decisions rather than additional decorative metrics.

As further report families arrive, add a synthetic adapter contract and tests, establish whether it is authoritative or supplemental, prove store/period/advisor isolation, define exactly which fields are retained, and document any cross-report reconciliation rule. Keep actual source files and mappings local.

## Known limits of this increment

- Source-file existence is **not** proof that the installed system has imported it. Installation requires an approved, verified software update followed by local import.
- Snapshot summary values do not guarantee every source header or export revision; error-handling remains fail-closed.
- Multiple overlapping multi-day Appointment Activity exports may describe overlapping event populations. Do not sum the snapshots blindly or treat the sum as unique appointments without a verified de-duplication method.
- Advisor-grouped Open RO summary provides no reliable point-in-time timestamp or verified dealership identity in this format; it intentionally does not create historical trends from inferred dates.
- ATO screenshot/PDF categories are not an individual task export and cannot establish individual employee accountability without additional authorized structured data.
- The instructional training PDF cannot prove which employees registered or attended a class.

## Source provenance

Family structures were determined from owner-provided files and must be verified again locally when imports occur. Only synthetic tests representing those structures are published.
