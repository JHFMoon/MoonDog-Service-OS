"use strict";

// #59-01: test the production SAPR workbook parser and importer, not a copy of date rules.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function extract(begin, end, name) {
  const start = app.indexOf(begin), stop = app.indexOf(end, start + begin.length);
  assert.ok(start >= 0 && stop > start, "Missing production " + name);
  return app.slice(start, stop);
}
const dateAdapter = extract("  function usDateToIso(", "  const CONTROLLABLES =", "SAPR date adapter");
const parser = extract("  function parsePerformanceWorkbook(", "  function prunePerformanceSnapshots(", "SAPR workbook parser");
const importer = extract("  async function importPerformanceFile(", "  function performanceFormat(", "SAPR persistence importer");

function harness(period, includeImporter = false) {
  const store = { rows: [
    ["Service Advisor Performance From " + period],
    ["Synthetic store summary"]
  ] };
  const advisor = { rows: [["Synthetic advisor detail"]] };
  const book = { SheetNames: ["Store", "Advisor"], Sheets: { Store: store, Advisor: advisor } };
  const writes = [];
  const model = { performance: { snapshots: {}, updatedAt: "" } };
  const ctx = vm.createContext({
    freshness,
    XLSX: { read: () => book },
    text: value => String(value ?? ""),
    performanceRows: sheet => sheet.rows,
    performanceDays: () => ({ completed: 5, total: 24 }),
    performanceDetailCode: () => "SYN",
    performanceMetrics: () => ({ totalGross: 900, cpRO: 5, cpHours: 10, cpElr: 120 }),
    validateAdvisorPerformance: () => {},
    parseControllableBenchmarks: () => ({ store: {}, advisors: {} }),
    ADVISOR_NAMES: { SYN: "Synthetic Advisor" },
    CONTROLLABLES: new Array(7),
    now: () => "2026-11-01T13:00:00.000Z",
    model,
    ui: { performanceSourceSelect: { value: "synthetic-sapr.xlsx" } },
    status: () => {},
    writeJson: async () => { writes.push("write"); },
    readJson: async () => { writes.push("read"); return null; },
    sourceFileHandle: async () => { throw new Error("Unexpected source handle access"); },
    PERFORMANCE_PATH: ["data", "performance.json"],
    structuredClone,
    prunePerformanceSnapshots: snapshots => snapshots,
    renderPerformance: () => {},
    dailyPickedSources: new Set(["synthetic-sapr.xlsx"])
  });
  vm.runInContext(dateAdapter + "\n" + parser +
    (includeImporter ? "\n" + importer : "") +
    "\nthis.sapRParser = parsePerformanceWorkbook;" +
    (includeImporter ? "\nthis.sapRImporter = importPerformanceFile;" : ""), ctx);
  return { ctx, model, writes, parse: () => ctx.sapRParser(new ArrayBuffer(1), "synthetic-sapr.xlsx") };
}

test("production SAPR parser retains exact valid month-to-date and leap-day scope", () => {
  for (const [period, start, end] of [
    ["10/01/2026 to 10/21/2026", "2026-10-01", "2026-10-21"],
    ["02/01/2028 to 02/29/2028", "2028-02-01", "2028-02-29"],
    ["02/28/2026 to 02/28/2026", "2026-02-28", "2026-02-28"]
  ]) {
    const result = harness(period).parse();
    assert.equal(result.periodStart, start, period);
    assert.equal(result.periodEnd, end, period);
    assert.equal(result.date, end, period);
    assert.equal(result.saprDaysCompleted, 5, period);
  }
});

test("production SAPR parser fails closed on impossible, reversed and cross-month report scope", () => {
  for (const period of [
    "02/01/2026 to 02/29/2026",
    "04/01/2026 to 04/31/2026",
    "13/01/2026 to 13/02/2026",
    "10/25/2026 to 10/01/2026",
    "09/30/2026 to 10/01/2026",
    "01/00/2026 to 01/01/2026"
  ]) {
    assert.throws(() => harness(period).parse(), /valid, ordered month-to-date dates/, period);
  }
});

test("invalid production SAPR scope aborts import before any durable write or history mutation", async () => {
  const { ctx, model, writes } = harness("02/01/2026 to 02/30/2026", true);
  await assert.rejects(
    ctx.sapRImporter("synthetic-sapr.xlsx", false, new ArrayBuffer(1)),
    /reporting period must have valid, ordered month-to-date dates/
  );
  assert.deepEqual(writes, [], "invalid source must not reach durable persistence");
  assert.deepEqual(model.performance.snapshots, {}, "invalid source must not enter runtime authority");
  assert.equal(model.performance.updatedAt, "");
});
