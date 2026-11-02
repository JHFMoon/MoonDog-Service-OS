"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function production(start, end, name) {
  const from = app.indexOf(start), to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, "Actual production " + name + " must exist");
  return app.slice(from, to);
}
const metric = production("  function metricEvidence({", "  function metricEvidenceText(", "evidence contract");
const vir = production("  function virCompletenessEvidence(", "  function virMeetingEvidence()", "VIR reconciliation");
const parser = production("  const VIR_NAME_CODES = {};", "  function virObservationDate(", "VIR import parser");

function sample(total = 4, used = 0, utilization = 0) {
  return {
    sourceFile: "synthetic-vir.csv",
    importedAt: "2026-11-02T18:00:00Z",
    reportDate: "2026-11-02",
    store: { totalROs: total, used, utilization },
    advisors: { A1: { code: "A1", totalROs: total, used, utilization } },
    ignored: []
  };
}
function inspect(snapshot, options = {}, stale = false) {
  const ctx = vm.createContext({
    meetingVirRosterCodes: () => ["A1"],
    localDateKey: () => "2026-11-02",
    virObservationDate: item => item.reportDate,
    virObservationIsStale: () => stale,
    virObservationTime: () => 0,
    allVirObservations: () => [snapshot],
    text: value => String(value ?? "")
  });
  vm.runInContext(metric + "\n" + vir + "\nthis.inspectVir=virCompletenessEvidence;", ctx);
  return ctx.inspectVir(snapshot, "2026-11-02", options);
}
function parsedVir(csvRow) {
  const ctx = vm.createContext({
    ADVISOR_NAMES: { A1: "Synthetic Advisor" },
    text: value => String(value ?? ""),
    norm: value => String(value ?? "").trim().toLowerCase(),
    csvNumber: value => value === "" || value == null ? null : Number(value),
    parseCsv: value => value.trimEnd().split(/\r?\n/).map(line => line.split(",")),
    internalObservationDate: () => "2026-11-02",
    now: () => "2026-11-02T18:00:00Z"
  });
  vm.runInContext(parser + '\nVIR_NAME_CODES["synthetic advisor"]="A1";this.parse=parseVirCsv;', ctx);
  const csv = ["Report Date,2026-11-02",
    "Advisor Name,Total ROs,VIR Printed/Emailed/Texted,VIR Use %",
    csvRow].join("\n") + "\n";
  return ctx.parse(csv, "synthetic-vir.csv");
}

test("actual VIR parser stores a null weighted utilization when no eligible ROs exist", () => {
  const snap = parsedVir("Synthetic Advisor,0,0,0");
  assert.equal(snap.store.totalROs, 0);
  assert.equal(snap.store.used, 0);
  assert.equal(snap.store.utilization, null, "zero denominator is NOT 0% utilization");
  const before = JSON.stringify(snap);
  const evidence = inspect(snap);
  assert.equal(evidence.status, "not-applicable");
  assert.equal(evidence.verified, false);
  assert.equal(evidence.value, null);
  assert.match(evidence.reason, /no denominator/i);
  assert.equal(JSON.stringify(snap), before, "evidence must not mutate imported source");
});

test("actual parsed VIR with positive denominator and zero use remains verified zero", () => {
  const snap = parsedVir("Synthetic Advisor,4,0,0");
  const evidence = inspect(snap);
  assert.equal(evidence.status, "known-zero");
  assert.equal(evidence.verified, true);
  assert.equal(evidence.value, 0);
  assert.equal(evidence.period, "Observed 2026-11-02");
});

test("actual parsed VIR with positive use and complete denominator remains verified", () => {
  const snap = parsedVir("Synthetic Advisor,4,3,75");
  const evidence = inspect(snap);
  assert.equal(evidence.status, "verified");
  assert.equal(evidence.value, 75);
  assert.match(evidence.reconciliation, /PASS/);
});

test("missing, blank, boolean or nonfinite advisor measurements cannot become source zero", () => {
  const invalid = [undefined, null, "", " ", "0", false, Number.NaN, Infinity];
  for (const field of ["totalROs", "used", "utilization"]) {
    for (const raw of invalid) {
      const snap = sample();
      if (raw === undefined) delete snap.advisors.A1[field];
      else snap.advisors.A1[field] = raw;
      const before = JSON.stringify(snap);
      const evidence = inspect(snap);
      assert.equal(evidence.status, "data-mismatch", "advisor " + field + " should not coerce " + String(raw));
      assert.equal(evidence.verified, false);
      assert.equal(evidence.value, null);
      assert.equal(JSON.stringify(snap), before);
    }
  }
});

test("unrecognized extra row with invalid numeric source cannot reconcile by coercion", () => {
  for (const field of ["totalROs", "used", "utilization"]) {
    const snap = sample();
    snap.ignored = [{ totalROs: 2, used: 0, utilization: 0 }];
    snap.store.totalROs = 6;
    snap.ignored[0][field] = null;
    const evidence = inspect(snap);
    assert.equal(evidence.status, "data-mismatch");
    assert.equal(evidence.verified, false);
  }
});

test("store counts must be genuine finite nonnegative source numbers", () => {
  for (const field of ["totalROs", "used"]) {
    for (const value of [null, "", "0", false, Number.NaN, Infinity, -1]) {
      const snap = sample();
      snap.store[field] = value;
      const evidence = inspect(snap);
      assert.equal(evidence.status, "data-mismatch", "invalid store " + field + " " + String(value));
      assert.equal(evidence.value, null);
      assert.equal(evidence.verified, false);
    }
  }
});

test("missing or invalid store percentage with positive denominator is not verified", () => {
  for (const value of [null, undefined, "", "0", false, Number.NaN, Infinity]) {
    const snap = sample(4, 0, 0);
    if (value === undefined) delete snap.store.utilization;
    else snap.store.utilization = value;
    const evidence = inspect(snap);
    assert.equal(evidence.status, "data-mismatch");
    assert.equal(evidence.verified, false);
    assert.equal(evidence.value, null);
  }
});

test("zero-denominator historical records cannot invent 0% from missing or numeric store percentage", () => {
  for (const reported of [0, "0", undefined, false, ""]) {
    const snap = sample(0, 0, 0);
    if (reported === undefined) delete snap.store.utilization;
    else snap.store.utilization = reported;
    const evidence = inspect(snap, { requireFreshness: false });
    assert.equal(evidence.status, "data-mismatch");
    assert.equal(evidence.verified, false);
  }
});

test("stale numeric VIR remains stale and never becomes current merely because it reconciles", () => {
  const evidence = inspect(sample(4, 0, 0), {}, true);
  assert.equal(evidence.status, "stale");
  assert.equal(evidence.verified, false);
  assert.equal(evidence.value, null);
});

test("missing VIR and missing configured advisor preserve existing authority errors", () => {
  assert.equal(inspect(null).status, "missing-source");
  const snap = sample();
  delete snap.advisors.A1;
  assert.equal(inspect(snap).status, "parser-error");
});
