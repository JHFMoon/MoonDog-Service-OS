"use strict";

// #59-01: exercise assets/freshness.js and the real assets/app.js source-confidence
// selector. All records and store dates are synthetic, never operational data.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const freshness = require("../assets/freshness.js");
const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  function sourceFreshness(");
const end = app.indexOf("  function metricDependencyEvidence(", start);
assert.ok(start >= 0 && end > start, "canonical production source-confidence selector exists");
const selector = app.slice(start, end);
const today = "2026-10-20"; // Tuesday; previous completed operating day is Monday.
const prior = "2026-10-19";
const sources = ["sapr", "nextAppointments"];

function evidenceFor(key, snapshot) {
  const before = JSON.stringify(snapshot);
  const model = {operationalMetrics: {}};
  const context = vm.createContext({
    model, freshness,
    sourceExpectation: () => "recommended",
    businessTimeZone: () => "America/Los_Angeles",
    localDateKey: () => today,
    currentSaprSnapshot: () => null,
    latestOperationalSnapshot: () => null
  });
  vm.runInContext(selector + "\nthis.checkSource = sourceFreshness;", context);
  const result = context.checkSource(key, {today, item: snapshot});
  assert.equal(JSON.stringify(snapshot), before, "source evaluation cannot mutate the original snapshot");
  return result;
}

test("end-only observation dated today cannot prove yesterday's reporting coverage", () => {
  for (const key of sources) for (const periodStart of [undefined, null, ""]) {
    const saved = {periodStart, periodEnd: today, importedAt: "2026-10-20T17:00:00Z"};
    const evidence = evidenceFor(key, saved);
    assert.equal(evidence.status, "stale", key);
    assert.equal(evidence.loaded, true, key);
    assert.equal(evidence.reportPeriodVerified, false, key);
    assert.equal(evidence.safeForCurrent, false, key);
    assert.equal(evidence.safeForPurpose, false, key);
    assert.match(evidence.reason, /no verified start date/, key);
    assert.match(evidence.reason, /cannot establish coverage/, key);
    assert.equal(freshness.evaluateMetric([evidence]).verified, false, key);
    const need = freshness.evaluateReportNeed({key, today, evidence});
    assert.notEqual(need.state, "CURRENT", key + " cannot promote a one-day observation to current coverage");
    const activeNeed = freshness.evaluateReportNeed({key, today, evidence, activeFeature: true});
    assert.equal(activeNeed.state, "NEED NOW", key + " active report planning must not hide missing coverage");
  }
});

test("end-only source observed on the exact prior operating day retains point-in-time freshness", () => {
  for (const key of sources) {
    const evidence = evidenceFor(key, {periodEnd: prior, importedAt: "2026-10-20T17:00:00Z"});
    assert.equal(evidence.status, "current", key);
    assert.equal(evidence.safeForCurrent, true, key);
    assert.equal(evidence.periodEnd, prior, key);
    assert.equal(evidence.reportPeriodVerified, false,
      key + " a single observation must never be promoted to a verified multi-day period");
    assert.match(evidence.reason, /observation is dated/, key);
  }
});

test("verified interval covering prior business date remains current, even if end date is today", () => {
  for (const key of sources) {
    const evidence = evidenceFor(key, {periodStart: "2026-10-01", periodEnd: today,
      importedAt: "2026-10-20T17:00:00Z"});
    assert.equal(evidence.status, "current", key);
    assert.equal(evidence.reportPeriodVerified, true, key);
    assert.equal(evidence.safeForCurrent, true, key);
  }
});

test("older, impossible, or conflicting end-only reports do not certify prior-day observations", () => {
  for (const key of sources) {
    const old = evidenceFor(key, {periodEnd: "2026-10-17"});
    assert.equal(old.status, "stale", key);
    assert.equal(old.safeForCurrent, false, key);
    for (const record of [
      {periodEnd: "2026-02-30"},
      {periodStart: "2026-10-20", periodEnd: prior},
      {periodStart: "2026-02-30", periodEnd: today}
    ]) {
      const invalid = evidenceFor(key, record);
      assert.equal(invalid.status, "invalid", key + JSON.stringify(record));
      assert.equal(invalid.safeForPurpose, false, key);
      assert.equal(invalid.reportPeriodVerified, false, key);
    }
    const missing = evidenceFor(key, null);
    assert.equal(missing.status, "missing", key);
  }
});

test("historical interval cannot be certified by a point observation only", () => {
  const source = freshness.evaluateSource({
    key: "sapr", exists: true, today, purpose: "historical",
    targetStart: "2026-10-17", targetEnd: prior,
    periodEnd: today
  });
  assert.equal(source.status, "stale");
  assert.equal(source.safeForPurpose, false);
});
