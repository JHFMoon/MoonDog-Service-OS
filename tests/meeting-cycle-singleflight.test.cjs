"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const begin = app.indexOf("  let meetingBaselineInFlight = null;");
const end = app.indexOf("\n  function meetingDelta(",begin);
assert.ok(begin >= 0 && end > begin,
  "execute the actual production single-flight Meeting baseline implementation");
const source = app.slice(begin,end);

function synthetic({pause=false,failInitially=false}={}) {
  let release,entered,failed=failInitially;
  const deferred=new Promise(resolve=>{release=resolve;});
  const started=new Promise(resolve=>{entered=resolve;});
  const root={name:"SYNTHETIC-A"};
  const model={root,meetingCycle:null};
  const writes=[],history=[];
  const ctx=vm.createContext({
    model,
    meetingCycleInfo: at => {
      const start=typeof at==="string"?at:"2026-11-01";
      return {cycleStart:start,resetAt:"2026-11-08"};
    },
    meetingCurrentMetrics: ()=>({vir:{value:0,period:"synthetic-verified-period"}}),
    MEETING_CYCLE_PATH:["data","meeting-cycle.json"],
    now:()=>"2026-11-02T18:00:00.000Z",
    stamp:()=>"synthetic",
    writeJson:async(path,payload)=>{
      const name=path.join("/");
      writes.push({name,payload:JSON.parse(JSON.stringify(payload))});
      if(name==="data/meeting-cycle.json"){
        entered();
        if(pause)await deferred;
        if(failed)throw Error("synthetic disk/readback failure");
      }
    },
    addHistory:async(_,__,details)=>history.push(JSON.parse(JSON.stringify(details)))
  });
  vm.runInContext(source+"\nthis.captureBaseline=ensureMeetingCycleBaseline;",ctx);
  return {model,writes,history,root,started,release,
    capture:at=>ctx.captureBaseline(at),
    recover:()=>{failed=false;}
  };
}

test("simultaneous postconnect and timer baselines coalesce one verified cycle transaction",async()=>{
  const f=synthetic({pause:true});
  const one=f.capture(),two=f.capture();
  await f.started;
  assert.equal(f.writes.length,1,"one write starts while both callers await");
  assert.equal(f.model.meetingCycle,null,"an in-flight cycle is not published");
  f.release();
  const [a,b]=await Promise.all([one,two]);
  assert.equal(a.cycleStart,"2026-11-01");
  assert.equal(b.cycleStart,"2026-11-01");
  assert.equal(f.writes.filter(w=>w.name==="data/meeting-cycle.json").length,1);
  assert.equal(f.history.length,1,"exactly one history record per coalesced cycle");
});

test("coalesced disk failure rejects both callers without poisoning a later retry",async()=>{
  const f=synthetic({failInitially:true});
  const results=await Promise.allSettled([f.capture(),f.capture()]);
  assert.deepEqual(results.map(x=>x.status),["rejected","rejected"]);
  assert.equal(f.model.meetingCycle,null);
  assert.equal(f.writes.filter(x=>x.name==="data/meeting-cycle.json").length,1);
  assert.equal(f.history.length,0);
  f.recover();
  await f.capture();
  assert.equal(f.writes.filter(x=>x.name==="data/meeting-cycle.json").length,2);
  assert.equal(f.model.meetingCycle.cycleStart,"2026-11-01");
  assert.equal(f.history.length,1);
});

test("a Workspace change during pending baseline write must not publish the old candidate into new Workspace state",async()=>{
  const f=synthetic({pause:true});
  const first=f.capture();
  await f.started;
  f.model.root={name:"SYNTHETIC-B"};
  const next=f.capture();
  f.release();
  const results=await Promise.allSettled([first,next]);
  assert.deepEqual(results.map(x=>x.status),["rejected","rejected"]);
  assert.equal(f.model.meetingCycle,null);
  assert.equal(f.history.length,0);
  await f.capture();
  assert.equal(f.model.meetingCycle.cycleStart,"2026-11-01");
  assert.equal(f.history.length,1);
});

test("different requested meeting cycles serialize and preserve the first committed baseline",async()=>{
  const f=synthetic({pause:true});
  const first=f.capture("2026-11-01");
  await f.started;
  const future=f.capture("2026-11-08");
  f.release();
  const [a,b]=await Promise.all([first,future]);
  assert.equal(a.cycleStart,"2026-11-01");
  assert.equal(b.cycleStart,"2026-11-08");
  assert.equal(f.model.meetingCycle.cycleStart,"2026-11-08");
  assert.equal(f.history.length,2);
  assert.equal(f.writes.filter(w=>w.name==="data/meeting-cycle.json").length,2);
  assert.ok(f.writes.some(w=>w.name.includes("meeting-cycle-2026-11-01.json")),
    "second cycle backs up the first rather than discarding it");
});
