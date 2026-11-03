"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {performance}=require("node:perf_hooks");

// Execute the actual production Workbook serialization gate, not a duplicate
// implementation. Synthetic-only RO IDs; never use real customer/VIN data.
const sourcePath="assets/app.js";
const app=fs.readFileSync(path.join(__dirname,"..",...sourcePath.split("/")),"utf8");
const start=app.indexOf("  let supervisorWorkbookOperationTail = Promise.resolve();");
const end=app.indexOf("  const dailyPickedSources = new Map();",start);
assert.ok(start>=0&&end>start,"production shared Workbook guard is present");
const shipped=app.slice(start,end);
const newGuard="JSON.stringify(durableClosed)!==JSON.stringify(currentClosed)";
assert.ok(shipped.includes(newGuard),"real production guard compares persisted Closed RO records");
const previous=shipped.replace(
  /          \/\/ A second tab can update a retained Closed RO's management history[\s\S]*?            throw new Error\("Workspace changed in another tab or computer\. Refresh durable state before continuing\."\);/,
  '          if(!initialEmpty&&(!durable||durable.updatedAt!==model.state.updatedAt||JSON.stringify(durable.records)!==JSON.stringify(model.state.records)))throw new Error("Workspace changed in another tab or computer. Refresh durable state before continuing.");'
);
assert.notEqual(previous,shipped,"the baseline excludes only this data-preservation guard");

const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
function example(){
  return {
    updatedAt:"2026-11-03T00:00:00.000Z",
    records:[{id:"synthetic-open-1",ro:"SYN-001",
      management:{owner:"Synthetic Owner",note:"Synthetic current note"}}],
    closedRecords:[{id:"synthetic-closed-1",ro:"SYN-002",
      closedAt:"2026-11-02T00:00:00.000Z",
      management:{owner:"Synthetic Closed Owner",note:"Original retained Closed RO note",
        nextAction:"Synthetic next action"}}]
  };
}
function harness({local=example(),durable=example(),code=shipped}={}){
  const model={root:{id:"Synthetic Workspace"},state:clone(local),recovery:{}};
  const calls={locks:0,reads:0,operations:0,writes:0};
  const ctx=vm.createContext({
    model,STATE_PATH:["data","current-state.json"],
    RECOVERY_PATH:["data","recovery.json"],
    navigator:{locks:{request:async(_name,_options,fn)=>{calls.locks++;return fn();}}},
    readJson:async parts=>{calls.reads++;return parts.at(-1)==="current-state.json"?clone(durable):null;},
    writeJson:async()=>{calls.writes++;},Promise,Error,JSON
  });
  vm.runInContext(code+"\nthis.withProductionLock=withSupervisorWorkbookLock;",ctx);
  const run=async()=>ctx.withProductionLock(async()=>{calls.operations++;return "safe";});
  return {run,model,calls,durable:clone(durable)};
}
test("unchanged active and retained Closed RO populations remain authorized",async()=>{
  const before=example(),h=harness({local:before,durable:before});
  assert.equal(await h.run(),"safe");
  assert.deepEqual(h.calls,{locks:1,reads:2,operations:1,writes:0});
  assert.deepEqual(h.model.state,before);
});
test("a retained Closed RO note changed in another tab rejects stale workbook operations",async()=>{
  const before=example(),after=clone(before);
  after.closedRecords[0].management.note="Newer note from another tab";
  assert.equal(after.updatedAt,before.updatedAt,"same timestamp exposes array-only conflict");
  assert.deepEqual(after.records,before.records,"active Open ROs are identical");
  const old=harness({local:before,durable:after,code:previous});
  assert.equal(await old.run(),"safe","previous source missed the preserved Closed RO conflict");
  const current=harness({local:before,durable:after});
  await assert.rejects(current.run(),/Workspace changed in another tab or computer/);
  assert.equal(current.calls.operations,0,"conflicting state can never run the write operation");
  assert.equal(current.calls.writes,0);
  assert.deepEqual(current.model.state,before,"manager notes and values remain untouched");
  assert.deepEqual(current.durable,after,"newer durable Closed RO note remains authoritative");
});
test("Closed RO removal, restoration, owner edit and note edit each block stale writes",async()=>{
  const before=example();
  for(const modified of [
    {...before,closedRecords:[]},
    {...before,closedRecords:[...before.closedRecords,{id:"synthetic-closed-3",ro:"SYN-003"}]},
    {...before,closedRecords:[{...before.closedRecords[0],management:{
      ...before.closedRecords[0].management,owner:"Other synthetic owner"}}]},
    {...before,closedRecords:[{...before.closedRecords[0],closedAt:"2026-11-01T00:00:00.000Z"}]}
  ]){
    const h=harness({local:before,durable:modified});
    await assert.rejects(h.run(),/Workspace changed/);
    assert.equal(h.calls.operations,0);
    assert.equal(h.calls.writes,0);
    assert.deepEqual(h.model.state,before);
  }
});
test("legacy missing Closed RO arrays only match a genuinely empty local Closed RO collection",async()=>{
  const empty=example();empty.closedRecords=[];
  const missing=clone(empty);delete missing.closedRecords;
  const allowed=harness({local:empty,durable:missing});
  assert.equal(await allowed.run(),"safe","legacy data without Closed ROs stays compatible");
  const localHasClosed=harness({local:example(),durable:missing});
  await assert.rejects(localHasClosed.run(),/Workspace changed/);
  assert.equal(localHasClosed.calls.operations,0);
});
test("Open RO changes and mismatched timestamps remain rejected as before",async()=>{
  const before=example();
  const changed=clone(before);
  changed.records[0].management.nextAction="Changed in another tab";
  const badTime=clone(before);badTime.updatedAt="2026-11-03T00:01:00.000Z";
  for(const durable of [changed,badTime]){
    const h=harness({local:before,durable});
    await assert.rejects(h.run(),/Workspace changed/);
    assert.equal(h.calls.operations,0);
  }
});
function percentile(samples,q){const sorted=[...samples].sort((a,b)=>a-b);
  return +sorted[Math.max(0,Math.ceil(sorted.length*q)-1)].toFixed(3);}
