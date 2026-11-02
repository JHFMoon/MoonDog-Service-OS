"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  function meetingCurrentMetrics() {");
const end = app.indexOf("  async function ensureMeetingCycleBaseline(", start);
const afterBaseline = app.indexOf("  function meetingDelta(", end);
assert.ok(start >= 0 && end > start && afterBaseline > end,
  "actual production Meeting-cycle selector and durable baseline exist");
const production = app.slice(start, end);
const productionBaseline = app.slice(end, afterBaseline);

const SYNTHETIC_ZERO = 0; // Explicitly synthetic source measurement, not a configured store target.
const verified = () => ({ status: "current", safeForCurrent: true, reportPeriodVerified: true });
const sourceSnapshots = () => ({
  sapr: { periodStart: "2026-10-01", periodEnd: "2026-10-20",
    store: {mediaViewed: SYNTHETIC_ZERO}, controllables: {store: {}} },
  vir: {observationDate: "2026-10-20", store: {utilization: 0}},
  menu: {periodStart: "2026-10-19", periodEnd: "2026-10-25",
    releaseWeek: "2026-10-19", store: {presentation: 0, penetration: 55}}
});

function fixture({sources=sourceSnapshots(), evidence={}, nps=null, controlsStatus="goal", persisted=false} = {}) {
  const model = {root: {}, settings: {csiPeriodStart: "2026-10-01"}, meetingCycle: null};
  const seen = [], writes = [], history = [];
  const ctx = vm.createContext({
    model,
    latestVerifiedMeetingSnapshot: () => sources.sapr || null,
    latestOperationalSnapshot: key => sources[key] || null,
    sourceFreshness: key => {
      assert.ok(["sapr", "vir", "menu"].includes(key), "only applicable lineage checked");
      seen.push(key);
      return evidence[key] || verified();
    },
    currentCsiSurveys: () => ({}),
    npsSummary: () => ({responses: nps === null ? 0 : 8, nps}),
    controllableTeamStatus: () => ({progress: 0, className: controlsStatus}),
    verifiedMeetingCsiNps: () => nps,
    localDateKey: () => "2026-10-20",
    virObservationDate: snapshot => snapshot?.observationDate || "",
    meetingCycleInfo: () => ({cycleStart: "2026-10-18", resetAt: "2026-10-25"}),
    MEETING_CYCLE_PATH: ["meeting-cycle.json"],
    writeJson: async (where, data) => {writes.push({where, data: JSON.parse(JSON.stringify(data))});},
    addHistory: async (kind, details, data) => history.push({kind, details, data}),
    now: () => "2026-10-20T20:00:00.000Z",
    stamp: () => "synthetic"
  });
  vm.runInContext(production + (persisted ? productionBaseline : "") +
    "\nthis.getMetrics = meetingCurrentMetrics;" +
    (persisted ? "\nthis.persistBaseline = ensureMeetingCycleBaseline;" : ""), ctx);
  return {ctx, model, seen, writes, history, metrics: () => ctx.getMetrics()};
}

test("real Meeting baseline selector preserves verified zero and nonzero from all three feeds", () => {
  const f = fixture({nps: 0});
  const m = f.metrics();
  assert.equal(m.dealerNps.value, 0);
  assert.equal(m.vir.value, 0, "true VIR zero is not unknown");
  assert.equal(m.menuPresentation.value, 0, "true Menu zero is not unknown");
  assert.equal(m.menuPenetration.value, 55);
  assert.equal(m.mediaViewed.value, 0, "true SAPR zero is not unknown");
  assert.equal(m.controllables.value, 0);
  assert.deepEqual(f.seen.sort(), ["menu", "sapr", "vir"]);
  assert.equal(m.vir.period, "vir-observed:2026-10-20");
  assert.equal(m.menuPresentation.period, "menu:2026-10-19");
});

test("stale, missing, conflicting, unavailable or period-unverified sources cannot seed a current Meeting comparison", () => {
  for (const key of ["sapr", "vir", "menu"]) {
    for (const bad of [
      {status:"missing", safeForCurrent:false, reportPeriodVerified:false},
      {status:"stale", safeForCurrent:false, reportPeriodVerified:true},
      {status:"invalid", safeForCurrent:false, reportPeriodVerified:true},
      {status:"conflicting", safeForCurrent:false, reportPeriodVerified:true},
      {status:"temporarily-unavailable", safeForCurrent:false, reportPeriodVerified:true},
      {status:"current", safeForCurrent:true, reportPeriodVerified:false}
    ]) {
      const f = fixture({evidence: {[key]:bad}});
      const m = f.metrics();
      const affected = key === "sapr" ? ["mediaViewed", "controllables"] :
        key === "vir" ? ["vir"] : ["menuPresentation", "menuPenetration"];
      for (const metric of affected)
        assert.equal(m[metric].value, null, key + " " + bad.status + " must withhold " + metric);
      for (const metric of ["vir","mediaViewed","menuPenetration"].filter(k => !affected.includes(k)))
        assert.ok(Number.isFinite(m[metric].value),
          "unrelated verified family should remain available: " + key + "/" + metric);
    }
  }
});

test("an empty SAPR controllables set is unknown, not a zero-progress verified metric", () => {
  const f = fixture({controlsStatus:"unknown"});
  const m = f.metrics();
  assert.equal(m.controllables.value, null,
    "valid SAPR does not validate missing controllable categories");
  assert.equal(m.mediaViewed.value, 0,
    "an independent real zero from verified SAPR remains available");
});

test("absent source does not create a fabricated baseline or require a lineage lookup", () => {
  const f = fixture({sources:{sapr:null,vir:null,menu:null}});
  const m = f.metrics();
  for (const key of ["vir","menuPresentation","menuPenetration","mediaViewed","controllables"])
    assert.equal(m[key].value, null);
  assert.deepEqual(f.seen, [], "no source means no need to inspect a phantom source");
});

test("source snapshots are read-only and nonnumeric values never become verified zeros", () => {
  const sources = sourceSnapshots();
  sources.vir.store.utilization = "0";
  sources.menu.store.penetration = Number.NaN;
  sources.sapr.store.mediaViewed = undefined;
  const before = JSON.stringify(sources);
  const f = fixture({sources});
  const m = f.metrics();
  assert.equal(m.vir.value, null);
  assert.equal(m.menuPenetration.value, null);
  assert.equal(m.mediaViewed.value, null);
  assert.equal(JSON.stringify(sources), before, "baseline reads must not rewrite imported authority");
});

test("actual durable Meeting baseline saves only trusted numbers while retaining unknown as null", async () => {
  const evidence = {
    sapr: {status:"stale",safeForCurrent:false,reportPeriodVerified:true},
    vir: {status:"current",safeForCurrent:true,reportPeriodVerified:false}
  };
  const f = fixture({evidence, persisted:true});
  const result = await f.ctx.persistBaseline();
  assert.equal(f.writes.length, 1, "single durable baseline write");
  assert.equal(f.history.length, 1, "history follows successful persisted write");
  assert.equal(f.writes[0].data.metrics.vir.value, null);
  assert.equal(f.writes[0].data.metrics.mediaViewed.value, null);
  assert.equal(f.writes[0].data.metrics.controllables.value, null);
  assert.equal(f.writes[0].data.metrics.menuPresentation.value, 0);
  assert.equal(f.writes[0].data.metrics.menuPenetration.value, 55);
  assert.equal(f.history[0].data.availableMetrics, 2);
  assert.equal(result.metrics.vir.value, null);
});
