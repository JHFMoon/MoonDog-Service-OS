"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const comparisonStart = app.indexOf("  function comparableManagerSnapshot(");
const comparisonEnd = app.indexOf("  function managerConflictObservationDate(", comparisonStart);
assert.ok(comparisonStart >= 0 && comparisonEnd > comparisonStart, "Shared report comparator exists");
const comparator = app.slice(comparisonStart, comparisonEnd);
const start = app.indexOf("  async function importMenuSalesFile(");
const end = app.indexOf("  const CSI_ADVISOR_CODES =", start);
assert.ok(start >= 0 && end > start, "Actual Menu Sales importer section changed; review test");
const importer = app.slice(start, end);

function fixture(mode = "verified") {
  const snapshot = {
    releaseWeek: "2026-10-19", periodStart: "2026-10-01", periodEnd: "2026-10-18",
    store: { roCount: 10 }, advisors: { "9001": { roCount: 10 } },
    validation: { parser: "synthetic-only" }, importedAt: "synthetic-current-import"
  };
  const priorSnapshot = { ...structuredClone(snapshot), importedAt: "synthetic-prior-import" };
  const old = { menu: { snapshots: { "2026-10-19": priorSnapshot } }, updatedAt: "prior-time" };
  const model = { operationalMetrics: structuredClone(old) };
  const events = [];
  let persisted = null;
  const ctx = {
    model, structuredClone,
    OPERATIONAL_METRICS_PATH: ["data", "operational-metrics.json"],
    sourceFileHandle: async () => ({ getFile: async () => ({ arrayBuffer: async () => new ArrayBuffer(2) }) }),
    parseMenuSalesWorkbook: () => structuredClone(snapshot),
    pruneDatedSnapshots: value => value,
    now: () => "2026-10-21T12:00:00Z",
    writeJson: async (file, value) => {
      events.push("write");
      if (mode === "write-denied") throw new Error("synthetic write denied");
      persisted = structuredClone(value);
    },
    readJson: async () => {
      events.push("readback");
      if (mode === "read-denied") throw new Error("synthetic read denied");
      if (mode === "stale") return structuredClone(old);
      if (mode === "mismatched") {
        const incorrect = structuredClone(persisted);
        incorrect.menu.snapshots["2026-10-19"].store.roCount = 999;
        return incorrect;
      }
      return structuredClone(persisted);
    },
    addHistory: async () => { events.push("history"); },
    removeSourceEntry: async () => { events.push("delete-source"); },
    renderOverviewIntelligence: () => { events.push("render"); }
  };
  vm.runInNewContext(comparator + "\n" + importer, ctx);
  return { run: () => ctx.importMenuSalesFile("synthetic-menu-sales.xlsx", true), model, old, snapshot, events, saved: () => persisted };
}

test("Menu parser upgrades do not make an identical previously saved report conflict",async()=>{
  const f=fixture();
  f.model.operationalMetrics.menu.snapshots["2026-10-19"].validation.parser="menu-sales-v2-store-identity";
  f.snapshot.validation.parser="menu-sales-v3-local-layout-store-identity";
  await f.run();
  assert.equal(f.saved().menu.snapshots["2026-10-19"].validation.parser,"menu-sales-v3-local-layout-store-identity");
  assert.deepEqual(f.model.operationalMetrics.menu.snapshots["2026-10-19"],f.snapshot);
  assert.deepEqual(f.events,["write","readback","history","delete-source","history","render"]);
});
test("actual Menu Sales importer deletes source only after exact durable read-back", async () => {
  const f = fixture();
  await f.run();
  assert.deepEqual(f.saved().menu.snapshots["2026-10-19"], f.snapshot);
  assert.deepEqual(f.model.operationalMetrics.menu.snapshots["2026-10-19"], f.snapshot);
  assert.deepEqual(f.events, ["write", "readback", "history", "delete-source", "history", "render"]);
});

for (const [mode, message] of [
  ["stale", /snapshot could not be verified/],
  ["mismatched", /snapshot could not be verified/],
  ["write-denied", /synthetic write denied/],
  ["read-denied", /synthetic read denied/]
]) {
  test("actual Menu Sales importer fails closed for " + mode + " persistence", async () => {
    const f = fixture(mode);
    await assert.rejects(f.run(), message);
    assert.deepEqual(f.model.operationalMetrics, f.old, "In-memory state must be restored after failure");
    assert.ok(!f.events.includes("history"), "No false success audit");
    assert.ok(!f.events.includes("delete-source"), "Unverified source retained");
    assert.ok(!f.events.includes("render"), "No unverified display refresh");
  });
}

test("Menu Sales persistence safety change stays localized and syntax-valid", () => {
  new vm.Script(app);
  assert.match(importer, /JSON\.stringify\(check\?\.menu\?\.snapshots\?\.\[snapshot\.releaseWeek\]\)/);
  assert.match(importer, /model\.operationalMetrics = priorMetrics/);
});
