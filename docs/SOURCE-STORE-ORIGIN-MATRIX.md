# Source-store origin authority: 59-01 acceptance inventory

**Scope:** Generic code-only assessment for the 14 catalogued source families. A configured destination is not evidence that an incoming file originated with that dealership. Files are unsigned. No real dealership data or internal identifiers belong here. This matrix is an engineering gap map, not independent certification.

## Required local authority states

The shared `classifySourceStoreOrigin()` contract in `assets/freshness.js` reports:
- `verified-source-store`: report-supplied **name, exact code, and brand** are complete and match the configured destination; or an owner-verified, exact-family source alias binds the complete reported identity to the complete local identity. This is content validation, **not a cryptographic signature**.
- `configured-destination-only`: missing/partial source markers, or incomplete destination Guided Setup. No source-store claim may be inferred from filenames, timestamps, advisor overlap or RO IDs.
- `store-conflict`: report-supplied identity disagrees with Guided Setup/verified alias, or the source family is unknown. Do not persist, display as authoritative, or delete a conflicting source.

## Current production source marker audit

| Canonical source family | Evidence available in imported report | Current gap before 59-01 closure |
| --- | --- | --- |
| `openRo` | Complete grouped XLSX reconciles section/global RO totals but has no verified store marker; CDK DOCX likewise unsigned | New grouped roster auto-replacement must be held for manual store review; persist source ownership evidence through reload and every view |
| `sapr` | SAPR period, totals, and advisor worksheets; advisor IDs are not store identity | Require report-origin markers or explicit manual review; persist source-store confidence alongside KPIs |
| `csi` | Survey/event rows, scoring fields and verified cumulative report scope; response dates are not dealership origin | Separate source-store authority from valid survey periods; reject cross-store imports before storing responses |
| `nextAppointments` | Date/summary and advisor codes; approved Appointments Created substitute may be observation-only | Validate source dealership independently of reported counts or time |
| `vir` | Advisor names and VIR utilization; report/file observation date may be validated | Advisor overlap cannot identify store; require provenance |
| `menu` | Multistore Account column, configured exact-name match or fully brand-bound verified account alias | Account selection prevents obvious cross-store rows; name-only source evidence does not independently prove full name/code/brand |
| `appointments` | Daily arrival/PreRO files with dates and appointment identities | No universally verified source dealership marker; protect today's live arrivals from foreign reports |
| `sor` | Report title contains a store code checked with configured code or fully bound vendor alias | Store-code evidence is real but is not a full source name/code/brand tuple |
| `appointmentActivity` | Multistore XLSX Store Code column, exact configured/verified vendor code filtering | Source code and row filtering exist; preserve code-only status and detect contradictory store metadata |
| `efficiency` | Report heading with configured/verified vendor store code | Code-only evidence; source brand/name still need independent verification |
| `mediaAsr` | Report heading with configured/verified vendor store code and dated scope | Code-only evidence; no cross-brand inference from advisor rows |
| `mediaAsrTech` | Media ASR technician scope shares store-code report guard | Preserve source-scope and dealership owner separately |
| `openRoSummary` | Header `Open RO for [store code]` explicitly checked | Code-only reference source, never current detailed roster authority |
| `supervisorWorkbook` | Locally generated from the selected Workspace (not an external vendor-origin feed) | Verify issuance identity and returned workbook update authority against current Workspace; do not treat generation as source export proof |

Supplemental PDF/CSV/XLSX/DOCX families require separate review before any KPI promotion. Non-KPI supplemental classification does not certify the dealership.

## 59-01 closure acceptance still required

1. Every actual importer consumes the common classifier, extracts **real source-provided markers**, and either rejects `store-conflict` or explicitly retains `configured-destination-only` as unverified with a review path. Never assert `verified-source-store` by copying configured settings into source metadata.
2. Durable source/provenance ownership must survive import, restart, clean install, backups/selected restore, reconnect, accepted revisions, and late corrections. No unexplained legacy identity adoption.
3. Home, Meeting, Performance, Reports, History and Open RO must read one selected source period, calculation and dealership owner. Unknown, stale, conflict and true numeric zero are distinct.
4. Test two independently initialized synthetic Workspaces with overlapping advisor/RO IDs, different brands and store markers, missing/partial/conflicting source IDs, duplicate reports, changed source bytes, and explicit manual overrides. Verify no foreign data leaks across views or migrations.
5. Exact-head packaged Beta Publication/Clean Install/strict full-history security and guarded protected merge, with post-merge gates. No Stable promotion without separate explicit owner approval.

**Status:** contractual classifier and synthetic matrix are staging evidence only until protected CI/merge. The broader criterion remains PARTIAL until all import paths and cross-view readback tests are proven.
