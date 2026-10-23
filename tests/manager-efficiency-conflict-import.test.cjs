"use strict";

// #59-04: exercise the production manager-source importer for the Efficiency
// family. All report values and labels are synthetic fixtures.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  function comparableManagerSnapshot(");
const end = app.indexOf("  async function classifyImportFile(", start);
assert.ok(start >= 0 && end > start, "Production manager snapshot comparison and import path must be present");
const managerImport = app.slice(start, end);

const saved = {
  period: "2026-10",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-21",
  sourceFile: "synthetic-efficiency.xlsx",
  importedAt: "2026-10-21T18:00:00.000Z",
  sourceModifiedAt: "2026-10-21T00:00:00.000Z",
  coverageDate: "2026-10-21",
  generatedAt: "2026-10-21T17:00:00.000Z",
  store: { clockHours: 120, efficiency: 0.9 },
  advisors: { SYN01: { code: "SYN01", name: "Prior Synthetic Label", gross: 2400 } },
  technicians: [{ name: "Synthetic Technician", number: "TECH-OLD", clockHours: 40 }],
  unresolved: ["Synthetic Technician"]
};
const equivalent = {
  unresolved: [],
  technicians: [{ clockHours: 40, number: "TECH-NEW", name: "Synthetic Technician" }],
  advisors: { SYN01: { gross: 2400, name: "Current Synthetic Label", code: "SYN01" } },
  store: { efficiency: 0.9, clockHours: 120 },
  generatedAt: "2026-10-22T16:00:00.000Z",
  coverageDate: "2026-10-22",
  sourceModifiedAt: "2026-10-22T00:00:00.000Z",
  importedAt: "2026-10-22T18:00:00.000Z",
  sourceFile: "synthetic-efficiency (1).xlsx",
  periodEnd: "2026-10-21",
  periodStart: "2026-10-01",
  period: "2026-10"
};

function fixture(candidate) {
  const model = { operationalMetrics: { efficiency: { snapshots: { "2026-10": structuredClone(saved) } } } };
  let durable = structuredClone(model.operationalMetrics);
  let parsed = structuredClone(candidate);
  const events = [];
  const removed = [];
  const context = vm.createContext({
    model,
    structuredClone,
    OPERATIONAL_METRICS_PATH: ["data", "operational-metrics.json"],
    now: () => "2026-10-23T12:00:00.000Z",
    localDateKey: () => "2026-10-23",
    sourceFileHandle: async () => ({ getFile: async () => ({ lastModified: Date.UTC(2026, 9, 22) }) }),
    parseSorWorkbook: () => { throw new Error("Unexpected SOR parse"); },
    parseAppointmentActivityWorkbook: () => { throw new Error("Unexpected appointment parse"); },
    parseEfficiencyWorkbook: () => structuredClone(parsed),
    parseMediaAsrAdvisorWorkbook: () => { throw new Error("Unexpected Media ASR parse"); },
    parseMediaAsrTechWorkbook: () => { throw new Error("Unexpected technician parse"); },
    parseOpenRoSummaryWorkbook: () => { throw new Error("Unexpected Open RO summary parse"); },
    workbookGrid: () => ({ rows: [] }),
    dailyEvidenceDate: () => "2026-10-21",
    internalObservationDate: () => "",
    pruneDatedSnapshots: value => value,
    writeJson: async (_path, value) => { events.push("write"); durable = structuredClone(value); },
    readJson: async () => { events.push("readback"); return structuredClone(durable); },
    addHistory: async () => { events.push("history"); },
    removeSourceEntry: async name => { events.push("delete"); removed.push(name); }
  });
  vm.runInContext(managerImport + "\nthis.importManagerSource = importManagerSource;", context);
  return {
    model, events, removed, durable: () => durable,
    run: (name = "synthetic-efficiency (1).xlsx") => context.importManagerSource(name, "efficiency", [], true)
  };
}

test("equivalent Efficiency reimport ignores learned labels and derived metadata but verifies durable values", async () => {
  const f = fixture(equivalent);
  await f.run();
  const stored = f.durable().efficiency.snapshots["2026-10"];
  assert.equal(stored.store.clockHours, 120);
  assert.equal(stored.store.efficiency, 0.9);
  assert.equal(stored.coverageDate, "2026-10-21", "coverage is recomputed from the verified report evidence");
  assert.equal(stored.sourceModifiedAt, "2026-10-22T00:00:00.000Z");
  assert.deepEqual(f.events, ["write", "readback", "history", "delete"]);
  assert.deepEqual(f.removed, ["synthetic-efficiency (1).xlsx"]);
});


