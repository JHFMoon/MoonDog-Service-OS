"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const begin = app.indexOf("  function sourceFreshness(");
const end = app.indexOf("  function metricDependencyEvidence(", begin);
assert.ok(begin >= 0 && end > begin, "Production source-confidence selector required");
const sourceSelector = app.slice(begin, end);
const SOURCES = ["sapr", "nextAppointments"];
const TODAY = "2026-11-02";

function source(key, snapshot) {
  const model = {operationalMetrics: {}};
  const before = JSON.stringify(snapshot);
  const context = vm.createContext({
    model, freshness,
    businessTimeZone: () => "America/Los_Angeles",
    localDateKey: () => TODAY,
    sourceExpectation: () => "recommended",
    currentSaprSnapshot: () => null,
    latestOperationalSnapshot: () => null
  });
  vm.runInContext(sourceSelector + "\nthis.liveSourceConfidence = sourceFreshness;", context);
  const result = context.liveSourceConfidence(key, {today: TODAY, item: snapshot});
  assert.equal(JSON.stringify(snapshot), before, key + " source evaluation must be read-only");
  return result;
}

test("both production sources accept a valid complete interval covering the prior operating day", () => {
  for (const key of SOURCES) {
    const record = {periodStart: "2026-10-01", periodEnd: "2026-10-31", importedAt: "2026-11-02T16:30:00.000Z"};
    const evidence = source(key, record);
    assert.equal(evidence.status, "current", key);
    assert.equal(evidence.safeForCurrent, true, key);
    assert.equal(evidence.reportPeriodVerified, true, key);
    assert.equal(evidence.periodEnd, "2026-10-31", key);
  }
});

test("both production sources preserve a valid stale interval as dated but not current", () => {
  for (const key of SOURCES) {
    const evidence = source(key, {periodStart: "2026-10-01", periodEnd: "2026-10-20"});
    assert.equal(evidence.status, "stale", key);
    assert.equal(evidence.safeForCurrent, false, key);
    assert.equal(evidence.reportPeriodVerified, true, key);
  }
});

test("impossible, reversed and non-string bounds cannot claim verified source periods", () => {
  const invalid = [
    {periodStart: "2026-02-30", periodEnd: "2026-10-31"},
    {periodStart: "2026-10-31", periodEnd: "2026-10-01"},
    {periodStart: "2026-10-01", periodEnd: "2026-02-30"},
    {periodStart: 20261001, periodEnd: "2026-10-31"}
  ];
  for (const key of SOURCES) for (const record of invalid) {
    const evidence = source(key, record);
    assert.equal(evidence.status, "invalid", key + " " + JSON.stringify(record));
    assert.equal(evidence.reportPeriodVerified, false, key);
    assert.equal(evidence.safeForPurpose, false, key);
    assert.equal(freshness.evaluateMetric([evidence]).verified, false, key);
  }
});

test("incomplete source intervals are not certified even when an end observation is usable", () => {
  for (const key of SOURCES) {
    const datedEnd = source(key, {periodEnd: "2026-10-31", importedAt: "2026-11-02T16:30:00.000Z"});
    assert.equal(datedEnd.reportPeriodVerified, false, key);
    assert.equal(datedEnd.periodEnd, "2026-10-31", key);
    const empty = source(key, {periodStart: "", periodEnd: ""});
    assert.equal(empty.reportPeriodVerified, false, key);
  }
});

test("missing source remains missing and cannot inherit another import's verification", () => {
  for (const key of SOURCES) {
    const evidence = source(key, null);
    assert.equal(evidence.status, "missing", key);
    assert.equal(evidence.reportPeriodVerified, false, key);
    assert.equal(evidence.safeForCurrent, false, key);
  }
});
