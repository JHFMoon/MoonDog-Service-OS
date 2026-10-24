"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function extract(startToken, endToken, label) {
  const start = app.indexOf(startToken);
  const end = app.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0 && end > start, "Missing production " + label);
  return app.slice(start, end);
}

const dateHelpers = extract(
  "  function internalObservationDate(",
  "  function dailyEvidenceDate(",
  "SOR source-date helpers"
);
const dailyEvidence = extract(
  "  function dailyEvidenceDate(",
  "  function dailySourceCoverage(",
  "daily evidence selector"
);
const importer = extract(
  "  function comparableManagerSnapshot(",
  "  async function classifyImportFile(",
  "manager-source comparison and importer"
);

function snapshot(totalGross = 1200) {
  return {
    period: "2026-10",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    sourceFile: "synthetic-sor-original.xlsx",
    importedAt: "2026-10-21T18:00:00.000Z",
    financialMonth: "2026-10",
    store: { totalGross, totalRO: 5 },
    advisors: { SYN01: { code: "SYN01", name: "Synthetic Advisor", totalGross, totalRO: 5 } },
    validation: { totalsVerified: true }
  };
}

function fixture() {
  const model = { operationalMetrics: {}, settings: {} };
  let activeSnapshot = snapshot();
  let modifiedAt = "2026-10-21T18:00:00.000Z";
  let durable = {};
  const events = [];
  const history = [];
  const context = vm.createContext({
    text: value => String(value ?? ""),
    model,
    structuredClone,
    OPERATIONAL_METRICS_PATH: ["data", "operational-metrics.json"],
    localDateKey: () => "2026-10-24",
    now: () => "2026-10-24T18:00:00.000Z",
    workbookGrid: () => ({ rows: [["Report Date", "2026-10-20"], ["Financial Month", "2026-10"]] }),
    sourceFileHandle: async () => ({
      getFile: async () => ({ lastModified: Date.parse(modifiedAt) })
    }),
    parseSorWorkbook: () => structuredClone(activeSnapshot),
    parseAppointmentActivityWorkbook: () => { throw new Error("Unexpected appointment-activity parse."); },
    parseEfficiencyWorkbook: () => { throw new Error("Unexpected Efficiency parse."); },
    parseMediaAsrAdvisorWorkbook: () => { throw new Error("Unexpected Media ASR parse."); },
    parseMediaAsrTechWorkbook: () => { throw new Error("Unexpected Media ASR technician parse."); },
    parseOpenRoSummaryWorkbook: () => { throw new Error("Unexpected Open RO summary parse."); },
    pruneDatedSnapshots: value => value,
    writeJson: async (_path, value) => { events.push("write"); durable = structuredClone(value); },
    readJson: async () => { events.push("readback"); return structuredClone(durable); },
    addHistory: async type => { events.push("history"); history.push(type); },
    removeSourceEntry: async () => { events.push("delete"); }
  });
  vm.runInContext(
    dateHelpers + "\n" + dailyEvidence + "\n" + importer +
      "\nthis.importForTest = importManagerSource;",
    context
  );
  return {
    model,
    events,
    history,
    durable: () => durable,
    setSnapshot(value, sourceModifiedAt) {
      activeSnapshot = structuredClone(value);
      modifiedAt = sourceModifiedAt;
    },
    run: sourceName => context.importForTest(sourceName, "sor", new Uint8Array(), false)
  };
}

test("equivalent SAPR reimport ignores refreshed derived metadata and keeps one verified period", async () => {
  const f = fixture();
  await f.run("synthetic-sor-original.xlsx");

  const reimport = snapshot();
  reimport.sourceFile = "synthetic-sor-reimport.xlsx";
  reimport.importedAt = "2026-10-24T18:00:00.000Z";
  f.setSnapshot(reimport, "2026-10-24T18:00:00.000Z");
  await f.run("synthetic-sor-reimport.xlsx");

  const persisted = f.durable().sor;
  assert.deepEqual(Object.keys(persisted.snapshots), ["2026-10"]);
  assert.deepEqual(Object.keys(persisted.dailySnapshots), ["2026-10-20"]);
  assert.equal(persisted.snapshots["2026-10"].store.totalGross, 1200);
  assert.equal(persisted.snapshots["2026-10"].coverageDate, "2026-10-20");
  assert.equal(persisted.snapshots["2026-10"].sourceFile, "synthetic-sor-reimport.xlsx");
  assert.equal(persisted.snapshots["2026-10"].sourceModifiedAt, "2026-10-24T18:00:00.000Z");
  assert.deepEqual(f.events, ["write", "readback", "history", "write", "readback", "history"]);
  assert.deepEqual(f.history, ["sor-import", "sor-import"]);
  assert.equal(JSON.stringify(f.model.operationalMetrics.sor), JSON.stringify(persisted),
    "the in-memory SOR snapshot must equal its verified durable read-back");
});

test("conflicting SAPR measurement for the same observed date fails before mutation", async () => {
  const f = fixture();
  await f.run("synthetic-sor-original.xlsx");
  const beforeModel = JSON.stringify(f.model.operationalMetrics);
  const beforeDisk = JSON.stringify(f.durable());
  const beforeEvents = [...f.events];
  const conflict = snapshot(1700);
  conflict.sourceFile = "synthetic-sor-conflicting.xlsx";
  conflict.importedAt = "2026-10-24T18:00:00.000Z";
  f.setSnapshot(conflict, "2026-10-24T18:00:00.000Z");

  await assert.rejects(
    f.run("synthetic-sor-conflicting.xlsx"),
    /Conflicting sor report for period 2026-10-20 is already saved/
  );

  assert.equal(JSON.stringify(f.model.operationalMetrics), beforeModel,
    "the existing authoritative SOR snapshot remains unchanged");
  assert.equal(JSON.stringify(f.durable()), beforeDisk,
    "conflicting source measurements do not replace durable data");
  assert.deepEqual(f.events, beforeEvents,
    "a conflict is rejected before write, read-back, history, or source deletion");
  assert.deepEqual(f.history, ["sor-import"]);
});
