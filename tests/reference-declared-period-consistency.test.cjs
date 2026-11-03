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
assert.ok(start >= 0 && end > start, "Actual production source-confidence selector must exist");
const selector = app.slice(start, end);
const families = ["sor", "appointmentActivity", "efficiency", "mediaAsr", "mediaAsrTech", "openRoSummary"];
const TODAY = "2026-10-30";

function evidence(key, item) {
  const before = JSON.stringify(item);
  const ctx = vm.createContext({
    model: {},
    freshness,
    sourceExpectation: () => "recommended",
    businessTimeZone: () => "America/Los_Angeles",
    localDateKey: () => TODAY,
    lastDayOfMonth: freshness.lastDayOfMonth
  });
  vm.runInContext(selector + "\nthis.productionSourceFreshness = sourceFreshness;", ctx);
  const result = ctx.productionSourceFreshness(key, {item, today: TODAY});
  assert.equal(JSON.stringify(item), before, key + " source confidence cannot mutate the retained input");
  return result;
}

test("all six reference families reject a declared September month paired with exclusively October coverage", () => {
  for (const key of families) {
    const result = evidence(key, {
      period: "2026-09", periodStart: "2026-10-01", periodEnd: "2026-10-29",
      importedAt: "2026-10-30T18:00:00.000Z", sourceFile: "synthetic-reference.xlsx"
    });
    assert.equal(result.status, "invalid", key);
    assert.equal(result.reportPeriodVerified, false, key);
    assert.equal(result.safeForPurpose, false, key);
    assert.equal(result.safeForCurrent, false, key);
    assert.match(result.reason, /inconsistent/i, key);
    assert.equal(freshness.evaluateMetric([result]).verified, false, key);
  }
});

test("all six reject a future month label entirely outside the actual dated snapshot", () => {
  for (const key of families) {
    const result = evidence(key, {
      period: "2026-11", periodStart: "2026-10-01", periodEnd: "2026-10-29",
      importedAt: "2026-10-30T18:00:00.000Z"
    });
    assert.equal(result.status, "invalid", key);
    assert.equal(result.reportPeriodVerified, false, key);
  }
});

test("all six reject explicit report-day labels outside their retained verified bounds", () => {
  for (const key of families) {
    for (const label of ["2026-10-20", "2026-10-30"]) {
      const result = evidence(key, {
        period: label, periodStart: "2026-10-21", periodEnd: "2026-10-29",
        importedAt: "2026-10-30T18:00:00.000Z"
      });
      assert.equal(result.status, "invalid", key + " " + label);
      assert.equal(result.reportPeriodVerified, false, key + " " + label);
    }
  }
});

test("in-range date label and overlapping cross-month cumulative scope remain historical-valid", () => {
  for (const key of families) {
    for (const record of [
      {period: "2026-10-22", periodStart: "2026-10-01", periodEnd: "2026-10-29"},
      {period: "2026-10", periodStart: "2026-09-25", periodEnd: "2026-10-15"},
      {period: "2026-10", periodStart: "2026-10-01", periodEnd: "2026-10-29"},
      {periodStart: "2026-10-01", periodEnd: "2026-10-29"},
      {periodEnd: "2026-10-29"}
    ]) {
      const result = evidence(key, record);
      assert.equal(result.status, "historical-valid", key + " " + JSON.stringify(record));
      assert.equal(result.reportPeriodVerified, true, key);
      assert.equal(result.safeForPurpose, true, key);
    }
  }
});

test("missing source, malformed dates and start-only sources remain blocked by prior guards", () => {
  for (const key of families) {
    assert.equal(evidence(key, null).status, "missing", key);
    for (const record of [
      {period: "2026-13", periodStart: "2026-10-01", periodEnd: "2026-10-29"},
      {period: "2026-10", periodStart: "2026-10-01", periodEnd: "2026-02-30"},
      {periodStart: "2026-10-01"}
    ]) {
      const result = evidence(key, record);
      assert.equal(result.status, "invalid", key + " " + JSON.stringify(record));
      assert.equal(result.reportPeriodVerified, false, key);
    }
  }
});
