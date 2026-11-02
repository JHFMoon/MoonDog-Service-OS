"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  async function ensureMeetingCycleBaseline(");
const end = app.indexOf("\n  function meetingDelta(", start);
assert.ok(start >= 0 && end > start, "production durable baseline function exists");
const production = app.slice(start, end);

function harness({old=null, metric=0, failedWrite=null, historyError=false, pendingWrite=null} = {}) {
  const model = {root: {name:"SYNTHETIC ONLY"}, meetingCycle: old};
  const writes=[], historical=[], durable = new Map();
  let fail = failedWrite, failHistory = historyError;
  const makeCopy = value => JSON.parse(JSON.stringify(value));
  const ctx = vm.createContext({
    model,
    meetingCycleInfo: () => ({cycleStart:"2026-11-01",resetAt:"2026-11-08"}),
    meetingCurrentMetrics: () => ({vir:{value:metric, period:"synthetic-observation"}}),
    MEETING_CYCLE_PATH: ["data","meeting-cycle.json"],
    now: () => "2026-11-02T18:00:00.000Z",
    stamp: () => "synthetic",
    writeJson: async (key,value) => {
      const name=key.join("/");
      writes.push(name);
      if (fail === name) throw new Error("synthetic write/readback failure");
      if (pendingWrite && name==="data/meeting-cycle.json") await pendingWrite;
      durable.set(name,makeCopy(value));
    },
    addHistory: async (type,summary,details) => {
      historical.push({type,summary,details:makeCopy(details)});
      if (failHistory) throw new Error("synthetic history-write failure");
    }
  });
  vm.runInContext(production + "\nthis.ensureBaseline=ensureMeetingCycleBaseline;",ctx);
  return {
    model,writes,durable,historical,
    run: () => ctx.ensureBaseline(),
    stopFailing: () => {fail=null;failHistory=false;},
    stored: () => durable.get("data/meeting-cycle.json")
  };
}

const prior=()=>({
  schemaVersion:1,cycleStart:"2026-10-25",resetAt:"2026-11-01",
  capturedAt:"2026-10-26T18:00:00.000Z",
  metrics:{vir:{value:27,period:"prior-synthetic-observation"}}
});

test("a failed initial Meeting baseline write keeps memory unknown and permits a retry",async()=>{
  const f=harness({failedWrite:"data/meeting-cycle.json"});
  await assert.rejects(f.run(),/synthetic write\/readback failure/);
  assert.equal(f.model.meetingCycle,null);
  assert.equal(f.stored(),undefined);
  assert.equal(f.historical.length,0);
  f.stopFailing();
  const result=await f.run();
  assert.equal(result.metrics.vir.value,0,"verified zero persists as zero");
  assert.equal(f.stored().metrics.vir.value,0);
  assert.equal(f.model.meetingCycle.cycleStart,"2026-11-01");
  assert.equal(f.writes.filter(x=>x==="data/meeting-cycle.json").length,2);
  assert.equal(f.historical.length,1);
});

test("failed old-cycle backup preserves the previous baseline and permits safe retry",async()=>{
  const original=prior(), f=harness({old:original,failedWrite:"backups/synthetic-meeting-cycle-2026-10-25.json"});
  await assert.rejects(f.run(),/synthetic write\/readback failure/);
  assert.equal(f.model.meetingCycle,original,"do not promote an unpersisted cycle");
  assert.equal(f.stored(),undefined,"never write new baseline if prior backup failed");
  assert.equal(f.historical.length,0);
  f.stopFailing();
  await f.run();
  assert.deepEqual(f.durable.get("backups/synthetic-meeting-cycle-2026-10-25.json"),original);
  assert.equal(f.stored().cycleStart,"2026-11-01");
  assert.equal(f.model.meetingCycle.cycleStart,"2026-11-01");
});

test("failed new-cycle readback preserves prior baseline and retries even after backup succeeded",async()=>{
  const original=prior(),f=harness({old:original,failedWrite:"data/meeting-cycle.json"});
  await assert.rejects(f.run(),/synthetic write\/readback failure/);
  assert.equal(f.model.meetingCycle,original);
  assert.equal(f.stored(),undefined);
  assert.ok(f.durable.has("backups/synthetic-meeting-cycle-2026-10-25.json"));
  f.stopFailing();
  await f.run();
  assert.equal(f.stored().cycleStart,"2026-11-01");
  assert.equal(f.model.meetingCycle.cycleStart,"2026-11-01");
});

test("in-flight durable write does not expose uncommitted Meeting baseline",async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const original=prior(),f=harness({old:original,pendingWrite:gate});
  const operation=f.run();
  for(let i=0;i<4 && f.writes.length<2;i++)await Promise.resolve();
  assert.deepEqual(f.writes,[
    "backups/synthetic-meeting-cycle-2026-10-25.json",
    "data/meeting-cycle.json"
  ]);
  assert.equal(f.model.meetingCycle,original);
  assert.equal(f.stored(),undefined);
  release();
  await operation;
  assert.equal(f.model.meetingCycle.cycleStart,"2026-11-01");
  assert.equal(f.stored().cycleStart,"2026-11-01");
});

test("history failure must not roll back a baseline already durably verified",async()=>{
  const f=harness({historyError:true});
  await assert.rejects(f.run(),/synthetic history-write failure/);
  assert.equal(f.stored().cycleStart,"2026-11-01");
  assert.equal(f.model.meetingCycle.cycleStart,"2026-11-01");
  const before=f.writes.length;
  const result=await f.run();
  assert.equal(result.cycleStart,"2026-11-01");
  assert.equal(f.writes.length,before,"do not rewrite a verified baseline because history failed");
});

test("absence of a trusted metric does not manufacture an empty durable baseline",async()=>{
  const f=harness({metric:null});
  assert.equal(await f.run(),null);
  assert.deepEqual(f.writes,[]);
  assert.equal(f.model.meetingCycle,null);
});
