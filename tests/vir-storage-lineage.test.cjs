"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const parserStart = app.indexOf("  const VIR_NAME_CODES = {};");
const parserEnd = app.indexOf("  function virObservationDate(", parserStart);
const lineageStart = parserEnd;
const lineageEnd = app.indexOf("  function normalizeOperationalCoverage()", lineageStart);
assert.ok(parserStart >= 0 && parserEnd > parserStart, "Missing production VIR parser");
assert.ok(lineageEnd > lineageStart, "Missing production VIR storage and evidence path");
const parser = app.slice(parserStart, parserEnd);
const lineage = app.slice(lineageStart, lineageEnd);

test("synthetic VIR observation keeps its source date through durable storage and Meeting evidence", async () => {
  let durable = null;
  const model = { operationalMetrics: { vir: { snapshots: {}, pending: {} } } };
  const context = vm.createContext({
    ADVISOR_NAMES: { A1: "Demo Advisor" },
    model,
    text: value => String(value ?? ""),
    norm: value => String(value ?? "").trim().toLowerCase(),
    csvNumber: value => value === "" || value == null ? null : Number(value),
    parseCsv: value => value.trimEnd().split(/\r?\n/).map(line => line.split(",")),
    internalObservationDate: () => "2026-10-22",
    now: () => "2026-10-22T19:00:00.000Z",
    localDateKey: () => "2026-10-23",
    previousOperatingDateKey: () => "2026-10-22",
    meetingVirRosterCodes: () => ["A1"],
    sourceExpectation: () => "required",
    metricEvidence: evidence => ({ ...evidence, verified: ["verified", "known-zero"].includes(evidence.status) }),
    pruneDatedSnapshots: snapshots => snapshots,
    writeJson: async (_path, value) => { durable = structuredClone(value); },
    readJson: async () => structuredClone(durable),
    addHistory: async () => {},
    recordDiagnostic: () => {},
    renderOverviewIntelligence: () => {}
  });
  vm.runInContext(parser + "\n" + lineage + "\n" +
    'VIR_NAME_CODES["demo advisor"] = "A1"; this.parseVirCsv = parseVirCsv; this.saveVirSnapshot = saveVirSnapshot; this.latestVirObservation = latestVirObservation; this.virMeetingEvidence = virMeetingEvidence;',
    context);

  const csv = [
    "Report Date,2026-10-22",
    "Advisor Name,Total ROs,VIR Printed/Emailed/Texted,VIR Use %",
    "Demo Advisor,4,3,75"
  ].join("\n") + "\n";
  const snapshot = context.parseVirCsv(csv, "synthetic-vir.csv");
  snapshot.sourceModifiedAt = "2026-10-22T19:00:00.000Z";
  snapshot.observationTimestamp = "2026-10-22T12:00:00-07:00";
  await context.saveVirSnapshot(snapshot);

  const [key, stored] = Object.entries(durable.vir.snapshots)[0];
  assert.ok(key.startsWith("observation-"));
  assert.equal(stored.reportDate, "2026-10-22");
  assert.equal(stored.observationTimestamp, "2026-10-22T12:00:00-07:00");
  assert.equal(stored.coverageMethod, "vir-point-in-time");
  assert.equal(stored.validation.coverageBasis, "VIR source observation provenance");
  assert.equal(Object.hasOwn(stored, "effectiveDataThrough"), false);
  assert.equal(context.latestVirObservation().reportDate, "2026-10-22");

  const meeting = context.virMeetingEvidence();
  assert.equal(meeting.source, "VIR");
  assert.equal(meeting.period, "Observed 2026-10-22");
  assert.equal(meeting.value, 75);
  assert.equal(meeting.status, "verified");
});
