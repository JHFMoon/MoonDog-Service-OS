"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  function verifiedVirSourceObservationDate(");
const end = app.indexOf("  function metricDependencyEvidence(", start);
assert.ok(start >= 0 && end > start, "Actual production VIR source-authority selector must exist");
const production = app.slice(start, end);
assert.match(production, /if \(key === "vir"\).*verifiedVirSourceObservationDate\(item\)/,
  "The actual VIR freshness path must use validated source observation authority");
const TODAY = "2026-11-02";
const dateKey = date => date.toISOString().slice(0, 10);

function source(item, overrides = {}) {
  const ctx = vm.createContext({
    freshness,
    localDateKey: date => date ? dateKey(date) : TODAY,
    businessTimeZone: () => "America/Los_Angeles",
    sourceExpectation: () => "recommended",
    latestVirObservation: () => item,
    model: {},
    validCoverageDate: value => freshness.validDateKey(value) ? value : "",
  });
  vm.runInContext(production + "\nthis.evaluate=sourceFreshness;this.sourceDate=verifiedVirSourceObservationDate;", ctx);
  const before = JSON.stringify(item);
  const evidence = ctx.evaluate("vir", {today: TODAY, item, ...overrides});
  assert.equal(JSON.stringify(item), before, "Read-only source confidence must not mutate persisted data");
  return {evidence, date: ctx.sourceDate(item)};
}

test("a same-day local import alone cannot establish current VIR report coverage", () => {
  const {evidence, date} = source({
    importedAt: "2026-11-02T22:14:00.000Z",
    validation: {parser: "legacy-vir"}
  });
  assert.equal(date, "");
  assert.equal(evidence.safeForCurrent, false);
  assert.equal(evidence.reportPeriodVerified, false);
  assert.equal(evidence.status, "invalid");
  assert.match(evidence.reason, /import timestamp|verified source/i);
});

test("a newly imported historical VIR observation remains stale", () => {
  const {evidence, date} = source({
    importedAt: "2026-11-02T22:00:00.000Z",
    observationTimestamp: "2026-10-20T12:00:00-07:00",
    sourceModifiedAt: "2026-10-20T12:00:00-07:00"
  });
  assert.equal(date, "2026-10-20");
  assert.equal(evidence.status, "stale");
  assert.equal(evidence.safeForCurrent, false);
  assert.equal(evidence.reportPeriodVerified, true);
});

test("source-supplied point observation is current despite prior local import time", () => {
  const {evidence, date} = source({
    importedAt: "2026-10-20T19:00:00.000Z",
    observationTimestamp: "2026-11-02T12:00:00-08:00",
    sourceModifiedAt: "2026-10-19T20:00:00.000Z"
  });
  assert.equal(date, TODAY);
  assert.equal(evidence.status, "current");
  assert.equal(evidence.safeForCurrent, true);
  assert.equal(evidence.reportPeriodVerified, true);
});

test("explicit VIR report date remains the source authority over import and file metadata", () => {
  const {evidence, date} = source({
    reportDate: "2026-10-20",
    importedAt: "2026-11-02T22:00:00.000Z",
    observationTimestamp: "2026-11-02T12:00:00-08:00"
  });
  assert.equal(date, "2026-10-20");
  assert.equal(evidence.status, "stale");
  assert.equal(evidence.safeForCurrent, false);
  assert.equal(evidence.reportPeriodVerified, true);
});

test("a verified explicit date is usable for old retained source without observation timestamp", () => {
  const {evidence, date} = source({
    reportDate: "2026-11-02",
    importedAt: "2026-11-02T20:00:00.000Z"
  });
  assert.equal(date, TODAY);
  assert.equal(evidence.safeForCurrent, true);
  assert.equal(evidence.reportPeriodVerified, true);
});

test("valid ISO file-modified source observation remains compatible without report date", () => {
  const {evidence, date} = source({
    sourceModifiedAt: "2026-11-02T13:00:00-08:00",
    importedAt: "2026-11-02T20:15:00.000Z"
  });
  assert.equal(date, TODAY);
  assert.equal(evidence.safeForCurrent, true);
  assert.equal(evidence.reportPeriodVerified, true);
});

test("malformed, impossible and empty observation provenance must not borrow import date", () => {
  for (const item of [
    {observationTimestamp: "2026-02-30T12:00:00Z"},
    {observationTimestamp: "2026-11-02"},
    {observationTimestamp: "not-a-date", sourceModifiedAt: "2026-11-02T20:00:00Z"},
    {sourceModifiedAt: "2026-13-02T12:00:00Z"},
    {reportDate: "2026-02-30", observationTimestamp: "2026-11-02T12:00:00Z"},
    {reportDate: "malformed", observationTimestamp: "2026-11-02T12:00:00Z"},
    {sourceModifiedAt: null, observationTimestamp: "", reportDate: ""}
  ]) {
    const {evidence, date} = source({...item, importedAt: "2026-11-02T22:00:00.000Z"});
    assert.equal(date, "");
    assert.equal(evidence.safeForCurrent, false);
    assert.equal(evidence.reportPeriodVerified, false);
    assert.equal(evidence.status, "invalid");
  }
});

test("missing source does not become a verified report", () => {
  const {evidence, date} = source(null);
  assert.equal(date, "");
  assert.equal(evidence.safeForCurrent, false);
  assert.equal(evidence.reportPeriodVerified, false);
  assert.equal(evidence.status, "missing");
});
