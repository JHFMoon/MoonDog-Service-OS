"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto").webcrypto;

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const first = app.indexOf("  async function importCsiFile(");
const last = app.indexOf("  const isoCell =", first);
assert.ok(first >= 0 && last > first, "Production CSI importer must exist");
const importer = app.slice(first, last);
const digestStart = app.indexOf("  async function sha256(");
const digestEnd = app.indexOf("  async function readFileBytes(", digestStart);
assert.ok(digestStart >= 0 && digestEnd > digestStart, "Production SHA-256 helper must exist");
const digestHelper = app.slice(digestStart, digestEnd);

function fixture(mode = "verified") {
  let currentMode = mode;
  const previous = {
    csi: {
      surveys: {"prior-01": {id: "prior-01", surveyDate: "2026-10-19", score: 10, lastSeenAt: "earlier", extensionRecordIds: ["ex-1"]}},
      imports: [{sourceFile: "old-synthetic.csv"}],
      lastSuccessfulRefreshAt: "old-time",
      lastSuccessfulRefreshDate: "2026-10-19"
    },
    anotherFamily: {snapshots: {"2026-10-20": {count: 3}}},
    updatedAt: "old-time"
  };
  const parsed = {
    surveys: {
      "new-02": {id: "new-02", surveyDate: "2026-10-21", score: 9, extensionRecordIds: ["ex-2"]},
      "prior-01": {id: "prior-01", surveyDate: "2026-10-19", score: 7, extensionRecordIds: ["ex-3"]}
    },
    coverageStart: "2026-10-19", coverageEnd: "2026-10-21",
    scopeStart: "2026-10-19", scopeEnd: "2026-10-21",
    scopeVerified: true, unresolvedAdvisorCount: 0
  };
  const model = {operationalMetrics: structuredClone(previous)};
  const events = [];
  const history = [];
  let persisted = structuredClone(previous);
  const ctx = {
    model, structuredClone, crypto, TextEncoder, now: () => "2026-10-21T15:00:00Z",
    localDateKey: () => "2026-10-21",
    OPERATIONAL_METRICS_PATH: ["data", "operational-metrics.json"],
    sourceFileHandle: async () => ({getFile: async () => ({text: async () => "synthetic CSV"})}),
    parseCsiCsv: () => structuredClone(parsed),
    npsSummary: surveys => ({responseCount: Object.keys(surveys).length}),
    freshness: {addDays: (_date, days) => days === -730 ? "2024-10-21" : "unexpected"},
    writeJson: async (_path, data) => {
      events.push("write");
      if (currentMode === "write-denied") throw Error("synthetic write denied");
      persisted = structuredClone(data);
    },
    readJson: async () => {
      events.push("read");
      if (currentMode === "read-denied") throw Error("synthetic read denied");
      if (currentMode === "stale") return structuredClone(previous);
      const data = structuredClone(persisted);
      if (currentMode === "survey-mismatch") data.csi.surveys["new-02"].score = 4;
      if (currentMode === "prior-survey-lost") delete data.csi.surveys["prior-01"];
      if (currentMode === "refresh-mismatch") data.csi.lastSuccessfulRefreshDate = "2026-10-20";
      if (currentMode === "lineage-mismatch") data.csi.imports = [];
      if (currentMode === "other-family-lost") delete data.anotherFamily;
      return data;
    },
    addHistory: async (kind, summary, details) => {
      events.push("history:" + kind);
      history.push({ kind, summary, details: structuredClone(details) });
    },
    removeSourceEntry: async () => events.push("source-deleted"),
    status: (_message, kind) => events.push("status:" + kind),
    renderAll: () => events.push("render-all"),
    renderMeeting: () => events.push("render-meeting")
  };
  vm.runInNewContext(digestHelper + "\n" + importer + "\nthis.importCsiForTest = importCsiFile;", ctx);
  return {run: deleteSource => ctx.importCsiForTest("synthetic-csi.csv", deleteSource),
    events, history, model, previous, parsed, persisted: () => persisted, setMode: next => { currentMode = next; }};
}

test("CSI importer verifies the entire saved payload before success and source deletion", async () => {
  const f = fixture();
  await f.run(true);
  assert.deepEqual(f.events, ["write", "read", "history:csi-import", "source-deleted",
    "history:source-deleted", "status:success", "render-all", "render-meeting"]);
  assert.equal(f.persisted().csi.surveys["prior-01"].score, 7);
  assert.deepEqual(f.persisted().csi.surveys["prior-01"].extensionRecordIds, ["ex-1", "ex-3"]);
});

