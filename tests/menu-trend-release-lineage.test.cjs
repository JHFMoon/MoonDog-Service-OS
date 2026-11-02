"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  function verifiedMenuTrendReleases(");
const end = app.indexOf("  function trendMaintenance(", start);
assert.ok(start >= 0 && end > start, "Production Menu release validator and trend audit must exist");
const source = app.slice(start, end);
assert.ok(source.includes("const savedReleases=verifiedMenuTrendReleases("),
  "Actual monthly coverage must use period-validated release evidence");

const TODAY = "2026-10-26";
function snapshot(week, extra = {}) {
  return {
    releaseWeek: week,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-25",
    ranDate: week,
    store: {presentation: 52, penetration: 38},
    importedAt: "2026-10-26T15:00:00.000Z",
    ...extra
  };
}
function audit(items, today = TODAY) {
  const snapshots = Object.fromEntries(items.map((item, index) => ["retained-" + index, item]));
  const model = {operationalMetrics: {menu: {snapshots}}};
  const before = JSON.stringify(model);
  let captured = null;
  const context = vm.createContext({
    model, freshness,
    localDateKey: () => today,
    currentMonthWindow: key => ({
      start: key.slice(0, 7) + "-01", end: key, expectedDates: []
    }),
    sourceExpectation: () => "recommended",
    saprTrendCoverage: () => ({presentDates: [], missingDates: []}),
    dailySourceCoverage: () => ({presentDates: []}),
    SOURCE_COVERAGE_RULES: {menu: {}, sapr: {}, vir: {}, csi: {}},
    virObservationDate: () => "",
    latestVirObservation: () => null,
    latestCsiRefreshDate: () => "",
    importCoverageWording: a => {
      captured = a.menu;
      return {};
    }
  });
  vm.runInContext(source + "\nthis.audit=trendCoverageAudit;this.verifiedMenuTrendReleases=verifiedMenuTrendReleases;", context);
  const result = context.audit(today);
  assert.equal(JSON.stringify(model), before, "Coverage must never mutate durable source history");
  assert.ok(captured, "Actual coverage presentation must receive source-audited releases");
  const ordinary = values => Array.from(values);
  return {
    present: ordinary(result.menu.presentReleases),
    missing: ordinary(result.menu.missingReleases),
    expected: ordinary(result.menu.expectedReleases),
    last: result.menu.lastPoint,
    fromWording: ordinary(captured.presentReleases)
  };
}

test("valid dated Monday Menu releases remain loaded and appear in coverage wording", () => {
  const records = [
    snapshot("2026-10-05", {ranDate: "2026-10-06"}),
    snapshot("2026-10-12", {ranDate: "2026-10-14"}),
    snapshot("2026-10-19", {ranDate: "2026-10-21"}),
    snapshot("2026-10-26")
  ];
  const result = audit(records);
  assert.deepEqual(result.expected, ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
  assert.deepEqual(result.present, result.expected);
  assert.deepEqual(result.fromWording, result.expected);
  assert.deepEqual(result.missing, []);
  assert.equal(result.last, "2026-10-26");
});

test("impossible, reversed or missing report periods never count as loaded weekly evidence", () => {
  const items = [
    snapshot("2026-10-05", {periodStart: "2026-10-14", periodEnd: "2026-10-12"}),
    snapshot("2026-10-12", {periodStart: "2026-02-30"}),
    snapshot("2026-10-19", {periodEnd: ""}),
    snapshot("2026-10-26")
  ];
  const result = audit(items);
  assert.deepEqual(result.present, ["2026-10-26"]);
  assert.deepEqual(result.missing, ["2026-10-05", "2026-10-12", "2026-10-19"]);
  assert.equal(result.last, "2026-10-26");
});

test("a conflicting or impossible report run date cannot claim the matching release week", () => {
  const records = [
    snapshot("2026-10-05", {ranDate: "2026-10-13"}),
    snapshot("2026-10-12", {ranDate: "2026-02-30"}),
    snapshot("2026-10-19", {ranDate: "2026-10-20"})
  ];
  const result = audit(records);
  assert.deepEqual(result.present, ["2026-10-19"]);
  assert.ok(result.missing.includes("2026-10-05"));
  assert.ok(result.missing.includes("2026-10-12"));
});

test("historical retained weekly reports without a legacy run date remain eligible", () => {
  const old = snapshot("2026-10-12");
  delete old.ranDate;
  const old2 = snapshot("2026-10-19", {ranDate: ""});
  const result = audit([old, old2]);
  assert.deepEqual(result.present, ["2026-10-12", "2026-10-19"]);
  assert.ok(result.missing.includes("2026-10-26"));
});

test("future-dated or non-Monday release keys cannot manufacture loaded coverage", () => {
  const items = [
    snapshot("2026-10-27"),
    snapshot("2026-11-02"),
    snapshot("2026-10-19"),
    snapshot("2026-10-26")
  ];
  const result = audit(items);
  assert.deepEqual(result.present, ["2026-10-19", "2026-10-26"]);
  assert.deepEqual(result.missing, ["2026-10-05", "2026-10-12"]);
});

test("duplicate equivalent releases count once and malformed retained entries fail closed", () => {
  const items = [
    snapshot("2026-10-12"),
    snapshot("2026-10-12", {importedAt: "2026-10-26T16:00:00.000Z"}),
    null, {}, {releaseWeek: "2026-10-05"}
  ];
  const result = audit(items);
  assert.deepEqual(result.present, ["2026-10-12"]);
  assert.deepEqual(result.fromWording, ["2026-10-12"]);
  assert.deepEqual(result.missing, ["2026-10-05", "2026-10-19", "2026-10-26"]);
});
