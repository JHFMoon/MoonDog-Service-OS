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
assert.ok(begin >= 0 && end > begin, "execute the actual production sourceFreshness selector");
const productionSelector = app.slice(begin, end);

const today = "2026-10-30";
const importedAt = "2026-10-29T19:30:00.000Z";
const retained = Object.freeze({
  importedAt, period: "2026-10", periodStart: "2026-10-01", periodEnd: "2026-10-29",
  reportDate: "2026-10-29", observationTimestamp: "2026-10-29T17:30:00.000Z",
  sourceModifiedAt: "2026-10-29T17:30:00.000Z",
  scopeVerified: true, scopeStart: "2026-10-01", scopeEnd: "2026-10-29",
  reportObservationVerified: true, reportObservationDate: "2026-10-29",
  releaseWeek: "2026-10-26", date: today,
  generatedAt: "2026-10-29T17:30:00.000Z"
});
const families = Object.freeze([
  "openRo", "sapr", "csi", "nextAppointments", "vir", "menu",
  "appointments", "supervisorWorkbook",
  "sor", "appointmentActivity", "efficiency", "mediaAsr", "mediaAsrTech", "openRoSummary"
]);

function harness() {
  const model = {
    state: { source: retained },
    operationalMetrics: { csi: { imports: [retained] } },
    appointments: { days: { [today]: retained } },
    recovery: { supervisorWorkbook: retained }
  };
  const context = vm.createContext({
    freshness, model, Date,
    sourceExpectation: () => "recommended",
    businessTimeZone: () => "America/Los_Angeles",
    localDateKey: () => today,
    lastDayOfMonth: freshness.lastDayOfMonth,
    currentSaprSnapshot: () => retained,
    latestOperationalSnapshot: () => retained,
    latestVirObservation: () => retained,
    verifiedVirSourceObservationDate: item => item?.reportDate || "",
    validCoverageDate: date => freshness.validDateKey(date) ? date : "",
    csiReportedPeriod: (start, end, observed) => ({
      periodStart: start || observed || "",
      periodEnd: end || observed || "",
      verified: Boolean(end || observed)
    }),
    verifiedMenuTrendReleases: () => new Set([retained.releaseWeek])
  });
  vm.runInContext(productionSelector + "\nthis.sourceFreshness = sourceFreshness;", context);
  return context.sourceFreshness;
}

test("an explicitly absent selected source never borrows any of the 14 families' retained data", () => {
  const sourceFreshness = harness();
  for (const key of families) {
    for (const item of [null, undefined]) {
      const actual = sourceFreshness(key, { item, today });
      assert.equal(actual.status, "missing", key + " must remain missing");
      assert.equal(actual.loaded, false, key + " must not use retained source");
      assert.equal(actual.reportPeriodVerified, false, key + " must not certify borrowed coverage");
      assert.equal(actual.importTimestamp, "", key + " must not borrow import provenance");
      assert.equal(freshness.evaluateMetric([actual]).verified, false, key + " unknown must not become zero");
    }
  }
});

test("omitting item retains the normal automatic source lookup for every family", () => {
  const sourceFreshness = harness();
  for (const key of families) {
    const actual = sourceFreshness(key, { today });
    assert.notEqual(actual.status, "missing", key + " default source must still be considered");
    assert.equal(actual.loaded, true, key + " default source must still be available");
    assert.equal(actual.importTimestamp, importedAt, key + " keeps its source import provenance");
  }
});

test("an explicitly selected report uses its own provenance instead of a different retained report", () => {
  const sourceFreshness = harness();
  const selected = {
    ...retained,
    importedAt: "2026-10-28T19:30:00.000Z",
    periodEnd: "2026-10-28", reportDate: "2026-10-28",
    observationTimestamp: "2026-10-28T17:30:00.000Z",
    sourceModifiedAt: "2026-10-28T17:30:00.000Z",
    scopeEnd: "2026-10-28", reportObservationDate: "2026-10-28",
    generatedAt: "2026-10-28T17:30:00.000Z"
  };
  for (const key of families) {
    const actual = sourceFreshness(key, { item: selected, today });
    assert.equal(actual.loaded, true, key + " selected report must be loaded");
    assert.equal(actual.importTimestamp, selected.importedAt, key + " must use only the selected report's import time");
    assert.notEqual(actual.importTimestamp, importedAt, key + " must not borrow a retained report's import time");
  }
});
