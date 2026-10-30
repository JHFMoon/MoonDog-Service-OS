"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  function sourceFreshness(");
const end = app.indexOf("  function metricDependencyEvidence(", start);
assert.ok(start >= 0 && end > start, "production source-confidence adapter exists");

const families = ["sor", "appointmentActivity", "efficiency", "mediaAsr", "mediaAsrTech", "openRoSummary"];
function sourceEvidence(key, item) {
  const context = vm.createContext({
    freshness,
    model: {},
    sourceExpectation: () => "recommended",
    businessTimeZone: () => "UTC",
    localDateKey: () => "2026-10-30",
    lastDayOfMonth: freshness.lastDayOfMonth
  });
  vm.runInContext(app.slice(start, end) + ";this.sourceFreshness = sourceFreshness;", context);
  return context.sourceFreshness(key, { item, today: "2026-10-30" });
}

test("all six production reference adapters block undated import-time-only data", () => {
  for (const key of families) {
    const evidence = sourceEvidence(key, {
      importedAt: "2026-10-30T17:00:00Z",
      sourceFile: "synthetic-reference-report.xlsx"
    });
    assert.equal(evidence.status, "invalid", key);
    assert.equal(evidence.safeForCurrent, false, key);
    assert.equal(evidence.safeForPurpose, false, key);
    assert.equal(evidence.reportPeriodVerified, false, key);
    assert.match(evidence.reason, /no verified reporting period/i, key);
    const metric = freshness.evaluateMetric([evidence]);
    assert.equal(metric.verified, false, key);
    assert.strictEqual(metric.blocking[0], evidence, key);
  }
});

test("verified dates, month boundaries and invalid stated periods remain distinct", () => {
  for (const key of families) {
    const dated = sourceEvidence(key, {
      importedAt: "2026-10-30T17:00:00Z",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-29"
    });
    assert.equal(dated.status, "historical-valid", key);
    assert.equal(dated.safeForPurpose, true, key);
    assert.equal(dated.reportPeriodVerified, true, key);
    assert.equal(dated.periodEnd, "2026-10-29", key);

    const month = sourceEvidence(key, {period: "2026-09", importedAt: "2026-10-30T17:00:00Z"});
    assert.equal(month.status, "historical-valid", key);
    assert.equal(month.periodEnd, "2026-09-30", key);
    assert.equal(month.reportPeriodVerified, true, key);

    const malformed = sourceEvidence(key, {period: "2026-02-30", importedAt: "2026-10-30T17:00:00Z"});
    assert.equal(malformed.status, "invalid", key);
    assert.equal(malformed.safeForPurpose, false, key);
  }
});
