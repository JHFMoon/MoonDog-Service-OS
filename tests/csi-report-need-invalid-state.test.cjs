"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");
const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");

function productionSlice(start, stop) {
  const i = app.indexOf(start), j = app.indexOf(stop, i + start.length);
  assert.ok(i >= 0 && j > i, "Production function missing: " + start);
  return app.slice(i, j);
}
const dateValidator = productionSlice("  function validCoverageDate(", "  function coverageTimestamp(");
const csiPeriod = productionSlice("  function csiReportedPeriod(", "  function sourceFreshness(");
const sourceAdapter = productionSlice("  function sourceFreshness(", "  function metricDependencyEvidence(");
const reportNeed = productionSlice("  function reportNeeds(", "  function latestSupplementalFamily(");
const today = "2026-10-20"; // Tuesday, when a missing or invalid current source is actionable.

function fixture(importRecord, lastSuccessfulRefreshDate = today, reportDue = false) {
  const model = {
    state: { source: null }, appointments: { days: {} }, recovery: {},
    settings: { meeting: { dayOfWeek: 9, startTime: "06:30" }, csiPeriodStart: "2026-10-01" },
    operationalMetrics: { csi: {
      imports: importRecord ? [importRecord] : [],
      lastSuccessfulRefreshDate
    } }
  };
  const context = vm.createContext({
    freshness, model, Date, Intl,
    trendCoverageAudit: () => ({}),
    document: { querySelector: () => ({ id: "view-home" }) },
    ui: { performanceMetric: { value: "" } },
    localDateKey: () => today, businessTimeZone: () => "America/Los_Angeles",
    sourceExpectation: () => "recommended",
    currentSaprSnapshot: () => null,
    latestOperationalSnapshot: () => null,
    latestVirObservation: () => null,
    virObservationDate: () => "",
    lastDayOfMonth: freshness.lastDayOfMonth,
    dailyEvidenceDate: () => "",
    activeWorkloadSnapshot: () => null,
    reportCadenceDue: () => reportDue
  });
  vm.runInContext(dateValidator + "\n" + csiPeriod + "\n" + sourceAdapter + "\n" +
    reportNeed + "\nthis.sourceHealth = sourceFreshness; this.reportNeeds = reportNeeds;", context);
  return { health: context.sourceHealth("csi", { today }), need: context.reportNeeds(today).csi };
}

test("invalid saved verified CSI scope remains actionable despite successful import today", () => {
  for (const end of [undefined, null, "", "2026-02-30"]) {
    const item = {
      scopeVerified: true, scopeStart: "2026-10-01",
      reportObservationVerified: true, reportObservationDate: "2026-10-19",
      importedAt: "2026-10-20T15:00:00Z", rows: 0
    };
    if (end !== undefined) item.scopeEnd = end;
    const result = fixture(item);
    assert.equal(result.health.status, "invalid", "scopeEnd " + String(end));
    assert.equal(result.need.state, "NEED NOW",
      "same-day import cannot suppress known invalid CSI coverage " + String(end));
    assert.equal(result.need.actionable, true);
    assert.ok(result.need.actions.length > 0);
    assert.match(result.need.reason, /invalid/i);
  }
});

test("invalid CSI remains actionable when report cadence is not yet due", () => {
  const item = {
    scopeVerified: true, scopeStart: "2026-10-20", scopeEnd: "2026-10-19",
    importedAt: "2026-10-19T15:00:00Z"
  };
  const result = fixture(item, "2026-10-19", false);
  assert.equal(result.health.status, "invalid");
  assert.equal(result.need.state, "NEED NOW");
  assert.equal(result.need.actionable, true,
    "the not-yet-due release rule cannot suppress explicitly invalid evidence");
});

test("valid same-day verified zero-response CSI retains RECEIVED behavior", () => {
  const result = fixture({
    scopeVerified: true, scopeStart: "2026-10-01", scopeEnd: "2026-10-19",
    importedAt: "2026-10-20T15:00:00Z", rows: 0
  });
  assert.equal(result.health.status, "current");
  assert.equal(result.need.state, "RECEIVED");
  assert.equal(result.need.actionable, false);
});

test("observation-only CSI and valid stale CSI keep existing reporting cadence rules", () => {
  const observation = fixture({
    scopeVerified: false,
    reportObservationVerified: true, reportObservationDate: "2026-10-19",
    importedAt: "2026-10-20T15:00:00Z"
  });
  assert.equal(observation.health.status, "current");
  assert.equal(observation.need.state, "RECEIVED");
  const stale = fixture({
    scopeVerified: true, scopeStart: "2026-10-01", scopeEnd: "2026-10-15",
    importedAt: "2026-10-16T15:00:00Z"
  }, "2026-10-16", false);
  assert.equal(stale.health.status, "stale");
  assert.equal(stale.need.state, "AWAITING RELEASE",
    "ordinary stale data still follows an unconfirmed publication schedule");
});
