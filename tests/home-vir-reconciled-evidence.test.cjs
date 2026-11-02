"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function source(start, end, label) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "Real production " + label + " must remain available");
  return app.slice(a, b);
}
const parser = source("  const VIR_NAME_CODES = {};", "  function virObservationDate(", "VIR parser");
const metricEvidence = source("  function metricEvidence({", "  function metricEvidenceText(", "evidence contract");
const completeness = source("  function virCompletenessEvidence(", "  function virMeetingEvidence()", "source reconciliation");
const home = source("  function renderOverviewIntelligence() {",
  "  const renderOverviewIntelligenceBase=renderOverviewIntelligence;", "Home renderer");

function node() {
  return {
    textContent: "", className: "", children: [],
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = [...items]; }
  };
}
function texts(node) {
  return [String(node?.textContent ?? ""), ...(node?.children || []).map(texts)].join(" ");
}
function parsed(row) {
  const ctx = vm.createContext({
    ADVISOR_NAMES: { A1: "Synthetic Advisor" },
    text: v => String(v ?? ""),
    norm: v => String(v ?? "").trim().toLowerCase(),
    csvNumber: v => v === "" || v == null ? null : Number(v),
    parseCsv: v => v.trimEnd().split(/\r?\n/).map(line => line.split(",")),
    internalObservationDate: () => "2026-11-02",
    now: () => "2026-11-02T18:00:00Z"
  });
  vm.runInContext(parser + '\nVIR_NAME_CODES["synthetic advisor"]="A1";this.parse=parseVirCsv;', ctx);
  const csv = [
    "Report Date,2026-11-02",
    "Advisor Name,Total ROs,VIR Printed/Emailed/Texted,VIR Use %",
    row
  ].join("\n") + "\n";
  return ctx.parse(csv, "synthetic-vir.csv");
}
function view(snapshot) {
  const ui = Object.fromEntries([
    "moondogNeeds", "nextAppointmentsSummary", "nextAppointmentsCoverage",
    "virSummary", "virCoverage", "menuSummary", "menuCoverage",
    "csiSummary", "csiCoverage"
  ].map(name => [name, node()]));
  const model = {
    settings: { csiPeriodStart: "2026-11-01" },
    operationalMetrics: {
      nextAppointments: { snapshots: {} },
      menu: { snapshots: {} },
      csi: { surveys: {} }
    }
  };
  const ctx = vm.createContext({
    model, ui, document: { createElement: () => node() },
    renderAdminCloseoutAttention: () => {},
    renderTrendCoverageSummary: () => {},
    renderPreviousMonthTotals: () => {},
    latestNextAppointmentsSnapshot: () => null,
    latestVirObservation: () => snapshot,
    allVirObservations: () => snapshot ? [snapshot] : [],
    virObservationTime: () => 0,
    virObservationDate: item => item?.reportDate || "",
    virObservationIsStale: () => false,
    managerAttentionRequests: () => [],
    trendCoverageAudit: () => ({}),
    currentCsiSurveys: () => ({}),
    latestCsiRefreshDate: () => "",
    npsSummary: () => ({ responses: 0 }),
    reportNeeds: () => ({}),
    sourceFreshness: () => ({ safeForCurrent: true }),
    sourceLineageLabel: () => "",
    standard: () => NaN,
    performanceFormat: v => String(v),
    shortDate: date => String(date || "—"),
    localDateKey: () => "2026-11-02",
    text: value => String(value ?? ""),
    meetingVirRosterCodes: () => ["A1"]
  });
  vm.runInContext(metricEvidence + "\n" + completeness + "\n" + home +
    "\nthis.renderProductionHome=renderOverviewIntelligence;", ctx);
  assert.doesNotThrow(() => ctx.renderProductionHome());
  return { summary: texts(ui.virSummary), coverage: ui.virCoverage.textContent, ui };
}

test("real parser null zero-denominator VIR renders Home not-applicable without throwing", () => {
  const actual = parsed("Synthetic Advisor,0,0,0");
  assert.equal(actual.store.utilization, null);
  const old = JSON.stringify(actual);
  const result = view(actual);
  assert.match(result.summary, /Store VIR\s+Not applicable/);
  assert.match(result.summary, /VIR used\s+0/);
  assert.match(result.summary, /Eligible ROs\s+0/);
  assert.doesNotMatch(result.summary, /0\.0%/);
  assert.equal(JSON.stringify(actual), old, "rendering cannot rewrite source");
});

test("verified positive denominator with zero used retains genuine 0.0% on Home", () => {
  const result = view(parsed("Synthetic Advisor,4,0,0"));
  assert.match(result.summary, /Store VIR\s+0\.0%/);
  assert.match(result.summary, /Eligible ROs\s+4/);
  assert.match(result.coverage, /point-in-time observation/);
});

test("verified nonzero source remains visible with reconciled counts", () => {
  const result = view(parsed("Synthetic Advisor,4,3,75"));
  assert.match(result.summary, /Store VIR\s+75\.0%/);
  assert.match(result.summary, /VIR used\s+3/);
});

test("a missing source uses the preexisting Home empty state", () => {
  const result = view(null);
  assert.match(result.summary, /No verified VIR observation/);
  assert.equal(result.coverage, "No verified source loaded");
});

test("retained invalid or missing percentage never produces numeric Home authority", () => {
  for (const bad of [null, undefined, "", "0", false, Number.NaN, Infinity]) {
    const snap = parsed("Synthetic Advisor,4,0,0");
    if (bad === undefined) delete snap.store.utilization;
    else snap.store.utilization = bad;
    const result = view(snap);
    assert.match(result.summary, /Store VIR\s+Not verified/);
    assert.doesNotMatch(result.summary, /Store VIR\s+0\.0%/);
    assert.match(result.coverage, /utilization not verified/);
  }
});

test("retained source with row conflict or no store is not presented as verified", () => {
  const mismatch = parsed("Synthetic Advisor,4,3,75");
  mismatch.advisors.A1.utilization = null;
  assert.match(view(mismatch).summary, /Store VIR\s+Not verified/);
  const missing = parsed("Synthetic Advisor,4,3,75");
  delete missing.store;
  assert.match(view(missing).summary, /Store VIR\s+Not verified/);
  assert.match(view(missing).summary, /Eligible ROs\s+Not verified/);
});

test("zero denominator with fabricated numeric utilization cannot masquerade as 0.0%", () => {
  const invalid = parsed("Synthetic Advisor,0,0,0");
  invalid.store.utilization = 0;
  const result = view(invalid);
  assert.match(result.summary, /Store VIR\s+Not verified/);
  assert.doesNotMatch(result.summary, /0\.0%/);
});