const savedMedia = {
  periodStart: "2026-10-01",
  periodEnd: "2026-10-21",
  sourceFile: "synthetic-media-asr.xlsx",
  importedAt: "2026-10-21T18:00:00.000Z",
  sourceModifiedAt: "2026-10-21T00:00:00.000Z",
  coverageDate: "2026-10-21",
  store: { roCount: 12, mediaCreated: 4, viewedByCustomer: 0.5 },
  advisors: { SYN01: { code: "SYN01", name: "Prior Synthetic Label", sourceName: "SYN01 - Synthetic Advisor", mediaCreated: 3 } },
  validation: { parser: "synthetic-media-asr-v1" }
};
const equivalentMedia = {
  validation: { parser: "synthetic-media-asr-v1" },
  advisors: { SYN01: { mediaCreated: 3, sourceName: "SYN01 - Synthetic Advisor", name: "Current Synthetic Label", code: "SYN01" } },
  store: { viewedByCustomer: 0.5, mediaCreated: 4, roCount: 12 },
  coverageDate: "2026-10-22",
  sourceModifiedAt: "2026-10-22T00:00:00.000Z",
  importedAt: "2026-10-22T18:00:00.000Z",
  sourceFile: "synthetic-media-asr (1).xlsx",
  periodEnd: "2026-10-21",
  periodStart: "2026-10-01"
};

function mediaFixture(candidate) {
  const model = { settings: { advisors: { SYN01: { name: "Configured Synthetic Label" } } },
    operationalMetrics: { mediaAsr: { snapshots: { "2026-10-21": structuredClone(savedMedia) } } } };
  let durable = structuredClone(model.operationalMetrics);
  const parsed = structuredClone(candidate);
  const events = [];
  const removed = [];
  const context = vm.createContext({
    model, structuredClone,
    OPERATIONAL_METRICS_PATH: ["data", "operational-metrics.json"],
    now: () => "2026-10-23T12:00:00.000Z",
    localDateKey: () => "2026-10-23",
    sourceFileHandle: async () => ({ getFile: async () => ({ lastModified: Date.UTC(2026, 9, 22) }) }),
    parseSorWorkbook: () => { throw new Error("Unexpected SOR parse"); },
    parseAppointmentActivityWorkbook: () => { throw new Error("Unexpected appointment parse"); },
    parseEfficiencyWorkbook: () => { throw new Error("Unexpected Efficiency parse"); },
    parseMediaAsrAdvisorWorkbook: () => structuredClone(parsed),
    parseMediaAsrTechWorkbook: () => { throw new Error("Unexpected technician parse"); },
    parseOpenRoSummaryWorkbook: () => { throw new Error("Unexpected Open RO summary parse"); },
    workbookGrid: () => ({ rows: [] }),
    dailyEvidenceDate: () => "2026-10-21",
    internalObservationDate: () => "",
    pruneDatedSnapshots: value => value,
    writeJson: async (_path, value) => { events.push("write"); durable = structuredClone(value); },
    readJson: async () => { events.push("readback"); return structuredClone(durable); },
    addHistory: async () => { events.push("history"); },
    removeSourceEntry: async name => { events.push("delete"); removed.push(name); }
  });
  vm.runInContext(managerImport + "\nthis.importManagerSource = importManagerSource;", context);
  return {
    model, events, removed, durable: () => durable,
    run: (name = "synthetic-media-asr (1).xlsx") => context.importManagerSource(name, "media-asr", [], true)
  };
}

test("equivalent Media ASR reimport ignores derived metadata and display labels while verifying durable values", async () => {
  const f = mediaFixture(equivalentMedia);
  await f.run();
  const stored = f.durable().mediaAsr.snapshots["2026-10-21"];
  assert.equal(stored.store.roCount, 12);
  assert.equal(stored.store.mediaCreated, 4);
  assert.equal(stored.coverageDate, "2026-10-21");
  assert.deepEqual(f.events, ["write", "readback", "history", "delete"]);
  assert.deepEqual(f.removed, ["synthetic-media-asr (1).xlsx"]);
});

test("conflicting Media ASR measurement is rejected before mutation and source deletion", async () => {
  const conflict = structuredClone(equivalentMedia);
  conflict.store.roCount = 13;
  const f = mediaFixture(conflict);
  const modelBefore = JSON.stringify(f.model.operationalMetrics);
  const diskBefore = JSON.stringify(f.durable());
  await assert.rejects(f.run("synthetic-conflicting-media-asr.xlsx"),
    /Conflicting media-asr report for period 2026-10-21 is already saved/);
  assert.equal(JSON.stringify(f.model.operationalMetrics), modelBefore, "saved Media ASR report remains unchanged");
  assert.equal(JSON.stringify(f.durable()), diskBefore, "no conflicting Media ASR snapshot is written");
  assert.deepEqual(f.events, [], "conflict fails before write, read-back, history, and deletion");
  assert.deepEqual(f.removed, [], "conflicting source remains available for review");
});

test("conflicting Efficiency measurements are rejected before mutation and source deletion", async () => {
  const conflict = structuredClone(equivalent);
  conflict.store.clockHours = 121;
  const f = fixture(conflict);
  const modelBefore = JSON.stringify(f.model.operationalMetrics);
  const diskBefore = JSON.stringify(f.durable());
  await assert.rejects(f.run("synthetic-conflicting-efficiency.xlsx"),
    /Conflicting efficiency report for period 2026-10 is already saved/);
  assert.equal(JSON.stringify(f.model.operationalMetrics), modelBefore, "previous verified Efficiency snapshot remains unchanged");
  assert.equal(JSON.stringify(f.durable()), diskBefore, "no conflicting snapshot is written");
  assert.deepEqual(f.events, [], "no durable write, success history, or deletion occurs");
  assert.deepEqual(f.removed, [], "conflicting source remains available for review");
});
