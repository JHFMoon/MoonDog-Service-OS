"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const shipped = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function code(start, end, label) {
  const a = shipped.indexOf(start), b = shipped.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "Actual production " + label + " must be present");
  return shipped.slice(a, b);
}
const selector = code("  function latestNextAppointmentsSnapshot(",
  "  function effectiveOperationalCoverageDate(", "Next Appointments selector");
const renderer = code("  function renderOverviewIntelligence() {",
  "  const renderOverviewIntelligenceBase=renderOverviewIntelligence;", "Home renderer");

function node() {
  return { textContent: "", className: "", children: [],
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = [...items]; }
  };
}
function flatten(n) {
  return [String(n?.textContent ?? ""), ...(n?.children || []).map(flatten)].join(" ");
}
function source(rate, extra = {}) {
  return {
    periodStart: "2026-11-01", periodEnd: "2026-11-02",
    observationDate: "2026-11-02", importedAt: "2026-11-02T18:00:00Z",
    validation: { parser: "next-appointments-scheduled-v1" },
    identityConflicts: [],
    summary: { successRate: rate, scheduled: 0, opportunities: 0, existingAppointments: 0 },
    ...extra
  };
}
function home(item) {
  const ui = Object.fromEntries([
    "moondogNeeds", "nextAppointmentsSummary", "nextAppointmentsCoverage",
    "virSummary", "virCoverage", "menuSummary", "menuCoverage",
    "csiSummary", "csiCoverage"
  ].map(name => [name, node()]));
  const model = { settings: { csiPeriodStart: "2026-11-01" }, operationalMetrics: {
    nextAppointments: { snapshots: item ? { "2026-11-02": item } : {} },
    menu: { snapshots: {} },
    csi: { surveys: {} }
  } };
  const ctx = vm.createContext({
    model, ui, document: { createElement: () => node() },
    text: x => String(x ?? ""),
    localDateKey: () => "2026-11-02",
    previousOperatingDateKey: () => "2026-11-01",
    latestVirObservation: () => null,
    renderAdminCloseoutAttention: () => {},
    renderTrendCoverageSummary: () => {},
    renderPreviousMonthTotals: () => {},
    managerAttentionRequests: () => [],
    trendCoverageAudit: () => ({}),
    currentCsiSurveys: () => ({}),
    latestCsiRefreshDate: () => "",
    npsSummary: () => ({ responses: 0 }),
    reportNeeds: () => ({}),
    sourceFreshness: () => ({ safeForCurrent: true }),
    sourceLineageLabel: () => "",
    standard: () => NaN,
    performanceFormat: x => String(x),
    shortDate: x => String(x || "—")
  });
  vm.runInContext(selector + "\n" + renderer +
    "\nthis.renderActualHome=renderOverviewIntelligence;", ctx);
  assert.doesNotThrow(() => ctx.renderActualHome());
  return { summary: flatten(ui.nextAppointmentsSummary), coverage: ui.nextAppointmentsCoverage.textContent };
}

test("verified numeric zero is preserved rather than hidden or fabricated", () => {
  const report = source(0);
  const previous = JSON.stringify(report);
  const result = home(report);
  assert.match(result.summary, /Success\s+0\.00%/);
  assert.match(result.summary, /Scheduled\s+0/);
  assert.match(result.summary, /Opportunities\s+0/);
  assert.equal(JSON.stringify(report), previous, "Home may not rewrite imported source");
});

test("valid positive rate and counts remain formatted consistently", () => {
  const result = home(source(67.5, { summary: {
    successRate: 67.5, scheduled: 27, opportunities: 40, existingAppointments: 8
  } }));
  assert.match(result.summary, /Success\s+67\.50%/);
  assert.match(result.summary, /Scheduled\s+27/);
  assert.match(result.coverage, /Month to date/);
});

test("no source keeps existing missing-source Home state", () => {
  const result = home(null);
  assert.match(result.summary, /No verified Next Appointments snapshot loaded/);
  assert.equal(result.coverage, "No verified source loaded");
});

test("null, absent, blank, string, boolean, nonfinite rate never renders as 0.00%", () => {
  for (const bad of [null, undefined, "", "0", false, true, NaN, Infinity]) {
    const report = source(0);
    if (bad === undefined) delete report.summary.successRate;
    else report.summary.successRate = bad;
    const result = home(report);
    assert.match(result.summary, /Success\s+Not verified/);
    assert.doesNotMatch(result.summary, /Success\s+0\.00%/);
    assert.match(result.coverage, /retained metrics not verified/);
  }
});

test("missing required store summary and invalid counts fail visibly without a crash", () => {
  const missing = home(source(0, { summary: null, identityConflicts: null }));
  assert.match(missing.summary, /Success\s+Not verified/);
  assert.match(missing.summary, /Scheduled\s+Not verified/);
  const bad = home(source(20, { summary: {
    successRate: 20, scheduled: null, opportunities: "4", existingAppointments: -1
  } }));
  assert.match(bad.summary, /Success\s+20\.00%/);
  assert.match(bad.summary, /Scheduled\s+Not verified/);
  assert.match(bad.summary, /Opportunities\s+Not verified/);
  assert.match(bad.summary, /Existing appointments\s+Not verified/);
});

test("service appointment rates and counts must be actual source numbers", () => {
  const report = source(60, { serviceAppointments: { store: {
    appointmentCount: 4, appointmentUseRate: null,
    showRate: "0", noShowCount: undefined, noShowRate: false
  } } });
  const result = home(report);
  assert.match(result.summary, /Service appointments\s+4/);
  assert.match(result.summary, /Service appointment use\s+Not verified/);
  assert.match(result.summary, /Service show rate\s+Not verified/);
  assert.match(result.summary, /Service no-shows\s+Not verified · Not verified/);
});

test("valid service appointment zeros and substitute labels survive rendering", () => {
  const report = source(0, {
    validation: { parser: "appointments-created-summary-v1" },
    summary: { successRate: 0, scheduled: 0, opportunities: null, existingAppointments: null },
    serviceAppointments: { store: {
      appointmentCount: 0, appointmentUseRate: 0, showRate: 0, noShowCount: 0, noShowRate: 0
    } }
  });
  const result = home(report);
  assert.match(result.summary, /NSA rate\s+0\.00%/);
  assert.match(result.summary, /NSA count\s+0/);
  assert.match(result.summary, /Opportunities\s+Not supplied/);
  assert.match(result.summary, /Service show rate\s+0\.00%/);
  assert.doesNotMatch(result.coverage, /retained metrics not verified/);
});
