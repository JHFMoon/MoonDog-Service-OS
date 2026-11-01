"use strict";

// #59-01: An explicitly dated but invalid VIR report must not borrow the
// source file's modification date to become a trusted observation.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function extract(begin, end, name) {
  const start = app.indexOf(begin), stop = app.indexOf(end, start + begin.length);
  assert.ok(start >= 0 && stop > start, "Missing production " + name);
  return app.slice(start, stop);
}

const dateAdapter = extract("  function internalObservationDate(", "  function dailyEvidenceDate(", "source date adapter");
const virParser = extract("  const VIR_NAME_CODES = {};", "  function virObservationDate(", "VIR parser");
const virImporter = extract("  async function importVirFile(", "  function normalizeOperationalCoverage(", "VIR importer");

function virCsv(metadata = "") {
  return [metadata, "Advisor Name,Total ROs,VIR Printed/Emailed/Texted,VIR Use %",
    "Synthetic Advisor,4,3,75"].filter(Boolean).join("\n") + "\n";
}

function harness(source) {
  const writes = [];
  const ctx = vm.createContext({
    text: value => String(value ?? ""),
    norm: value => String(value ?? "").trim().toLowerCase(),
    parseCsv: value => String(value).trimEnd().split(/\r?\n/).map(row => row.split(",")),
    csvNumber: value => value == null || String(value).trim() === "" ? null : Number(value),
    workbookDate: value => String(value),
    ADVISOR_NAMES: { SYN: "Synthetic Advisor" },
    now: () => "2026-11-01T13:00:00.000Z",
    sourceLocations: new Map(),
    sourceFileHandle: async () => ({ getFile: async () => ({
      text: async () => source,
      lastModified: Date.UTC(2026, 10, 1)
    }) }),
    saveVirSnapshot: async () => { writes.push("save"); return { resolved: true }; },
    removeSourceEntry: async () => { writes.push("delete"); },
    addHistory: async () => { writes.push("history"); }
  });
  vm.runInContext(dateAdapter + "\n" + virParser + "\n" + virImporter +
    '\nVIR_NAME_CODES["synthetic advisor"] = "SYN";' +
    "\nthis.parseVirCsv = parseVirCsv; this.importVirFile = importVirFile;", ctx);
  return { ctx, writes };
}

test("production VIR parser rejects explicitly invalid calendar dates rather than replacing them with import time", () => {
  for (const metadata of [
    "Report Date,02/30/2026",
    "Report Date:02/30/2026",
    "Report Date,2026-02-29",
    "As Of,13/01/2026",
    "Observation Date,",
    "Report Date,2026-04-31"
  ]) {
    const { ctx } = harness(virCsv(metadata));
    assert.throws(
      () => ctx.parseVirCsv(virCsv(metadata), "synthetic-vir.csv"),
      /invalid explicit observation date/,
      metadata
    );
  }
});

test("production VIR parser retains verified explicit dates, including leap day", () => {
  for (const [metadata, expected] of [
    ["Report Date,02/29/2028", "2028-02-29"],
    ["Report Date:02/29/2028", "2028-02-29"],
    ["As Of,2026-11-01", "2026-11-01"],
    ["Observation Date,10/22/2026", "2026-10-22"]
  ]) {
    const { ctx } = harness(virCsv(metadata));
    const snapshot = ctx.parseVirCsv(virCsv(metadata), "synthetic-vir.csv");
    assert.equal(snapshot.reportDate, expected, metadata);
    assert.equal(snapshot.store.totalROs, 4);
    assert.equal(snapshot.store.used, 3);
  }
});

test("genuinely undated VIR reports retain optional observation fallback", () => {
  const { ctx } = harness(virCsv());
  const snapshot = ctx.parseVirCsv(virCsv(), "synthetic-vir.csv");
  assert.equal(snapshot.reportDate, "");
  assert.equal(snapshot.store.utilization, 75);
});

test("invalid explicitly dated VIR cannot reach persistence or source deletion", async () => {
  const source = virCsv("Report Date:02/30/2026");
  const { ctx, writes } = harness(source);
  await assert.rejects(ctx.importVirFile("synthetic-vir.csv", true),
    /invalid explicit observation date/);
  assert.deepEqual(writes, [], "invalid dated VIR must not save, record history, or delete its source");
});
