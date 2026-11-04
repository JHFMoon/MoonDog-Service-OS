"use strict";

// #59-01: production Home report-readiness shortcuts must not hide source
// integrity failures or manufacture verified source currentness.
// All fixtures are synthetic; no real Workspace or customer files are used.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  function reportNeeds(");
const end = app.indexOf("  function latestSupplementalFamily(", start);
assert.ok(start >= 0 && end > start, "actual Home report-readiness function exists");
const production = app.slice(start, end);

function readNeeds(today, overrides = {}, options = {}) {
  const evidenceByKey = Object.fromEntries(Object.entries(overrides).map(([key, item]) =>
    [key, Object.freeze({...item, key, label: item.label || key})]));
  const before = JSON.stringify(evidenceByKey);
  const model = {
    operationalMetrics: {
      csi: {lastSuccessfulRefreshDate: options.csiSavedToday === false ? "" : today, imports: [{}]}
    },
    settings: {meeting: {dayOfWeek: 9, startTime: "06:30"}, csiPeriodStart: ""}
  };
  const context = vm.createContext({
    freshness,
    model,
    Date,
    document: {querySelector: () => ({id: "view-overview"})},
    ui: {performanceMetric: {value: ""}},
    reportReviewView: "overview",
    trendCoverageAudit: () => ({}),
    sourceFreshness: key => evidenceByKey[key] || Object.freeze({
      key, label: key, status: "missing", loaded: false,
      safeForPurpose: false, safeForCurrent: false
    }),
    latestOperationalSnapshot: () => null,
    sourceExpectation: () => "recommended",
    businessTimeZone: () => "America/Los_Angeles",
    reportCadenceDue: () => false,
    dailyEvidenceDate: () => "",
    activeWorkloadSnapshot: () => null,
    validCoverageDate: () => "",
    localDateKey: () => today
  });
  vm.runInContext(production + "\nthis.inspectNeeds = reportNeeds;", context);
  const output = context.inspectNeeds(today);
  assert.equal(JSON.stringify(evidenceByKey), before,
    "production report readiness must never mutate retained source evidence");
  return output;
}

function evidence(status, loaded = true) {
  return {
    status, loaded, safeForCurrent: status === "current",
    safeForPurpose: status === "current" || status === "historical-valid",
    reason: "Synthetic source authority"
  };
}

test("saved-today CSI shortcut does not hide explicit integrity defects", () => {
  for (const status of ["invalid", "conflicting", "unsupported", "unverified", "unknown", "", "pending"]) {
    const result = readNeeds("2026-11-04", {csi: evidence(status)});
    assert.equal(result.csi.state, "NEED NOW", String(status));
    assert.equal(result.csi.actionable, true, String(status));
    assert.notEqual(result.csi.state, "RECEIVED", String(status));
  }
});

test("valid saved-today CSI source still avoids a redundant same-day pull", () => {
  for (const status of ["current", "stale", "historical-valid"]) {
    const result = readNeeds("2026-11-04", {csi: evidence(status)});
    assert.equal(result.csi.state, "RECEIVED", status);
    assert.equal(result.csi.actionable, false, status);
    assert.match(result.csi.reason, /scope not independently verified/, status);
  }
  const absent = readNeeds("2026-11-04", {csi: evidence("missing", false)});
  assert.notEqual(absent.csi.state, "RECEIVED", "absent source must not masquerade as a saved source");
  const notToday = readNeeds("2026-11-04", {csi: evidence("stale")}, {csiSavedToday: false});
  assert.notEqual(notToday.csi.state, "RECEIVED", "an older saved import cannot claim today's receipt");
});

test("required SAPR conflicts remain actionable even before its normal report cadence", () => {
  for (const status of ["invalid", "conflicting", "unsupported", "unverified", "unknown", "pending"]) {
    const result = readNeeds("2026-11-04", {sapr: evidence(status)});
    assert.equal(result.sapr.state, "NEED NOW", status);
    assert.equal(result.sapr.actionable, true, status);
  }
  for (const status of ["missing", "stale"]) {
    const result = readNeeds("2026-11-04", {sapr: evidence(status, status !== "missing")});
    assert.equal(result.sapr.state, "AWAITING RELEASE", status);
    assert.equal(result.sapr.actionable, false, status);
  }
});

test("Monday Menu cadence cannot defer a conflicting or unverified source", () => {
  // 2026-11-02 is Monday, before any new Monday release has been verified.
  for (const status of ["invalid", "conflicting", "unsupported", "unverified", "unknown", "pending"]) {
    const result = readNeeds("2026-11-02", {menu: evidence(status)});
    assert.equal(result.menu.state, "NEED NOW", status);
    assert.equal(result.menu.actionable, true, status);
  }
  for (const status of ["missing", "stale"]) {
    const result = readNeeds("2026-11-02", {menu: evidence(status, status !== "missing")});
    assert.equal(result.menu.state, "AWAITING RELEASE", status);
    assert.equal(result.menu.actionable, false, status);
  }
});
