"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");
const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");

function extract(from, to) {
  const start = app.indexOf(from), end = app.indexOf(to, start);
  assert.ok(start >= 0 && end > start, "Missing production source block: " + from);
  return app.slice(start, end);
}
const validator = extract("  function verifiedVirSourceObservationDate(", "  function sourceFreshness(");
const lineage = extract("  function virObservationDate(", "  function normalizeOperationalCoverage()");
const coverage = extract("  function trendCoverageAudit(", "  function trendMaintenance(");
const windowKeys = extract("  function meetingWindowKeys(", "  function meetingClosedGrossPoint(");
const comparison = extract("  function virMeetingWindowComparison(", "  function menuMeetingEvidence(");
assert.match(lineage, /function virObservationDate\(snapshot\) \{ return verifiedVirSourceObservationDate\(snapshot\); \}/);
assert.match(lineage, /if\(!observed\)return 0/, "Undated reports must not outrank dated observations");

const TODAY = "2026-11-02";
function sample(date, extra = {}) {
  return {
    reportDate: date,
    observationTimestamp: date ? date + "T12:00:00Z" : "",
    sourceModifiedAt: date ? date + "T10:00:00Z" : "",
    importedAt: "2026-11-02T23:00:00Z",
    sourceFile: "synthetic-vir.csv",
    store: {totalROs: 4, used: 3, utilization: 75},
    ...extra
  };
}
function fixture(records = [], today = TODAY) {
  const snapshots = Object.fromEntries(records.map((record, i) => ["source-" + i, record]));
  const model = {operationalMetrics: {vir: {snapshots, pending: {}}}, performance: {snapshots: {}}};
  const context = vm.createContext({
    model, freshness,
    text: v => String(v ?? ""),
    validCoverageDate: v => freshness.validDateKey(v) ? v : "",
    localDateKey: d => d ? d.toISOString().slice(0, 10) : today,
    previousOperatingDateKey: d => freshness.previousOperatingDay(d),
    sourceExpectation: () => "recommended",
    SOURCE_COVERAGE_RULES: {sapr: {}, menu: {}, vir: {}, csi: {}},
    currentMonthWindow: d => ({start: d.slice(0,7) + "-01", end: d, expectedDates: []}),
    saprTrendCoverage: () => ({presentDates: [], missingDates: []}),
    dailySourceCoverage: () => ({presentDates: []}),
    latestCsiRefreshDate: () => "",
    importCoverageWording: () => ({}),
    virCompletenessEvidence: r => ({verified: Boolean(r?.store), value: r?.store?.utilization}),
    metricEvidence: r => ({...r, verified: false})
  });
  const before = JSON.stringify(model);
  vm.runInContext(validator + "\n" + lineage + "\n" + coverage + "\n" + windowKeys + "\n" + comparison
    + "\nthis.observe=virObservationDate;this.observationTime=virObservationTime;"
    + "this.latest=latestVirObservation;this.stale=virObservationIsStale;"
    + "this.coverage=trendCoverageAudit;this.compare=virMeetingWindowComparison;", context);
  function checkUnchanged() {
    assert.equal(JSON.stringify(model), before, "Source selection and coverage are read-only");
  }
  return {ctx: context, checkUnchanged};
}

test("legacy VIR imported today without source observation is undated and stale", () => {
  const row = {importedAt: "2026-11-02T23:00:00Z", store: {utilization: 80}};
  const f = fixture([row]);
  assert.equal(f.ctx.observe(row), "");
  assert.equal(f.ctx.observationTime(row), 0);
  assert.equal(f.ctx.stale(row), true);
  f.checkUnchanged();
});

test("actual source observation timestamp and file modification preserve dated compatibility", () => {
  const row = sample("", {sourceModifiedAt: "2026-11-02T13:00:00Z"});
  const f = fixture([row]);
  assert.equal(f.ctx.observe(row), TODAY);
  assert.equal(f.ctx.stale(row), false);
  assert.equal(f.ctx.observationTime(row), Date.parse("2026-11-02T13:00:00Z"));
  f.checkUnchanged();
});

test("explicit report date outranks contradictory source timestamps and import time", () => {
  const row = sample("2026-10-21", {observationTimestamp: "2026-11-02T14:00:00Z"});
  const f = fixture([row]);
  assert.equal(f.ctx.observe(row), "2026-10-21");
  assert.equal(f.ctx.observationTime(row), Date.parse("2026-10-21T12:00:00Z"));
  assert.equal(f.ctx.stale(row), true);
  f.checkUnchanged();
});

test("invalid explicit report date cannot be replaced by current metadata", () => {
  const row = sample("2026-02-30", {observationTimestamp: "2026-11-02T12:00:00Z"});
  const f = fixture([row]);
  assert.equal(f.ctx.observe(row), "");
  assert.equal(f.ctx.observationTime(row), 0);
  f.checkUnchanged();
});

test("Home latest VIR prefers genuine source record to newer undated import", () => {
  const valid = sample("2026-10-30", {sourceFile: "valid.csv", importedAt: "2026-10-30T20:00:00Z"});
  const undated = sample("", {sourceFile: "undated.csv", importedAt: "2026-11-02T23:45:00Z"});
  const f = fixture([valid, undated]);
  assert.equal(f.ctx.latest().sourceFile, "valid.csv");
  assert.equal(f.ctx.coverage(TODAY).vir.observationDate, "2026-10-30");
  f.checkUnchanged();
});

test("Home trend coverage never manufactures a date from import-only VIR", () => {
  const undated = sample("", {importedAt: "2026-11-02T23:45:00Z"});
  const f = fixture([undated]);
  assert.equal(f.ctx.coverage().vir.observationDate, "");
  f.checkUnchanged();
});

test("Meeting windows do not invent prior-period history from local imports", () => {
  const recent = sample("2026-11-02", {sourceFile: "new.csv"});
  const undated = sample("", {sourceFile: "import-only.csv", importedAt: "2026-10-23T23:45:00Z"});
  const f = fixture([undated, recent]);
  const result = f.ctx.compare(TODAY);
  assert.equal(result.current.snapshot.sourceFile, "new.csv");
  assert.equal(result.prior, null);
  assert.equal(result.priorMissingEvidence.status, "missing-period");
  f.checkUnchanged();
});

test("Meeting comparison preserves genuine prior and current observation windows", () => {
  const prior = sample("2026-10-23", {sourceFile: "prior.csv", store: {utilization: 50}});
  const current = sample("2026-11-02", {sourceFile: "current.csv", store: {utilization: 75}});
  const f = fixture([prior, current]);
  const result = f.ctx.compare(TODAY);
  assert.equal(result.prior.snapshot.sourceFile, "prior.csv");
  assert.equal(result.current.snapshot.sourceFile, "current.csv");
  assert.equal(result.change, 25);
  assert.equal(result.priorMissingEvidence, null);
  f.checkUnchanged();
});
