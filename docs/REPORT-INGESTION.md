# Report and learned-source ingestion

Service Operations Hub separates **primary operational sources**, **supplemental operational sources**, and **known non-service documents**.

Primary sources may update live operating state. Supplemental sources are retained as compact local snapshots and are explicitly marked `supplementalOnly` with KPI promotion disabled. Known non-service documents are identified so they do not remain in **Files To Learn** and do not create operational data.

## Primary operational sources

In addition to the established XLSX Open RO formats, the Hub accepts the CDK **Repair Orders browser-export DOCX** as a primary Open RO source.

The DOCX parser reconciles the source summary against the detailed population before saving. It imports active ROs into current Open RO state, preserves existing manager-entered state for matching ROs, updates Assign Next workload evidence, excludes source rows explicitly marked Closed, verifies durable persistence, and only then removes the inbox / learned-source copy.

The parser retains the same operational fields used by Open RO control: RO, source status, customer, VIN / vehicle, tag, advisor, technician, opened time, promised time, closed time when present, and service-line indicators.

## Supplemental operational sources

The Report Inbox can recognize and durably retain compact snapshots for:

- Mopar Retail Rewards:
  - Core Four / pre-qualifiers
  - Parts Loyalty
  - Maintenance Penetration
  - Bulk Oil Penetration
- ServiceView:
  - Parts Analysis
  - Repair Order Analysis
  - Retention
  - First Year Retention
- CX / Dealer Dashboard:
  - Service NPS exports
  - filtered NPS variants
  - Service Response Rate
- Mopar TireWorks:
  - Tire Search usage
  - Print Quote tracking
  - Tire Sales Projection
- Controllable Ranking PDF exports
- Appointments Created Summary CSV
- Cash Clearing workbook summaries
- Credit Holds workbook summaries
- Mopar Quality Inspection Requests:
  - suspect part numbers
  - issue date
  - packaging-date range when supplied
  - suspect-part criteria
  - quarantine / review action
- Express Lane / service-consulting audits:
  - audit date
  - selected checklist operating facts
  - service-flow cycle times
  - observed RO identifiers without copying customer detail
  - recommendation / approval counts
  - action-plan owner, severity, due date, reason, and suggested action
- Customer outreach transcript PDFs:
  - conversation period
  - participant roles
  - message counts
  - latest customer request
  - unresolved handoff / follow-up state
- Technician Video MPI playbooks:
  - expected duration
  - required communication sequence
  - traffic-light inspection convention
  - filming / coaching rules

Service-consulting action-plan items, recent unresolved outreach handoffs, and current parts-quality alerts can contribute concise items to Manager Attention. Supplemental data does not silently replace SAPR, CSI, VIR, Menu, or other authoritative KPI families.

The intake path also recognizes valid-but-empty exports for Media ASR, Efficiency Tracking, and blank Service Daily Log workbooks. Empty reports are retained as explicit no-data observations and do not overwrite active KPI families with fabricated zeroes.

## Known non-service documents

The following files are deliberately outside Service Operations Hub operational data:

- incident / first-report / automobile-loss claim forms
- collision-repair estimates

When these are found in Report Inbox or Files To Learn, the Hub verifies the document type, records that it was excluded from Service OS, and retires the inbox / learned-source copy without retaining the document contents.

These records may still need to be kept in the company's normal claims, risk, accounting, or collision-repair record system. Service Operations Hub is simply not that system.

## Files To Learn rule

**Files To Learn is only for genuinely unknown or recognized-but-broken structures.**

A known supported source must be ingested and removed after durable verification. A known non-service source must be identified and retired. Once this registry knows a file family, that family should not continue accumulating in Files To Learn.

## Data boundary

Source reports remain local. The public repository contains only generic parser / classifier logic, tests, schemas, and documentation. It must not contain dealership report files, customer records, employee records, repair orders, VINs, report snapshots, or local operational state.

Supplemental parsers intentionally prefer compact operational facts and source provenance over copying entire report bodies.

## Final source-material triage

The following source types have an explicit disposition so they do not remain indefinitely in Files To Learn:

| Source type | Service OS disposition | Why |
| --- | --- | --- |
| CDK Repair Orders browser-export DOCX | Primary Open RO source | Reconciles the complete active RO population, writer/technician codes, source status, open/promised times, VIN, tag, vehicle, and service-line presence before replacing the current Open RO source. |
| Mopar Express Lane Standards / Service Flow / Action Plan PDF | Supplemental manager-operating source | Retains cycle-time steps, audit observations, recommendations, and dated action-plan items without promoting them into unrelated KPI families. |
| Quality Inspection Request (QIR) PDF | Parts-quality operational alert | Retains affected part numbers, suspect criteria, dates, and quarantine action so the department can avoid installing or selling suspect inventory. |
| Autumn Ivy outreach transcript PDF | Customer follow-up source | Retains the local conversation summary and identifies unresolved handoffs/follow-up needs. It remains local and is not a public-repo artifact. |
| Technician Video MPI Playbook DOCX | Coaching/process standard | Retains the expected video sequence, inspection examples, filming rules, and timing standard for coaching context. |
| Incident/claim forms | Recognized and retired | Useful as claim records, but not Service Operations Hub workflow/performance data. No Service OS snapshot is retained. |
| Collision repair estimate | Recognized and retired | Body/collision claim estimate data does not belong in service-drive KPI or Open RO control. No Service OS snapshot is retained. |
| Decorative image fragments / logos | Unsupported and disposable | They contain no operational source data and should not be taught as report families. |

CDK browser exports commonly split VIN from vehicle description and split dates from clock times into separate document lines. The parser explicitly supports that export shape and requires the parsed All/Open/Closed counts to reconcile to the report header before replacing the current Open RO population.
