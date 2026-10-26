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

const parser = extract("  const VIR_NAME_CODES = {};", "  function virObservationDate(", "VIR parser");
const storage = extract("  function virObservationDate(", "  function normalizeOperationalCoverage()", "VIR import and storage");
const metricEvidence = extract("  function metricEvidence({", "  function metricEvidenceText(", "Meeting metric evidence");
const completeness = extract("  function virCompletenessEvidence(", "  function virMeetingEvidence()", "Meeting VIR completeness");
const meetingEvidence = extract("  function virMeetingEvidence()", "  function virMeetingWindowComparison(", "Meeting VIR evidence");

test("synthetic VIR report keeps its observation date and values through durable import into Meeting evidence", async () => {
  const csv = [
    "Report Date,2026-10-22",
    "Advisor Name,Total ROs,VIR Printed/Emailed/Texted,VIR Use %",
    "Demo Advisor,4,3,75"
  ].join("\n") + "\n";
  const model = { operationalMetrics: { vir: { snapshots: {}, pending: {} } } };
  let durable = null;
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
    validAdvisorIdentity: (code, name) => code === "A1" && name === "Demo Advisor",
    now: () => "2026-10-22T19:00:00.000Z",
    localDateKey: value => value instanceof Date ? value.toISOString().slice(0, 10) : "2026-10-22",
    previousOperatingDateKey: () => "2026-10-21",
    sourceExpectation: () => "recommended",
    meetingVirRosterCodes: () => ["A1"],
    pruneDatedSnapshots: value => value,
    sourceFileHandle: async () => ({
      getFile: async () => ({
        lastModified: Date.parse("2026-10-22T19:00:00.000Z"),
        text: async () => csv
      })
    }),
    writeJson: async (_path, value) => { durable = structuredClone(value); },
    readJson: async () => structuredClone(durable),
    addHistory: async (type, message, details) => { history.push({ type, message, details }); },
    recordDiagnostic() {},
    renderOverviewIntelligence() {}
  });

  vm.runInContext(
    parser + "\nVIR_NAME_CODES[\"demo advisor\"] = \"A1\";\n" + storage + "\n" + metricEvidence + "\n" + completeness + "\n" + meetingEvidence +
    "\nthis.importVirFile=importVirFile; this.virMeetingEvidence=virMeetingEvidence;",
    context
  );

  await context.importVirFile("synthetic-vir.csv", false);
  const saved = Object.values(durable.vir.snapshots)[0];
  assert.ok(saved, "The imported VIR observation must be durably retained.");
  assert.equal(saved.reportDate, "2026-10-22");
  assert.equal(saved.observationTimestamp, "2026-10-22T12:00:00-07:00");
  assert.equal(saved.coverageMethod, "vir-point-in-time");
  assert.equal(saved.validation.coverageBasis, "VIR source observation provenance");
  assert.equal(Object.hasOwn(saved, "effectiveDataThrough"), false);
  assert.equal(history[0].details.observationDate, "2026-10-22");

  const evidence = context.virMeetingEvidence();
  assert.equal(evidence.verified, true);
  assert.equal(evidence.source, "VIR");
  assert.equal(evidence.period, "Observed 2026-10-22");
  assert.equal(evidence.value, 75);
  assert.match(evidence.reconciliation, /PASS/);
});
