"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");

const shipped = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function source(start, end, label) {
  const first = shipped.indexOf(start), last = shipped.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, "Actual production " + label + " must be available");
  return shipped.slice(first, last);
}
const evidenceSource = source("  function metricEvidence({", "  function metricEvidenceText(", "metric evidence");
const snapshotSource = source("  function latestOperationalSnapshot(", "  function csiReportedPeriod(", "snapshot selector");
const menuValidator = source("  function verifiedMenuTrendReleases(", "  function trendCoverageAudit(", "Menu validated period selector");
const menuSource = source("  function sourceFreshness(", "  function metricDependencyEvidence(", "Menu freshness adapter");
const menuEvidenceSource = source("  function menuMeetingEvidence(", "  function csiMetricEvidence(", "Menu evidence");
const homeSource = source("  function renderOverviewIntelligence() {",
  "  const renderOverviewIntelligenceBase=renderOverviewIntelligence;", "Home renderer");

function node() {
  return { textContent: "", className: "", children: [],
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = [...items]; }
  };
}
function readText(n) {
  return [String(n?.textContent ?? ""), ...(n?.children || []).map(readText)].join(" ");
}
function snapshot(presentation, penetration, week = "2026-11-02") {
  return { releaseWeek: week, periodStart: "2026-10-26", periodEnd: "2026-11-01",
    store: { presentation, penetration }, importedAt: "2026-11-02T18:00:00Z" };
}
function renderMenu(sourceSnapshot, expectation = "recommended") {
  const ui = Object.fromEntries([
    "moondogNeeds", "nextAppointmentsSummary", "nextAppointmentsCoverage",
    "virSummary", "virCoverage", "menuSummary", "menuCoverage",
    "csiSummary", "csiCoverage"
  ].map(name => [name, node()]));
  const menu = sourceSnapshot ? { [sourceSnapshot.releaseWeek || "unknown"]: sourceSnapshot } : {};
  const model = { settings: { csiPeriodStart: "2026-11-01", setup: {
    sourceExpectations: { menu: expectation } } }, operationalMetrics: {
    nextAppointments: { snapshots: {} },
    menu: { snapshots: menu },
    csi: { surveys: {} }
  } };
  const ctx = vm.createContext({
    ui, model, freshness,
    businessTimeZone: () => "America/Los_Angeles",
    document: { createElement: () => node() },
    text: x => String(x ?? ""),
    localDateKey: () => "2026-11-02",
    expectedMenuWeek: () => "2026-11-02",
    sourceExpectation: key => model.settings.setup.sourceExpectations[key] || "recommended",
    latestNextAppointmentsSnapshot: () => null,
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
    sourceLineageLabel: () => "",
    standard: () => NaN,
    performanceFormat: x => String(x),
    shortDate: x => String(x || "—")
  });
  vm.runInContext(menuValidator + "\n" + menuSource + "\n" + evidenceSource + "\n" + snapshotSource + "\n" +
    menuEvidenceSource + "\n" + homeSource +
    "\nthis.renderActualHome=renderOverviewIntelligence;", ctx);
  assert.doesNotThrow(() => ctx.renderActualHome());
  return { summary: readText(ui.menuSummary), coverage: ui.menuCoverage.textContent };
}

test("current verified real zeros remain numeric 0.0% in both Home Menu metrics", () => {
  const actual = snapshot(0, 0);
  const original = JSON.stringify(actual);
  const result = renderMenu(actual);
  assert.match(result.summary, /Presentation\s+0\.0%/);
  assert.match(result.summary, /Penetration\s+0\.0%/);
  assert.doesNotMatch(result.summary, /Not verified/);
  assert.equal(JSON.stringify(actual), original, "rendering may not rewrite source");
});

test("verified nonzero source metrics are formatted without changing source", () => {
  const result = renderMenu(snapshot(65.5, 44.1));
  assert.match(result.summary, /Presentation\s+65\.5%/);
  assert.match(result.summary, /Penetration\s+44\.1%/);
  assert.match(result.coverage, /release week 2026-11-02/);
});

test("missing source uses Home's existing empty-state requirement", () => {
  const result = renderMenu(null);
  assert.match(result.summary, /No verified Menu Sales report loaded/);
  assert.equal(result.coverage, "Monday report required");
});

test("null, missing, blank, strings, booleans and nonfinite values never become zero authority", () => {
  for (const bad of [null, undefined, "", "0", false, true, NaN, Infinity, -Infinity]) {
    const s = snapshot(0, 0);
    if (bad === undefined) delete s.store.presentation;
    else s.store.presentation = bad;
    const result = renderMenu(s);
    assert.match(result.summary, /Presentation\s+Not verified/);
    assert.match(result.summary, /Penetration\s+0\.0%/);
    assert.doesNotMatch(result.summary, /Presentation\s+0\.0%/);
    assert.match(result.coverage, /source metrics not current\/verified/);
  }
});

test("missing store and mixed valid/invalid metrics remain source-explicit, not exceptions", () => {
  const s = snapshot(50, null);
  assert.match(renderMenu(s).summary, /Presentation\s+50\.0%/);
  assert.match(renderMenu(s).summary, /Penetration\s+Not verified/);
  delete s.store;
  const result = renderMenu(s);
  assert.match(result.summary, /Presentation\s+Not verified/);
  assert.match(result.summary, /Penetration\s+Not verified/);
});

test("historical Menu rates carry the stale label, not current verified authority", () => {
  const result = renderMenu(snapshot(42.2, 0, "2026-10-26"));
  assert.match(result.summary, /Presentation\s+42\.2% · Historical/);
  assert.match(result.summary, /Penetration\s+0\.0% · Historical/);
  assert.match(result.coverage, /current release overdue/);
});

test("not-used and temporarily-unavailable source policies mask retained historical values", () => {
  const existing = snapshot(75, 25);
  const unused = renderMenu(existing, "not-used");
  assert.match(unused.summary, /Presentation\s+Not used/);
  assert.match(unused.summary, /Penetration\s+Not used/);
  assert.doesNotMatch(unused.summary, /75\.0%/);
  const unavailable = renderMenu(existing, "temporarily-unavailable");
  assert.match(unavailable.summary, /Presentation\s+Temporarily unavailable/);
  assert.match(unavailable.summary, /Penetration\s+Temporarily unavailable/);
  assert.doesNotMatch(unavailable.summary, /75\.0%/);
});
