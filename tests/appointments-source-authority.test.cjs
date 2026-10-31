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
const adapter = app.slice(start, end);
const today = "2026-10-30";

function source(item, day = today) {
  const model = { appointments: { days: item ? { [day]: item } : {} } };
  const context = vm.createContext({
    freshness, model,
    localDateKey: () => day,
    businessTimeZone: () => "UTC",
    sourceExpectation: () => "recommended",
    lastDayOfMonth: freshness.lastDayOfMonth
  });
  vm.runInContext(adapter + "\nthis.sourceFreshness=sourceFreshness;", context);
  return context.sourceFreshness("appointments", { today: day });
}

test("validated imported appointment date remains current and lineage-verified", () => {
  const evidence = source({ date: today, importedAt: "2026-10-30T16:00:00Z", appointments: [] });
  assert.equal(evidence.status, "current");
  assert.equal(evidence.safeForCurrent, true);
  assert.equal(evidence.reportPeriodVerified, true);
  assert.equal(evidence.periodStart, today);
  assert.equal(evidence.periodEnd, today);
  assert.equal(evidence.importTimestamp, "2026-10-30T16:00:00Z");
});

test("recent import or manual update cannot create a missing appointment reporting period", () => {
  for (const item of [
    { importedAt: "2026-10-30T16:00:00Z", appointments: [] },
    { date: "", updatedAt: "2026-10-30T17:00:00Z", appointments: [] },
    { date: "2026-02-30", importedAt: "2026-10-30T16:00:00Z", appointments: [] }
  ]) {
    const evidence = source(item);
    assert.equal(evidence.status, "invalid");
    assert.equal(evidence.safeForCurrent, false);
    assert.equal(evidence.safeForPurpose, false);
    assert.equal(evidence.reportPeriodVerified, false);
    assert.match(evidence.reason, /no valid verified reporting date/i);
    assert.equal(freshness.evaluateMetric([evidence]).verified, false);
    const need = freshness.evaluateReportNeed({
      key: "appointments", today, evidence, arrivalPlanning: true
    });
    assert.equal(need.state, "NEED NOW", "active arrivals need source correction, not fabricated CURRENT");
    assert.equal(need.actionable, true);
  }
});

test("verified older appointment date is stale rather than silently relabeled today", () => {
  const evidence = source({ date: "2026-10-29", importedAt: "2026-10-30T16:00:00Z" });
  assert.equal(evidence.status, "stale");
  assert.equal(evidence.reportPeriodVerified, true);
  assert.equal(evidence.periodEnd, "2026-10-29");
  assert.equal(evidence.safeForCurrent, false);
});

test("absent appointment snapshot stays missing, not a verified zero", () => {
  const evidence = source(null);
  assert.equal(evidence.status, "missing");
  assert.equal(evidence.safeForCurrent, false);
  assert.equal(evidence.reportPeriodVerified, false);
  assert.equal(freshness.evaluateMetric([evidence]).verified, false);
});