for (const [mode, pattern] of [
  ["write-denied", /synthetic write denied/],
  ["read-denied", /synthetic read denied/],
  ["stale", /could not be verified/],
  ["survey-mismatch", /could not be verified/],
  ["prior-survey-lost", /could not be verified/],
  ["refresh-mismatch", /could not be verified/],
  ["lineage-mismatch", /could not be verified/],
  ["other-family-lost", /could not be verified/]
]) {
  test("CSI import fails closed for " + mode, async () => {
    const f = fixture(mode);
    await assert.rejects(f.run(true), pattern);
    assert.deepEqual(f.model.operationalMetrics, f.previous, "Trusted metrics restored in runtime");
    assert.equal(f.events.filter(e => e.startsWith("history:")).length, 0);
    assert.ok(!f.events.includes("source-deleted"), "Original CSI source retained");
    assert.ok(!f.events.includes("status:success"), "No false saved status");
    assert.ok(!f.events.includes("render-all"), "No unverified metric refresh");
  });
}

test("reimporting the same CSI source keeps survey state idempotent", async () => {
  const f = fixture();
  await f.run(false);
  await f.run(false);
  const saved = f.persisted();
  assert.deepEqual(Object.keys(saved.csi.surveys).sort(), ["new-02", "prior-01"]);
  assert.deepEqual(saved.csi.surveys["prior-01"].extensionRecordIds, ["ex-1", "ex-3"]);
  assert.deepEqual(saved.csi.surveys["new-02"].extensionRecordIds, ["ex-2"]);
  assert.equal(saved.csi.imports.length, 3, "each verified import keeps its audit event");
  assert.equal(f.events.filter(event => event === "history:csi-import").length, 2);
});

test("a failed CSI reimport preserves the prior verified state and leaves its source undeleted", async () => {
  const f = fixture();
  await f.run(false);
  const firstVerified = structuredClone(f.model.operationalMetrics);
  const firstDurable = structuredClone(f.persisted());
  f.setMode("write-denied");
  await assert.rejects(f.run(true), /synthetic write denied/);
  assert.deepEqual(f.model.operationalMetrics, firstVerified);
  assert.deepEqual(f.persisted(), firstDurable);
  assert.equal(f.events.filter(event => event === "history:csi-import").length, 1,
    "failed reimport must not create a success history event");
  assert.ok(!f.events.includes("source-deleted"), "failed reimport retains the source report");
  assert.equal(f.events.filter(event => event === "status:success").length, 1,
    "failed reimport adds no second success status");
});

test("actual CSI importer is syntax-valid and uses full readback comparison", () => {
  new vm.Script(app);
  assert.match(importer, /structuredClone\(model\.operationalMetrics\)/);
  assert.match(importer, /JSON\.stringify\(check\) !== JSON\.stringify\(model\.operationalMetrics\)/);
  assert.match(importer, /model\.operationalMetrics = priorMetrics/);
});


test("cumulative CSI metric corrections retain period provenance in durable import history", async () => {
  const f = fixture();
  await f.run(false);
  const first = f.history[0];
  assert.equal(first.kind, "csi-import");
  assert.match(first.summary, /revised 1 previously imported metric response/);
  assert.equal(first.details.fileName, "synthetic-csi.csv");
  assert.equal(first.details.sourcePeriodStart, "2026-10-19");
  assert.equal(first.details.sourcePeriodEnd, "2026-10-21");
  assert.equal(first.details.sourceScopeVerified, true);
  assert.equal(first.details.revisedMetricSurveyCount, 1);
  assert.equal(JSON.stringify(first.details).includes("prior-01"), false,
    "audit provenance must not copy survey identifiers");
  assert.equal(JSON.stringify(first.details).includes('"score"'), false,
    "audit provenance records a correction count, not response values");

  await f.run(false);
  assert.deepEqual(f.history.map(entry => entry.details.revisedMetricSurveyCount), [1, 0],
    "the repeated same cumulative export is idempotent and creates no false correction");
  assert.equal(f.history[1].details.sourcePeriodEnd, "2026-10-21");
});
