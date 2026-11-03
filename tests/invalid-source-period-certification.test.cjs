"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const csiBegin = app.indexOf("  function csiReportedPeriod(");
const csiEnd = app.indexOf("  function verifiedVirSourceObservationDate(", csiBegin);
const sourceBegin = app.indexOf("  function sourceFreshness(");
const sourceEnd = app.indexOf("  function metricDependencyEvidence(", sourceBegin);
assert.ok(csiBegin >= 0 && csiEnd > csiBegin && sourceBegin >= 0 && sourceEnd > sourceBegin,
  "Production CSI reporting period and canonical source-confidence adapter must exist");
const production = app.slice(csiBegin, csiEnd) + "\n" + app.slice(sourceBegin, sourceEnd);
const TODAY = "2026-11-02";

function inspect(key, item, expectation = "recommended") {
  const before = JSON.stringify(item);
  const model = {operationalMetrics: {csi: {imports: item ? [item] : []}}};
  const ctx = vm.createContext({
    model, freshness, Date,
    sourceExpectation: () => expectation,
    businessTimeZone: () => "America/Los_Angeles",
    localDateKey: () => TODAY,
    validCoverageDate: value => freshness.validDateKey(value) ? value : "",
    currentSaprSnapshot: () => null,
    latestOperationalSnapshot: () => null
  });
  vm.runInContext(production + "\nthis.inspect = sourceFreshness;", ctx);
  const result = ctx.inspect(key, {today: TODAY, item});
  assert.equal(JSON.stringify(item), before, "source confidence must not mutate the saved source");
  return result;
}

test("reversed and malformed verified CSI scope never certifies report-period coverage", () => {
  const invalid = [
    {scopeStart: "2026-10-31", scopeEnd: "2026-10-20"},
    {scopeStart: "2026-02-30", scopeEnd: "2026-10-31"},
    {scopeStart: "2026-10-01", scopeEnd: "2026-02-30"},
    {scopeStart: 20261001, scopeEnd: "2026-10-31"}
  ];
  for (const scope of invalid) {
    const item = {scopeVerified: true, ...scope, importedAt: "2026-11-02T15:00:00.000Z"};
    const evidence = inspect("csi", item);
    assert.equal(evidence.status, "invalid", JSON.stringify(scope));
    assert.equal(evidence.loaded, true);
    assert.equal(evidence.reportPeriodVerified, false,
      "invalid scope cannot claim verified source coverage " + JSON.stringify(scope));
    assert.equal(evidence.safeForCurrent, false);
    assert.equal(freshness.evaluateMetric([evidence]).verified, false);
  }
});

test("valid historical CSI coverage remains source-period verified, not falsely current", () => {
  const item = {scopeVerified: true, scopeStart: "2026-10-01", scopeEnd: "2026-10-20",
    importedAt: "2026-11-02T15:00:00.000Z"};
  const evidence = inspect("csi", item);
  assert.equal(evidence.status, "stale");
  assert.equal(evidence.reportPeriodVerified, true,
    "a genuine old period remains verified even if it cannot support current CSI");
  assert.equal(evidence.safeForCurrent, false);
});

test("not-used source cannot certify a report period merely because a dated snapshot remains", () => {
  const item = {periodStart: "2026-10-01", periodEnd: "2026-10-31",
    importedAt: "2026-11-02T15:00:00.000Z"};
  const notUsed = inspect("sapr", item, "not-used");
  assert.equal(notUsed.status, "not-used");
  assert.equal(notUsed.loaded, true);
  assert.equal(notUsed.reportPeriodVerified, false);
  assert.equal(notUsed.safeForPurpose, false);
  const active = inspect("sapr", item);
  assert.equal(active.status, "current");
  assert.equal(active.reportPeriodVerified, true,
    "a real valid active SAPR interval remains verified");
});

test("missing records remain unknown, never report-period verified", () => {
  for (const key of ["csi", "sapr"]) {
    const result = inspect(key, null);
    assert.equal(result.status, "missing");
    assert.equal(result.reportPeriodVerified, false);
  }
});
