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
assert.ok(start >= 0 && end > start, "Actual production source-confidence adapter must exist");
const realSourceFreshness = app.slice(start, end);
const TODAY = "2026-11-02";

function source(reportDate, importedAt = "2026-11-02T18:00:00.000Z") {
  return { reportDate, importedAt, fileName: "synthetic-open-ro.xlsx" };
}
function fixture(item) {
  const model = { state: { source: item } };
  const before = JSON.stringify(model);
  const context = vm.createContext({
    model,
    freshness,
    sourceExpectation: () => "recommended",
    businessTimeZone: () => "America/Los_Angeles",
    localDateKey: value => value instanceof Date ? value.toISOString().slice(0, 10) : TODAY
  });
  vm.runInContext(realSourceFreshness + "\nthis.actualSourceFreshness = sourceFreshness;", context);
  const evidence = context.actualSourceFreshness("openRo", { today: TODAY });
  assert.equal(JSON.stringify(model), before, "Confidence evaluation cannot mutate retained source");
  return evidence;
}

test("genuine current Open RO report date remains verified and usable", () => {
  const result = fixture(source(TODAY));
  assert.equal(result.status, "current");
  assert.equal(result.safeForCurrent, true);
  assert.equal(result.safeForPurpose, true);
  assert.equal(result.reportPeriodVerified, true);
  assert.equal(result.periodStart, TODAY);
  assert.equal(result.periodEnd, TODAY);
});

test("an older valid report stays stale despite a new import timestamp", () => {
  const result = fixture(source("2026-10-30"));
  assert.equal(result.status, "stale");
  assert.equal(result.safeForCurrent, false);
  assert.equal(result.reportPeriodVerified, true);
  assert.equal(result.importTimestamp, "2026-11-02T18:00:00.000Z");
});

test("impossible, malformed, non-string and future explicit source dates fail closed", () => {
  for (const reported of ["2026-02-30", "2026-11-2", "2026-11-03", "not-a-date", 20261102]) {
    const result = fixture(source(reported));
    assert.equal(result.status, "invalid", String(reported));
    assert.equal(result.safeForCurrent, false, String(reported));
    assert.equal(result.safeForPurpose, false, String(reported));
    assert.equal(result.reportPeriodVerified, false, String(reported));
    assert.match(result.reason, /invalid or future report date/, String(reported));
    const metric = freshness.evaluateMetric([result]);
    assert.equal(metric.verified, false, String(reported));
  }
});

test("undated legacy import retains recent-import fallback without claiming verified report coverage", () => {
  for (const reported of [null, undefined, ""]) {
    const result = fixture(source(reported));
    assert.equal(result.status, "current");
    assert.equal(result.safeForCurrent, true);
    assert.equal(result.reportPeriodVerified, false);
    assert.equal(result.importTimestamp, "2026-11-02T18:00:00.000Z");
    assert.equal(result.periodEnd, "");
  }
});

test("missing source stays missing and cannot invent report coverage", () => {
  const result = fixture(null);
  assert.equal(result.status, "missing");
  assert.equal(result.loaded, false);
  assert.equal(result.reportPeriodVerified, false);
  assert.equal(result.safeForCurrent, false);
});
