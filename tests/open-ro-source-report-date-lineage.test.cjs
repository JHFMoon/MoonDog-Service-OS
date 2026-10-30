"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const importStart = app.indexOf("  async function importSourceUnlocked(");
const importEnd = app.indexOf("\n\n  const timeMinutes", importStart);
const dateStart = app.indexOf("  function internalObservationDate(rows) {");
const dateEnd = app.indexOf("  function coverageTimestamp(value)", dateStart);
assert.ok(importStart >= 0 && importEnd > importStart, "production Open RO source importer exists");
assert.ok(dateStart >= 0 && dateEnd > dateStart, "production Open RO report-date parser exists");

const productionImporter = app.slice(importStart, importEnd);
const productionDateParser = app.slice(dateStart, dateEnd);

function fixture(rows) {
  const workbook = { SheetNames: ["Synthetic"], Sheets: { Synthetic: {} } };
  const imported = [{ id: "synthetic-ro-601", ro: "SYN-601", advisorCode: "SYN-A" }];
  const state = { records: [], closedRecords: [] };
  const history = [];
  const retained = [];
  const writes = [];
  const fileModifiedAt = Date.parse("2026-10-22T12:00:00.000Z");
  const context = vm.createContext({
    model: { state },
    ui: { sourceSelect: { value: "synthetic-open-ro.xlsx" } },
    STATE_PATH: ["data", "current-state.json"],
    XLSX: {
      read: () => workbook,
      utils: { sheet_to_json: () => rows }
    },
    prepareXlsxWorkbook: async () => workbook,
    sourceFileHandle: async () => ({
      getFile: async () => ({
        lastModified: fileModifiedAt,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
      })
    }),
    workbookIsHandoff: () => false,
    workbookHasReturnSchema: () => false,
    workbookHasReturnIdentity: () => false,
    legacyReport: () => null,
    findTable: () => ({ sheetName: "Synthetic", rows: [["SYN-601", "Working"]] }),
    rawRecord: () => ({ ...imported[0] }),
    verifyCompleteRoImport: async () => ({ verified: true, sha256: "a".repeat(64) }),
    reconcileRecordSourceIdentity() {},
    now: () => "2026-10-26T12:00:00.000Z",
    mergeCompleteOpenRoRecords: incoming => ({
      records: incoming,
      closedRecords: [],
      closedCount: 0,
      reopenedCount: 0
    }),
    markOpenRoManualReviewComplete: async () => false,
    markSupervisorWorkbookStale: async () => writes.push("stale"),
    backupState: async () => writes.push("backup"),
    writeBytes: async () => writes.push("raw-copy"),
    writeJson: async (path, value) => {
      writes.push("state");
      return value;
    },
    stamp: () => "2026-10-26T12-00-00",
    slug: value => value,
    retainDailyReport: async (key, value) => retained.push({ key, value }),
    coverageTimestamp: () => "2026-10-22",
    saveOpenRoWorkload: async () => writes.push("workload"),
    openRoWorkloadSnapshot: records => records,
    ensureDailyFocus: async () => {},
    addHistory: async (type, message, details) => history.push({ type, message, details }),
    renderAll() {},
    status() {},
    dailyPickedSources: new Set(["synthetic-open-ro.xlsx"]),
    window: { confirm: () => { throw new Error("fixture must keep the synthetic source"); } },
    text: value => String(value ?? ""),
    workbookDate: value => value instanceof Date ? value.toISOString().slice(0, 10) : ""
  });
  vm.runInContext(
    productionDateParser + "\n" + productionImporter + "\nglobalThis.runImport = importSourceUnlocked;",
    context
  );
  return { context, history, retained, writes, fileModifiedAt };
}

test("explicit Open RO report date survives source persistence and import audit history", async () => {
  const data = fixture([
    ["Report Date", "10/21/2026"],
    ["RO", "Status"],
    ["SYN-601", "Working"]
  ]);
  await data.context.runImport("synthetic-open-ro.xlsx", false, new Uint8Array([1, 2, 3]));

  const source = JSON.parse(JSON.stringify(data.context.model.state.source));
  const report = JSON.parse(JSON.stringify(data.retained[0].value));
  const event = JSON.parse(JSON.stringify(data.history[0]));

  assert.equal(source.reportDate, "2026-10-21",
    "the accepted source metadata retains the report's explicit observation date");
  assert.equal(event.type, "source-import");
  assert.equal(event.details.reportDate, "2026-10-21",
    "the durable source-import audit records the report date rather than import/file time");
  assert.equal(report.coverageDate, "2026-10-21");
  assert.deepEqual(data.writes, ["stale", "backup", "raw-copy", "state", "workload"]);
});

test("an undated Open RO source stays explicitly unknown while existing daily fallback remains intact", async () => {
  const data = fixture([
    ["RO", "Status"],
    ["SYN-601", "Working"]
  ]);
  await data.context.runImport("synthetic-open-ro.xlsx", false, new Uint8Array([1, 2, 3]));

  const source = JSON.parse(JSON.stringify(data.context.model.state.source));
  const report = JSON.parse(JSON.stringify(data.retained[0].value));
  const event = JSON.parse(JSON.stringify(data.history[0]));

  assert.equal(source.reportDate, null, "unknown report dates are not fabricated from import metadata");
  assert.equal(event.details.reportDate, null, "the audit distinguishes an undated source");
  assert.equal(report.coverageDate, "2026-10-22",
    "existing file-modified-date fallback for the retained daily report is unchanged");
});

function productionOpenRoFreshness(source) {
  const start = app.indexOf("  function sourceFreshness(");
  const end = app.indexOf("  function metricDependencyEvidence(", start);
  assert.ok(start >= 0 && end > start, "production source freshness adapter exists");
  const freshness = require("../assets/freshness.js");
  const context = vm.createContext({
    freshness,
    model: { state: { source } },
    sourceExpectation: () => "recommended",
    businessTimeZone: () => "UTC",
    localDateKey: value => value instanceof Date
      ? value.toISOString().slice(0, 10) : "2026-10-26"
  });
  vm.runInContext(app.slice(start, end) + "\\nthis.sourceFreshness = sourceFreshness;", context);
  return context.sourceFreshness("openRo", { today: "2026-10-26" });
}

test("verified Open RO report date wins over a newer import timestamp across production import and source freshness", async () => {
  const data = fixture([
    ["Report Date", "10/21/2026"],
    ["RO", "Status"],
    ["SYN-601", "Working"]
  ]);
  await data.context.runImport("synthetic-open-ro.xlsx", false, new Uint8Array([1, 2, 3]));
  const savedSource = data.context.model.state.source;
  assert.equal(savedSource.importedAt, "2026-10-26T12:00:00.000Z");

  const evidence = productionOpenRoFreshness(savedSource);
  assert.equal(evidence.status, "stale", "importing an older report today must not make its coverage current");
  assert.equal(evidence.safeForCurrent, false);
  assert.equal(evidence.periodEnd, "2026-10-21");
  assert.equal(evidence.reportPeriodVerified, true);
  assert.match(evidence.reason, /2026-10-21/);

  const current = productionOpenRoFreshness({
    ...savedSource, reportDate: "2026-10-26"
  });
  assert.equal(current.status, "current", "a verified current-date report remains current");

  const undated = productionOpenRoFreshness({
    ...savedSource, reportDate: null
  });
  assert.equal(undated.status, "current", "legacy undated sources retain their import-time fallback");
  assert.equal(undated.reportPeriodVerified, false,
    "legacy import time must not fabricate a verified report period");
});
