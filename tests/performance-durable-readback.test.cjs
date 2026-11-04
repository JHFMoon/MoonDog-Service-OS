"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  async function importPerformanceFile(");
const end = app.indexOf("  function performanceFormat(", start);
assert.ok(start >= 0 && end > start, "Real production performance importer is testable");
const importer = app.slice(start, end);

function fixture(mode = "verified") {
  const name = "synthetic-performance.xlsx";
  const previous = {snapshots: {
    "2026-10-20": {date: "2026-10-20", total: 15, advisors: {"101": {gross: 15}}}
  }, updatedAt: "previous"};
  const snapshot = {date: "2026-10-21", periodEnd: "2026-10-21", total: 20,
    advisors: {"101": {gross: 20}}, validation: {source: "synthetic"},
    sourceStoreConfidence: "configured-destination-only"};
  const model = {performance: structuredClone(previous)};
  const events = [];
  let disk = structuredClone(previous);
  const context = {
    model, structuredClone, sourceLocations: new Map(),
    ui: {performanceSourceSelect: {value: name}},
    PERFORMANCE_PATH: ["data", "performance.json"],
    sourceFileHandle: async () => ({getFile: async () => ({arrayBuffer: async () => new ArrayBuffer(2)})}),
    parsePerformanceWorkbook: () => structuredClone(snapshot),
    prunePerformanceSnapshots: value => value,
    now: () => "2026-10-21T12:00:00Z",
    status: (message, level) => events.push("status:" + level),
    writeJson: async (_path, value) => {
      events.push("write");
      if (mode === "write-denied") throw new Error("synthetic write denied");
      disk = structuredClone(value);
    },
    readJson: async () => {
      events.push("readback");
      if (mode === "read-denied") throw new Error("synthetic read denied");
      if (mode === "stale") return structuredClone(previous);
      if (mode === "snapshot-mismatch") {
        const altered = structuredClone(disk);
        altered.snapshots[snapshot.date].advisors["101"].gross = 999;
        return altered;
      }
      if (mode === "metadata-mismatch") {
        const altered = structuredClone(disk);
        altered.updatedAt = "old metadata";
        return altered;
      }
      if (mode === "lost-prior-day") {
        const altered = structuredClone(disk);
        delete altered.snapshots["2026-10-20"];
        return altered;
      }
      return structuredClone(disk);
    },
    addHistory: async type => events.push("history:" + type),
    renderPerformance: () => events.push("render"),
    dailyPickedSources: new Set([name]),
    window: {confirm: () => {events.push("review-confirm"); return mode !== "review-denied";}},
    removeSourceEntry: async () => events.push("delete-source"),
    scanFiles: async () => events.push("scan-files"),
    scanAppointmentFiles: async () => events.push("scan-appointments"),
    scanPerformanceFiles: async () => events.push("scan-performance")
  };
  vm.runInNewContext(importer + "\nthis.productionImporter = importPerformanceFile;", context);
  return {
    run: deleteSource => context.productionImporter(name, deleteSource),
    model, previous, snapshot, events,
    disk: () => disk
  };
}

test("production SAPR import verifies the full durable payload before reporting success", async () => {
  const f = fixture();
  await f.run(false);
  assert.deepEqual(f.disk().snapshots[f.snapshot.date], f.snapshot);
  assert.equal(f.model.performance.updatedAt, "2026-10-21T12:00:00Z");
  assert.deepEqual(f.events, ["status:working", "review-confirm", "write", "readback", "history:performance-import", "render", "status:success"]);
});

test("source removal is allowed only after a successful verified readback", async () => {
  const f = fixture();
  await f.run(true);
  assert.deepEqual(f.events, ["status:working", "review-confirm", "write", "readback", "history:performance-import", "render",
    "delete-source", "history:source-deleted", "scan-files", "scan-appointments", "scan-performance", "status:success"]);
});

for (const [mode, pattern] of [
  ["stale", /snapshots could not be verified/],
  ["snapshot-mismatch", /snapshots could not be verified/],
  ["metadata-mismatch", /snapshots could not be verified/],
  ["lost-prior-day", /snapshots could not be verified/],
  ["write-denied", /synthetic write denied/],
  ["read-denied", /synthetic read denied/]
]) {
  test("performance importer fails closed for " + mode, async () => {
    const f = fixture(mode);
    await assert.rejects(f.run(true), pattern);
    assert.deepEqual(f.model.performance, f.previous, "Previous trusted performance remains in memory");
    assert.ok(!f.events.some(event => event.startsWith("history:")), "No false success history");
    assert.ok(!f.events.includes("delete-source"), "Original SAPR workbook retained");
    assert.ok(!f.events.includes("render"), "Unverified performance does not refresh KPIs");
    assert.ok(!f.events.includes("status:success"), "No false saved indication");
  });
}


test("unsigned SAPR without manager confirmation never writes or promotes a performance metric", async () => {
  const f = fixture("review-denied");
  await assert.rejects(f.run(true), /not manually confirmed/);
  assert.deepEqual(f.model.performance, f.previous);
  assert.deepEqual(f.events, ["status:working", "review-confirm"]);
  assert.deepEqual(f.disk(), f.previous);
});

test("targeted performance importer remains syntax-valid and leaves source authority intact", () => {
  new vm.Script(app);
  assert.match(importer, /JSON\.stringify\(saved\) !== JSON\.stringify\(model\.performance\)/);
  assert.match(importer, /model\.performance = priorPerformance/);
  assert.match(importer, /await readJson\(PERFORMANCE_PATH, null\)/);
});
