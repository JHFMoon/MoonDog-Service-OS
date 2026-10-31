"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function productionSlice(start, stop, label) {
  const i = app.indexOf(start), j = app.indexOf(stop, i + start.length);
  assert.ok(i >= 0 && j > i, "Missing production " + label);
  return app.slice(i, j);
}
const validatedDate = productionSlice("  function validCoverageDate(", "  function coverageTimestamp(", "report date validator");
const sourcePeriod = productionSlice("  function csiReportedPeriod(", "  function sourceFreshness(", "CSI period selector");
const adapter = productionSlice("  function sourceFreshness(", "  function metricDependencyEvidence(", "source freshness adapter");

function evaluate(item) {
  const today = "2026-10-07";
  const context = vm.createContext({
    freshness,
    model: {operationalMetrics: {csi: {imports: item ? [item] : []}}},
    sourceExpectation: () => "recommended",
    businessTimeZone: () => "America/Los_Angeles",
    localDateKey: () => today
  });
  vm.runInContext(validatedDate + sourcePeriod + adapter +
    "\nthis.readCsi = sourceFreshness;", context);
  return context.readCsi("csi", {today});
}

test("production CSI source adapter preserves invalid explicit scope-start detection", () => {
  const evidence = evaluate({
    scopeVerified: true, scopeStart: "2026-02-30", scopeEnd: "2026-10-06",
    importedAt: "2026-10-07T15:00:00Z"
  });
  assert.equal(evidence.status, "invalid");
  assert.equal(evidence.safeForPurpose, false);
  assert.equal(evidence.safeForCurrent, false);
  assert.equal(freshness.evaluateMetric([evidence]).verified, false);
});

test("invalid verified scope-end cannot become current from a separate observation date", () => {
  const evidence = evaluate({
    scopeVerified: true, scopeStart: "2026-10-01", scopeEnd: "2026-02-30",
    reportObservationVerified: true, reportObservationDate: "2026-10-06"
  });
  assert.equal(evidence.status, "invalid");
  assert.equal(evidence.safeForPurpose, false);
});

test("reversed declared CSI coverage fails closed in the production adapter", () => {
  const evidence = evaluate({
    scopeVerified: true, scopeStart: "2026-10-07", scopeEnd: "2026-10-06"
  });
  assert.equal(evidence.status, "invalid");
});

test("valid declared zero-response CSI period remains current", () => {
  const evidence = evaluate({
    scopeVerified: true, scopeStart: "2026-10-01", scopeEnd: "2026-10-06",
    rows: 0
  });
  assert.equal(evidence.status, "current");
  assert.equal(evidence.safeForCurrent, true);
  assert.equal(evidence.periodStart, "2026-10-01");
  assert.equal(evidence.periodEnd, "2026-10-06");
});

test("valid legacy end-only verified CSI scope remains current", () => {
  const evidence = evaluate({scopeVerified: true, scopeEnd: "2026-10-06"});
  assert.equal(evidence.status, "current");
  assert.equal(evidence.periodStart, "");
  assert.equal(evidence.periodEnd, "2026-10-06");
});

test("verified observation remains usable when scope verification was not claimed", () => {
  const evidence = evaluate({
    scopeVerified: false,
    reportObservationVerified: true, reportObservationDate: "2026-10-06"
  });
  assert.equal(evidence.status, "current");
  assert.equal(evidence.periodEnd, "2026-10-06");
  assert.equal(evidence.safeForCurrent, true);
});

test("missing CSI import stays missing", () => {
  assert.equal(evaluate(null).status, "missing");
});
