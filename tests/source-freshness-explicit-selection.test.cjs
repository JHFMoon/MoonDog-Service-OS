"use strict";

// #59-01: execute the real sourceFreshness selector with synthetic retained data.
// An explicitly missing selected source must not inherit a different saved report.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  function sourceFreshness(");
const end = app.indexOf("  function metricDependencyEvidence(", start);
assert.ok(start >= 0 && end > start, "production sourceFreshness must exist");
const selector = app.slice(start, end);

const today = "2026-10-30";
const importedAt = "2026-10-30T16:00:00.000Z";
const periodStart = "2026-10-01";
const periodEnd = "2026-10-30";
const reference = {
  period: "2026-10", periodStart, periodEnd, importedAt,
  metrics: { responses: 0 }
};
const sources = {
  openRo: { reportDate: today, importedAt },
  sapr: { periodStart, periodEnd, importedAt },
  csi: { scopeVerified: true, scopeStart: periodStart, scopeEnd: periodEnd, importedAt },
  nextAppointments: { periodStart: today, periodEnd: today, importedAt },
  vir: { reportDate: today, observationTimestamp: importedAt, importedAt },
  menu: { releaseWeek: "2026-10-26", periodStart: "2026-10-26", periodEnd: today, importedAt },
  appointments: { date: today, importedAt },
  sor: reference,
  appointmentActivity: reference,
  efficiency: reference,
  mediaAsr: reference,
  mediaAsrTech: reference,
  openRoSummary: reference,
  supervisorWorkbook: { generatedAt: importedAt, stale: false }
};
const families = Object.keys(sources);

function harness() {
  const fallbackReads = [];
  const model = {
    state: { source: sources.openRo },
    operationalMetrics: { csi: { imports: [sources.csi] } },
    appointments: { days: { [today]: sources.appointments } },
    recovery: { supervisorWorkbook: sources.supervisorWorkbook }
  };
  const ctx = vm.createContext({
    freshness, model, Date, Intl,
    sourceExpectation: () => "recommended",
    businessTimeZone: () => "America/Los_Angeles",
    localDateKey: date => date ? date.toISOString().slice(0, 10) : today,
    lastDayOfMonth: freshness.lastDayOfMonth,
    currentSaprSnapshot: () => { fallbackReads.push("sapr"); return sources.sapr; },
    latestVirObservation: () => { fallbackReads.push("vir"); return sources.vir; },
    latestOperationalSnapshot: key => { fallbackReads.push(key); return sources[key]; },
    verifiedVirSourceObservationDate: item => item?.reportDate || "",
    validCoverageDate: value => freshness.validDateKey(value) ? value : "",
    csiReportedPeriod: (startDate, endDate, observed) => ({
      periodStart: startDate || observed || "",
      periodEnd: endDate || observed || "",
      verified: Boolean(endDate || observed)
    }),
    verifiedMenuTrendReleases: ({ retained }) => new Set(retained?.releaseWeek ? [retained.releaseWeek] : [])
  });
  vm.runInContext(selector + "\nthis.api = { sourceFreshness };", ctx);
  return { sourceFreshness: ctx.api.sourceFreshness, fallbackReads };
}

test("all report families respect explicit null/undefined even with a retained fallback", () => {
  const { sourceFreshness, fallbackReads } = harness();
  for (const family of families) {
    for (const missingItem of [null, undefined]) {
      const before = fallbackReads.length;
      const evidence = sourceFreshness(family, { item: missingItem, today });
      assert.equal(evidence.status, "missing", family);
      assert.equal(evidence.loaded, false, family);
      assert.equal(evidence.reportPeriodVerified, false, family);
      assert.equal(freshness.evaluateMetric([evidence]).verified, false, family);
      assert.equal(fallbackReads.length, before,
        family + " must not call a last-saved source selector for an explicit missing item");
    }
  }
});

test("omitting item still finds the retained source; explicit source preserves its lineage", () => {
  const { sourceFreshness } = harness();
  for (const family of families) {
    const automatic = sourceFreshness(family, { today });
    const explicitlySelected = sourceFreshness(family, { item: sources[family], today });
    assert.equal(automatic.loaded, true, family + " retained source is still accessible");
    for (const field of ["status", "loaded", "reportPeriodVerified", "importTimestamp",
      "periodStart", "periodEnd", "sourceTimestamp"]) {
      assert.equal(explicitlySelected[field], automatic[field],
        family + " selected source must retain " + field);
    }
    assert.notEqual(automatic.status, "missing", family);
  }
});
