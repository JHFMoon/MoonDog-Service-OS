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

const dateHelpers = extract("  function internalObservationDate(", "  function dailyEvidenceDate(", "source observation date helpers");
const dailyEvidence = extract("  function dailyEvidenceDate(", "  function dailySourceCoverage(", "daily evidence selector");
const comparison = extract("  function comparableManagerSnapshot(", "  async function importManagerSource(", "report comparison");
const importer = extract("  async function importManagerSource(", "  async function classifyImportFile(", "manager source import");

function fixture(snapshot, { sourceModifiedAt, rows }) {
  const model = { operationalMetrics: {}, settings: {} };
  let durable = {};
  const history = [];
  const context = vm.createContext({
    text: value => String(value ?? ""),
    model,
    structuredClone,
    OPERATIONAL_METRICS_PATH: ["data", "operational-metrics.json"],
    localDateKey: value => value instanceof Date ? value.toISOString().slice(0, 10) : "2026-10-24",
    now: () => "2026-10-24T18:00:00.000Z",
    workbookGrid: () => ({ rows }),
    sourceFileHandle: async () => ({
      getFile: async () => ({ lastModified: Date.parse(sourceModifiedAt) })
    }),
    parseSorWorkbook: () => structuredClone(snapshot),
    pruneDatedSnapshots: value => value,
    writeJson: async (_path, value) => { durable = structuredClone(value); },
    readJson: async () => structuredClone(durable),
    addHistory: async (type, message, details) => { history.push({ type, message, details }); },
    removeSourceEntry: async () => { throw new Error("This regression never deletes its synthetic source."); }
  });
  vm.runInContext(
    dateHelpers + "\n" + dailyEvidence + "\n" + comparison + "\n" + importer +
      "\nthis.api = { importManagerSource, dailyEvidenceDate };",
    context
  );
  return { context, model, durable: () => durable, history };
}

test("SOR report observation date survives production import, durable readback, and daily coverage selection", async () => {
  const snapshot = {
    period: "2026-10",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    sourceFile: "synthetic-sor.xlsx",
    financialMonth: "2026-10",
    store: { totalGross: 1200, totalRO: 5 },
    advisors: { SYN01: { totalGross: 1200, totalRO: 5 } },
    validation: { totalsVerified: true }
  };
  const f = fixture(snapshot, {
    sourceModifiedAt: "2026-10-24T18:00:00.000Z",
    rows: [["Report Date", "2026-10-20"], ["Financial Month", "2026-10"]]
  });

  await f.context.api.importManagerSource("synthetic-sor.xlsx", "sor", new Uint8Array(), false);

  const saved = f.durable().sor.snapshots["2026-10"];
  assert.ok(saved, "The production importer must durably retain the SOR snapshot.");
  assert.equal(saved.coverageDate, "2026-10-20", "the explicit report date, not file modification time, is the observation");
  assert.equal(saved.sourceModifiedAt, "2026-10-24T18:00:00.000Z", "file time remains separate source metadata");
  assert.equal(f.durable().sor.dailySnapshots["2026-10-20"].coverageDate, "2026-10-20");
  assert.equal(f.context.api.dailyEvidenceDate("sor", saved), "2026-10-20");
  assert.deepEqual(f.history.map(item => item.type), ["sor-import"]);
});

test("month-only SOR with an out-of-period file timestamp does not fabricate daily coverage", async () => {
  const snapshot = {
    period: "2026-10",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    sourceFile: "synthetic-sor-month-only.xlsx",
    financialMonth: "2026-10",
    importedAt: "2026-10-24T18:00:00.000Z",
    store: { totalGross: 1200, totalRO: 5 },
    advisors: { SYN01: { totalGross: 1200, totalRO: 5 } },
    validation: { totalsVerified: true }
  };
  const f = fixture(snapshot, {
    sourceModifiedAt: "2026-11-02T18:00:00.000Z",
    rows: [["Financial Month", "2026-10"]]
  });

  await f.context.api.importManagerSource("synthetic-sor-month-only.xlsx", "sor", new Uint8Array(), false);

  const saved = f.durable().sor.snapshots["2026-10"];
  assert.ok(saved, "The monthly SOR snapshot remains available for period reporting.");
  assert.equal(saved.coverageDate, "", "a financial-month label and importedAt cannot replace an in-period observation date");
  assert.deepEqual(Object.keys(f.durable().sor.dailySnapshots || {}), []);
  assert.equal(f.context.api.dailyEvidenceDate("sor", saved), "");
  assert.equal(f.history.length, 1);
});
