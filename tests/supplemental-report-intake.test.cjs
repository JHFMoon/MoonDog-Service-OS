const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "assets", "app.js"), "utf8");

// Parse the browser bundle without executing it.
new vm.Script(app);

assert.match(app, /function supplementalPdfFamily\(/);
assert.match(app, /retail-rewards-core/);
assert.match(app, /retail-rewards-parts-loyalty/);
assert.match(app, /retail-rewards-maintenance/);
assert.match(app, /retail-rewards-bulk-oil/);
assert.match(app, /serviceview-parts-analysis/);
assert.match(app, /serviceview-ro-analysis/);
assert.match(app, /serviceview-retention-first-year/);
assert.match(app, /serviceview-retention/);
assert.match(app, /cx-nps/);
assert.match(app, /cx-response-rate/);
assert.match(app, /tireworks-usage-search/);
assert.match(app, /tireworks-usage-quotes/);
assert.match(app, /tireworks-sales-projection/);
assert.match(app, /controllable-ranking/);

assert.match(app, /function parseAppointmentsCreatedSummaryCsv\(/);
assert.match(app, /function parseCashClearingWorkbook\(/);
assert.match(app, /function parseCreditHoldsWorkbook\(/);
assert.match(app, /function parseEmptyKnownWorkbook\(/);
assert.match(app, /function parseSupplementalDocxReport\(/);
assert.match(app, /open-ro-browser-summary/);
assert.match(app, /media-asr-empty/);
assert.match(app, /efficiency-empty/);
assert.match(app, /service-daily-log-empty/);

assert.match(app, /supplementalReports:\s*\{\s*snapshots:\s*\{\}\s*\}/);
assert.match(app, /supplementalOnly:true,kpiPromotion:false/);
assert.match(app, /Recognized non-KPI reference document; excluded from KPI ingestion/);
assert.match(app, /parts-quality-alert/);
assert.match(app, /incident-claim/);
assert.match(app, /collision-estimate/);
assert.match(app, /technician-video-standard/);
assert.match(app, /customer-outreach-transcript/);
assert.match(app, /service-consulting-audit/);
assert.match(app, /cdk-repair-orders-docx-v1/);

console.log("PASS supplemental report families are recognized, isolated, and syntax-valid");
