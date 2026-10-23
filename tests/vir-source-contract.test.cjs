"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  const VIR_NAME_CODES = {};");
const end = app.indexOf("  function virObservationDate(", start);
assert.ok(start >= 0 && end > start, "Missing production VIR parser");
const parser = app.slice(start, end);

function parserContext() {
  const context = vm.createContext({
    ADVISOR_NAMES: { A1: "Demo Advisor" },
    text: value => String(value ?? ""),
    norm: value => String(value ?? "").trim().toLowerCase(),
    csvNumber: value => value === "" || value == null ? null : Number(value),
    parseCsv: value => value.trimEnd().split(/\r?\n/).map(line => line.split(",")),
    internalObservationDate: () => "2026-10-22",
    now: () => "2026-10-22T19:00:00.000Z"
  });
  vm.runInContext(parser + '\nVIR_NAME_CODES["demo advisor"] = "A1"; this.parseVirCsv = parseVirCsv;', context);
  return context;
}

test("synthetic VIR is a dated point-in-time observation, not period coverage", () => {
  const csv = [
    "Report Date,2026-10-22",
    "Advisor Name,Total ROs,VIR Printed/Emailed/Texted,VIR Use %",
    "Demo Advisor,4,3,75"
  ].join("\n") + "\n";
  const snapshot = parserContext().parseVirCsv(csv, "synthetic-vir.csv");

  assert.equal(snapshot.sourceFile, "synthetic-vir.csv");
  assert.equal(snapshot.reportDate, "2026-10-22");
  assert.equal(snapshot.periodModel, "point-in-time observation; VIR source provenance only");
  assert.equal(snapshot.store.totalROs, 4);
  assert.equal(snapshot.store.used, 3);
  assert.equal(snapshot.store.utilization, 75);
  assert.equal(snapshot.advisors.A1.utilization, 75);
  assert.equal(snapshot.validation.reconciledPercentages, true);
  assert.equal(Object.hasOwn(snapshot, "effectiveDataThrough"), false);
});

test("synthetic duplicate VIR advisor identities fail closed", () => {
  const csv = [
    "Report Date,2026-10-22",
    "Advisor Name,Total ROs,VIR Printed/Emailed/Texted,VIR Use %",
    "Demo Advisor,4,3,75",
    "Demo Advisor,2,1,50"
  ].join("\n") + "\n";

  assert.throws(
    () => parserContext().parseVirCsv(csv, "synthetic-vir-duplicate.csv"),
    /duplicate advisor\/source identity/
  );
});

test("synthetic VIR utilization must reconcile to source row counts", () => {
  const csv = [
    "Report Date,2026-10-22",
    "Advisor Name,Total ROs,VIR Printed/Emailed/Texted,VIR Use %",
    "Demo Advisor,4,3,70"
  ].join("\n") + "\n";

  assert.throws(
    () => parserContext().parseVirCsv(csv, "synthetic-vir-mismatch.csv"),
    /does not reconcile/
  );
});
