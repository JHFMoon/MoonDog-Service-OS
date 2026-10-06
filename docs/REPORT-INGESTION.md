# Supplemental report ingestion

Service Operations Hub separates **primary operational sources** from **supplemental/reference sources**.

Primary sources continue to drive the existing KPI, Open RO, appointment, CSI, VIR, Menu, efficiency, Media ASR, and related workflows. Supplemental sources are stored as compact local snapshots and are explicitly marked `supplementalOnly` with KPI promotion disabled.

## Supported supplemental sources

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
  - filtered NPS variants such as maintenance
  - Service Response Rate
- Mopar TireWorks:
  - Tire Search usage
  - Print Quote tracking
  - Tire Sales Projection
- Controllable Ranking PDF exports
- Appointments Created Summary CSV
- Cash Clearing workbook summaries
- Credit Holds workbook summaries
- CDK Repair Orders browser-export DOCX summary counts

The intake path also recognizes valid-but-empty exports for Media ASR, Efficiency Tracking, and blank Service Daily Log workbooks. Empty reports are retained as explicit no-data observations and do not overwrite active KPI families with fabricated zeroes.

## Known reference-only documents

Some files are useful operational references but must not be treated as performance data. They are recognized and moved to **Files To Learn** with a non-KPI reason instead of being promoted into metrics. Examples include:

- Quality Inspection Requests / parts quarantine notices
- incident / automobile loss claim forms
- collision repair estimates
- customer outreach transcripts
- technician training/playbook documents

## Data boundary

Source reports remain local. The public repository contains only generic parser/classifier logic, tests, schemas, and documentation. It must not contain dealership report files, customer records, employee records, repair orders, VINs, report snapshots, or local operational state.

Supplemental parsers intentionally prefer compact aggregates and source provenance over copying entire report bodies. Where a source contains customer-level or transaction-level detail, the supplemental snapshot retains only the fields needed for operational context and validation.
