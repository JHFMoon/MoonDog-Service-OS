# MoonDog: Research-Backed Systems Improvement Register

**Status:** recommendations / research, not implementation proof. **Date:** 2026-10-16. This register supplements existing approved issues #53, #57–#61, #72, #161 and #164; it must not displace or duplicate their acceptance criteria. Reconcile every entry against live source, CI, PRs, and installation evidence before work. No dealership data is included.

## Product boundary

MoonDog is a manager-facing **observation, exception, coaching and follow-through** system, not the dealer management system of record. Ingested source records can be delayed. Do **not** implement unauthorized pre-dispatch gates, automatic RO closure, warranty authorization, or automated external customer messages (see issue #72). The Advisor Meeting TV remains the advisor-facing surface; no other advisor portal is authorized.

## Priority rules

- P0 = safety, truthfulness, potential data loss, release authorization and verified workflow blockers.
- P1 = measurable reduction in manager time, speed, source integrity and preventable CSI/operating failures.
- P2 = modular growth and advanced decision support after sufficient source and reliability evidence.
- For every entry: inspect current implementation, define an independently verifiable acceptance test, make one reversible Beta-only change, test and log evidence. No Stable promotion without explicit owner approval.
- Status below is **proposed**, not a claim of current missing functionality. Existing delivered functionality must be measured before being redesigned.

## P0 — trust and engineering controls

| ID | Research target | Repository evidence / reason | Verification gate |
|---|---|---|---|
| T01 | Resolve guarded merge consent and stale-trigger noise | Draft PR #183; open PR #144; `.github/workflows/guarded-pr-merge.yml` | Untrusted, negated, quoted, stale and revoked consent cannot merge; positive consent requires exact-head checks |
| T02 | Finish full-surface audit reliability and enforce meaningful release status | PR #184; independent `Public Surface Audit`; main ruleset currently explicitly requires `Publication Check` | Bounded retries fail closed; artifacts inspected; distinct run/check states; no circular deadlock |
| T03 | Restore documentation as executable contract | `docs/ARCHITECTURE.md` and `docs/RELEASE-PROCESS.md` refer to old Beta 24; README setup still says designate owner while Stable states owner gate removed | Docs and generated user instructions match actual manifest, setup flow and release policy; automated drift check |
| T04 | Validate single-writer/workspace concurrency assumption | `assets/moondog-write-authority.js` explicitly notes temporary open editing; synced folders are not multiwriter databases | Conflicting tabs/copies/OneDrive replacement safely detected; revisions preserved; no false write success |
| T05 | Prove end-to-end recoverability, not only backup creation | `assets/maintenance.js`; issue #164 | Test realistic crash at each write/rollback boundary; recover exact prior bytes and status with retention safeguards |
| T06 | Verify a real authorized recurring coding executor | `docs/ENGINEERING-CONTINUATION.md` acknowledges no verified always-running coding agent | Credentials, budgets, capabilities, sandbox, stop conditions and exact Beta publish proof documented; scheduler alone not claimed as agent |
| T07 | Supply-chain hardening and component inventory | Existing action version tags, pinned third-party JS/PDF/XLSX distribution | Evaluate full immutable Actions pinning, SBOM, provenance attestations and automated dependency review; do not disrupt offline package |
| T08 | Source and installation authority inventory | README, `docs/SOURCE-OF-TRUTH.md` and multiple workflow systems | One unambiguous catalog of generic software vs local source authority vs public mobile mirror vs installed version, with safe compatibility rules |

## P1 — operational control and product quality

| ID | Research target | Source / reason | Verification gate |
|---|---|---|---|
| O01 | Evidence-first top-three manager queue | `docs/OPERATING-INTELLIGENCE.md`; issue #53 | Source, period, confidence, owner, next action, commitment, due time; no duplicate, stale or ungrounded alerts |
| O02 | Administrative closeout commitments | Issue #72 | Separate post-repair pickup/paperwork/claim tasks and expected RO close date; preserve revised/missed promises; never auto-close |
| O03 | Capacity and carryover exposure | Shop capacity depends on actual productive tech hours, not appointment counts | Verified tech availability, skill, diagnostic load and promise risk with explicit gaps; advisory-only, no phantom dispatch |
| O04 | Parts/warranty/quality dependencies | `docs/REPORT-INGESTION.md` already identifies QIR, parts and warranty sources | Verified parts/claim blocking evidence, local action owner, aging and next review; no unsupported status assumption |
| O05 | Source contract registry and reconciliation | DOCX/XLSX Open RO and supplemental sources share records | Schema/version, authoritative scope, dedupe, closure-by-omission completeness, manual-vs-source precedence and recoverability |
| O06 | Customer-update promise and comeback prevention | Core CSI-driven management intent | Clearly manager-confirmed obligations; alert only when due/worsening; source-backed escalation and feedback loop |
| O07 | Advisor coaching with practical drivers | KPI authority from SAPR and other approved feeds | Explain controllable driver, denominator/sample confidence, action plan and next review; no employee disciplinary dossiers |
| O08 | CSI, inspection, financial metrics integrity | Different feeds, time windows and reporting delays | Consistent definitions, close-of-month readiness, late corrections and no misleading zero / stale trend |
| O09 | Real installed Windows Edge performance evidence | Issues #58/#164; CI synthetic measurements are not field benchmarks | Local, privacy-safe cold/warm launch, folder connect, first usable Home, import, navigation and long-session profiles |
| O10 | Bounded task scheduler + worker feasibility | `assets/app.js` concentration, large source parsing; offline file:// constraints | Cancellation, priority, no conflicting writes; prove Web Worker support/fallback before introducing new runtime path |
| O11 | Full UI acceptance matrix and task-flow benchmarks | `docs/UX-STANDARD.md` | 30-second find/understand/act; keyboard/zoom, portrait/TV, unsaved edits, zero/stale/high-count cases |
| O12 | Connected-mobile read-only snapshot discipline | Existing `tests/sharepoint-mobile-html.test.cjs` | No edit actions, automatic sensitive-field boundary validation, source timestamp, correct version, no public distribution |
| O13 | Recovery UX and honest system health | Existing update/recovery and Files To Learn flows | One actionable explanation, verified status, no misleading success, safe manual recovery with original files intact |
| O14 | Developer-facing change impact map | Large `assets/app.js`; generated `src/` modules and update allowlist | Change map from source to generated file to tests/package; no unapproved runtime files or code drift |

## P2 — scalability and next-generation capability

| ID | Research target | Gate to start |
|---|---|---|
| S01 | Versioned dealership/department/role domain contracts | First prove current one-store metrics and source contract consistency |
| S02 | Tenant separation at local storage and optional aggregate boundary | Deny-by-default per-store tests for query, cache, export, backup, task and metrics |
| S03 | Secure coordinated multiuser workflows | Only after real authentication and transactional coordination are approved; do not assume OneDrive provides a lock |
| S04 | AI recommendation evaluation harness | Compare AI suggestion to verified rules and source evidence; approval classes, abstention and audit |
| S05 | Forecasting and what-if capacity scenarios | Calibrate against historical technician-hour availability and delayed-source uncertainty |
| S06 | Controlled parts / warranty / Express module expansion | Additional primary authoritative sources, owner, KPI definitions and source provenance validated first |
| S07 | Long-term archive and reporting-policy alignment | Verify retention requirements and separate active RO, reopened RO, CSI, KPI and manager action history |
| S08 | Repo and build-cost hygiene | 119 tracked `updates/` files occupy ~149 MB of current tree; evaluate safe immutable-release archival **without deleting** historically required versions or changing history |

## Research references

- Microsoft: incremental modernization and anti-corruption layer: https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig
- Microsoft: observability and performance targets: https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/observability
- NIST SSDF: https://csrc.nist.gov/pubs/sp/800/218/final
- NIST AI RMF Playbook: https://www.nist.gov/itl/ai-risk-management-framework/nist-ai-rmf-playbook
- GitHub Actions supply-chain protections and attestations: https://docs.github.com/en/actions/how-tos/secure-your-work
- OWASP access control and tenant isolation: https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html
- W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/
- MDN File System API + worker limits: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
- NADA dealership Fixed Operations management research: https://www.nada.org/nada/nada-headlines/how-do-i-fix-my-service-department
- Cox Automotive ownership study (speed, transparency and service communication): https://www.coxautoinc.com/retail/resources/ownership-study/

## Delivery rule

Do not enlarge this register with speculative features or duplicate the existing issue backlog. Choose one dependency-cleared, evidence-backed item at a time. A new research finding enters the implementation backlog only when its benefit, source, scope, acceptance and owner are explicit. Publication to **Beta** does not authorize Stable promotion or operational Workspace installation.