test("24 paired synthetic large-roster gate measurements retain unchanged data",async()=>{
  const state=example();
  state.records=Array.from({length:2100},(_,i)=>({id:"SYN-O-"+i,ro:"SYN-"+i,
    management:{note:"Original synthetic open note "+i}}));
  state.closedRecords=Array.from({length:1200},(_,i)=>({id:"SYN-C-"+i,ro:"SYN-C-"+i,
    management:{note:"Original synthetic closed note "+i}}));
  const snapshot=JSON.stringify(state);
  const old=harness({local:state,durable:state,code:previous});
  const next=harness({local:state,durable:state});
  for(let warmup=0;warmup<4;warmup++){await old.run();await next.run();}
  const legacy=[],guarded=[];
  for(let i=0;i<24;i++){
    const sequence=i%2===0?[[old,legacy],[next,guarded]]:[[next,guarded],[old,legacy]];
    for(const [h,timings] of sequence){
      const startAt=performance.now();assert.equal(await h.run(),"safe");
      timings.push(performance.now()-startAt);
    }
  }
  assert.equal(JSON.stringify(state),snapshot,"synthetic before and after source rows do not change");
  assert.equal(old.calls.writes,0);assert.equal(next.calls.writes,0);
  console.log("58-06 retained Closed RO lock synthetic microbenchmark",JSON.stringify({
    samples:24,openRecords:2100,closedRecords:1200,
    legacy:{p50:percentile(legacy,.5),p95:percentile(legacy,.95)},
    guarded:{p50:percentile(guarded,.5),p95:percentile(guarded,.95)},
    scope:"actual production lock VM with synthetic in-memory state; no physical OneDrive/disk/browser timings"
  }));
});
