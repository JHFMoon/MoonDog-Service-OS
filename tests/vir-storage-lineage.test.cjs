"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const parserStart = app.indexOf("  const VIR_NAME_CODES = {};");
const parserEnd = app.indexOf("  function virObservationDate(", parserStart);
const lineageEnd = app.indexOf("  function normalizeOperationalCoverage()", parserEnd);
const evidenceStart = app.indexOf("  function virCompletenessEvidence(", lineageEnd);
const evidenceEnd = app.indexOf("  function virMeetingEvidence(", evidenceStart);
const meetingStart = evidenceEnd;
const meetingEnd = app.indexOf("  function virMeetingWindowComparison(", meetingStart);
assert.ok(parserStart >= 0 && parserEnd > parserStart, "Missing production VIR parser");
assert.ok(lineageEnd > parserEnd && evidenceEnd > evidenceStart && meetingEnd > meetingStart,
  "Missing production VIR storage or Meeting evidence path");
const parser = app.slice(parserStart, parserEnd);
const lineage = app.slice(parserEnd, lineageEnd);
const evidence = app.slice(evidenceStart, evidenceEnd);
const meetingEvidence = app.slice(meetingStart, meetingEnd);

test("synthetic VIR observation keeps its source date through durable storage and Meeting evidence", async () => {
  let durable = null;
  const events = [];
  const history = [];
  const model = { operationalMetrics: { vir: { snapshots: {}, pending: {} } } };
  const context = vm.createContext({
    ADVISOR_NAMES: { A1: "Demo Advisor" },
    structuredClone,
    model,
    OPERATIONAL_METRICS_PATH: ["data", "operational-metrics.json"],
    text: value => String(value ?? ""),
    norm: value => String(value ?? "").trim().toLowerCase(),
    csvNumber: value => value === "" || value == null ? null : Number(value),
    parseCsv: value => value.trimEnd().split(/\r?\n/).map(line => line.split(",")),
    internalObservationDate: () => "2026-10-22",
    now: () => "2026-10-22T19:00:00.000Z",
    localDateKey: date => date ? date.toISOString().slice(0, 10) : "2026-10-23",
    previousOperatingDateKey: () => "2026-10-22",
    meetingVirRosterCodes: () => ["A1"],
    sourceExpectation: () => "required",
    metricEvidence: evidence => ({ ...evidence, verified: ["verified", "known-zero"].includes(evidence.status) }),
    pruneDatedSnapshots: snapshots => snapshots,
    writeJson: async (_path, value) => { events.push("write"); durable = structuredClone(value); },
    readJson: async () => { events.push("readback"); return structuredClone(durable); },
    addHistory: async (...entry) => { events.push("history"); history.push(entry); },
    recordDiagnostic: () => {},
    renderOverviewIntelligence: () => {}
  });
  vm.runInContext(parser + "\n" + lineage + "\n" + evidence + "\n" + meetingEvidence + "\n" +
    'VIR_NAME_CODES["demo advisor"] = "A1"; this.parseVirCsv = parseVirCsv; this.saveVirSnapshot = saveVirSnapshot; this.latestVirObservation = latestVirObservation; this.virMeetingEvidence = virMeetingEvidence; this.virCompletenessEvidence = virCompletenessEvidence;',
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
  assert.deepEqual(events.slice(0, 3), ["write", "readback", "history"],
    "VIR source history must follow verified durable read-back");
  assert.deepEqual(history.map(([type, message, metadata]) => [type, message, { ...metadata }]), [[
    "vir-import",
    "Added independent VIR point-in-time observation",
    { fileName: "synthetic-vir.csv", observationDate: "2026-10-22", totalROs: 4 }
  ]], "VIR history must retain only the synthetic source, observation date, and calculation input");

  assert.equal(Object.hasOwn(stored, "effectiveDataThrough"), false);
  assert.equal(context.latestVirObservation().reportDate, "2026-10-22");

  const meeting = context.virMeetingEvidence();
  assert.equal(meeting.source, "VIR");
  assert.equal(meeting.period, "Observed 2026-10-22");
  assert.equal(meeting.value, 75);
  assert.equal(meeting.status, "verified");

  const future = structuredClone(stored);
  future.reportDate = "2026-10-24";
  future.observationTimestamp = "2026-10-24T12:00:00-07:00";
  const futureEvidence = context.virCompletenessEvidence(future, "2026-10-23", { expectedCodes: ["A1"] });
  assert.equal(futureEvidence.status, "stale", "future-dated VIR evidence must not be promoted as current");
  assert.equal(futureEvidence.verified, false);
  assert.equal(futureEvidence.period, "Observed 2026-10-24");
  assert.match(futureEvidence.reason, /future-dated/);
});


function failedReadbackFixture(mode) {
  const csv = [
    "Report Date,2026-10-22",
    "Advisor Name,Total ROs,VIR Printed/Emailed/Texted,VIR Use %",
    "Demo Advisor,4,3,75"
  ].join("\n") + "\n";
  const existing = {
    vir: {
      snapshots: { "prior-observation": { sourceFile: "synthetic-prior-vir.csv", store: { totalROs: 2, used: 1 } } },
      pending: {}
    },
    updatedAt: "2026-10-21T18:00:00.000Z"
  };
  const model = { operationalMetrics: structuredClone(existing) };
  let durable = structuredClone({ operationalMetrics: existing });
  const events = [];
  const history = [];
  const context = vm.createContext({
    ADVISOR_NAMES: { A1: "Demo Advisor" },
    structuredClone,
    model,
    sourceLocations: new Map([["synthetic-vir.csv", "root"]]),
    OPERATIONAL_METRICS_PATH: ["data", "operational-metrics.json"],
    text: value => String(value ?? ""),
    norm: value => String(value ?? "").trim().toLowerCase(),
    csvNumber: value => value === "" || value == null ? null : Number(value),
    parseCsv: value => value.trimEnd().split(/\r?\n/).map(line => line.split(",")),
    internalObservationDate: () => "2026-10-22",
    now: () => "2026-10-22T19:00:00.000Z",
    localDateKey: date => date ? date.toISOString().slice(0, 10) : "2026-10-23",
    previousOperatingDateKey: () => "2026-10-22",
    meetingVirRosterCodes: () => ["A1"],
    sourceExpectation: () => "required",
    metricEvidence: value => ({ ...value, verified: ["verified", "known-zero"].includes(value.status) }),
    pruneDatedSnapshots: snapshots => snapshots,
    sourceFileHandle: async () => ({
      getFile: async () => ({
        lastModified: Date.parse("2026-10-22T19:00:00.000Z"),
        text: async () => csv
      })
    }),
    removeSourceEntry: async () => { events.push("delete-source"); },
    writeJson: async (_path, value) => {
      events.push("write");
      if (mode === "write-error") throw new Error("synthetic write denied");
      durable = structuredClone(value);
    },
    readJson: async () => {
      events.push("readback");
      const result = structuredClone(durable);
      if (mode === "readback-mismatch") {
        const key = Object.keys(result.operationalMetrics.vir.snapshots).find(item => item.startsWith("observation-"));
        result.operationalMetrics.vir.snapshots[key].store.used = 2;
      }
      return result;
    },
    addHistory: async (...entry) => { events.push("history"); history.push(entry); },
    recordDiagnostic: () => {},
    renderOverviewIntelligence: () => {}
  });
  vm.runInContext(parser + "\n" + lineage + '\nVIR_NAME_CODES["demo advisor"] = "A1"; this.importVirFile = importVirFile;',
    context);
  return { context, events, history, model, existing, durable: () => durable };
}

test("failed VIR write restores runtime and keeps the source available", async () => {
  const f = failedReadbackFixture("write-error");
  await assert.rejects(f.context.importVirFile("synthetic-vir.csv", true), /synthetic write denied/);
  assert.equal(JSON.stringify(f.model.operationalMetrics), JSON.stringify(f.existing));
  assert.deepEqual(f.events, ["write"]);
  assert.deepEqual(f.history, []);
});

test("mismatched VIR read-back is rejected before history or source deletion", async () => {
  const f = failedReadbackFixture("readback-mismatch");
  await assert.rejects(f.context.importVirFile("synthetic-vir.csv", true), /could not be verified after saving/);
  assert.equal(JSON.stringify(f.model.operationalMetrics), JSON.stringify(f.existing));
  assert.deepEqual(f.events, ["write", "readback"]);
  assert.deepEqual(f.history, []);
  assert.ok(f.durable().operationalMetrics.vir.snapshots["prior-observation"]);
  assert.ok(Object.keys(f.durable().operationalMetrics.vir.snapshots).some(key => key.startsWith("observation-")),
    "uncertain candidate bytes remain available for controlled recovery");
});
