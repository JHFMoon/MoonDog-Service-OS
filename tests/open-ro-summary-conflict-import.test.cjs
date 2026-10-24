"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  function comparableManagerSnapshot(");
const end = app.indexOf("  async function classifyImportFile(", start);
assert.ok(start >= 0 && end > start, "Production report comparison and import path must be present");
const importer = app.slice(start, end);

const saved = {
  period: "2026-10",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-21",
  sourceFile: "synthetic-open-ro-summary.xlsx",
  importedAt: "2026-10-21T18:00:00.000Z",
  sourceModifiedAt: "2026-10-21T00:00:00.000Z",
  coverageDate: "2026-10-21",
  store: { verifiedRows: 12, reportedRows: 13, agedCount: 2 },
  advisors: { SYN01: { code: "SYN01", name: "Prior Synthetic Label", verifiedRows: 5, agedCount: 1 } }
};

function fixture(candidate) {
  const model = { operationalMetrics: { openRoSummary: { snapshots: { "2026-10": structuredClone(saved) } } } };
  let durable = structuredClone(model.operationalMetrics);
  const events = [];
  const removed = [];
  const context = vm.createContext({
    model, structuredClone,
    OPERATIONAL_METRICS_PATH: ["data", "operational-metrics.json"],
    now: () => "2026-10-22T12:00:00.000Z",
    localDateKey: () => "2026-10-22",
    sourceFileHandle: async () => ({ getFile: async () => ({ lastModified: Date.UTC(2026, 9, 22) }) }),
    parseSorWorkbook: () => { throw new Error("Unexpected SOR parse"); },
    parseAppointmentActivityWorkbook: () => { throw new Error("Unexpected appointment parse"); },
    parseEfficiencyWorkbook: () => { throw new Error("Unexpected Efficiency parse"); },
    parseMediaAsrAdvisorWorkbook: () => { throw new Error("Unexpected Media ASR parse"); },
    parseMediaAsrTechWorkbook: () => { throw new Error("Unexpected Media ASR technician parse"); },
    parseOpenRoSummaryWorkbook: () => structuredClone(candidate),
    workbookGrid: () => ({ rows: [] }),
    dailyEvidenceDate: () => "2026-10-21",
    internalObservationDate: () => "",
    pruneDatedSnapshots: value => value,
    writeJson: async (_path, value) => { events.push("write"); durable = structuredClone(value); },
    readJson: async () => { events.push("readback"); return structuredClone(durable); },
    addHistory: async () => { events.push("history"); },
    removeSourceEntry: async name => { events.push("delete"); removed.push(name); }
  });
  vm.runInContext(importer + "\nthis.importManagerSource = importManagerSource;", context);
  return {
    model, events, removed, durable: () => durable,
    run: () => context.importManagerSource("synthetic-conflicting-open-ro-summary.xlsx", "open-ro-summary", [], true)
  };
}

test("conflicting synthetic Open RO summary fails before mutation, success history, or source deletion", async () => {
  const conflict = structuredClone(saved);
  conflict.store.verifiedRows = 14;
  conflict.sourceFile = "synthetic-conflicting-open-ro-summary.xlsx";
  conflict.coverageDate = "2026-10-22";
  conflict.importedAt = "2026-10-22T18:00:00.000Z";
  const f = fixture(conflict);
  const modelBefore = JSON.stringify(f.model.operationalMetrics);
  const diskBefore = JSON.stringify(f.durable());

  await assert.rejects(f.run(), /Conflicting open-ro-summary report for period 2026-10 is already saved/);

  assert.equal(JSON.stringify(f.model.operationalMetrics), modelBefore, "the existing WIP summary stays unchanged");
  assert.equal(JSON.stringify(f.durable()), diskBefore, "no conflicting WIP snapshot is written");
  assert.deepEqual(f.events, [], "conflict fails before durable write, read-back, or success history");
  assert.deepEqual(f.removed, [], "the conflicting synthetic report remains available for review");
});


test("identical synthetic Open RO summary reimport tolerates refreshed derived metadata", async () => {
  const reimport = structuredClone(saved);
  reimport.sourceFile = "synthetic-open-ro-summary-reimport.xlsx";
  reimport.importedAt = "2026-10-22T18:00:00.000Z";
  reimport.sourceModifiedAt = "2026-10-22T00:00:00.000Z";
  reimport.coverageDate = "2026-10-22";
  const f = fixture(reimport);

  await f.run();

  const persisted = f.durable().openRoSummary.snapshots["2026-10"];
  assert.equal(persisted.store.verifiedRows, saved.store.verifiedRows, "the identical aggregate is accepted without duplication");
  assert.equal(persisted.coverageDate, "2026-10-21", "coverage date is normalized from the source evidence");
  assert.equal(persisted.sourceModifiedAt, "2026-10-22T00:00:00.000Z", "current source metadata is refreshed");
  assert.deepEqual(f.events, ["write", "readback", "history", "delete"], "source deletion follows verified durable read-back and history");
  assert.deepEqual(f.removed, ["synthetic-conflicting-open-ro-summary.xlsx"]);
  assert.equal(JSON.stringify(f.model.operationalMetrics), JSON.stringify(f.durable()), "the verified in-memory and durable snapshots agree across VM realms");
});
