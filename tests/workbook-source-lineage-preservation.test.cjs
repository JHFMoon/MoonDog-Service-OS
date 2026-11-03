"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {performance}=require("node:perf_hooks");

// Execute the shipped production lock. All repair order identities and source
// hashes are synthetic placeholders, not dealership or customer data.
const sourcePath="assets/app.js";
const app=fs.readFileSync(path.join(__dirname,"..",...sourcePath.split("/")),"utf8");
const begin=app.indexOf("  let supervisorWorkbookOperationTail = Promise.resolve();");
const finish=app.indexOf("  const dailyPickedSources = new Map();",begin);
assert.ok(begin>=0&&finish>begin,"shared workbook lock exists in shipped source");
const shipped=app.slice(begin,finish);
const newStart=shipped.indexOf("          // The current and saved RO arrays can match");
const newEnd=shipped.indexOf('            throw new Error("Workspace changed in another tab or computer.',newStart);
assert.ok(newStart>0&&newEnd>newStart,"source-lineage/review queue guard precedes operation");
const baseline=shipped.slice(0,newStart)+
  `          if(!initialEmpty&&(!durable||durable.updatedAt!==model.state.updatedAt||
              !Array.isArray(durableClosed)||!Array.isArray(currentClosed)||
              JSON.stringify(durable.records)!==JSON.stringify(model.state.records)||
              JSON.stringify(durableClosed)!==JSON.stringify(currentClosed)))
`+shipped.slice(newEnd);
assert.match(shipped,/JSON\.stringify\(durableSource\)!==JSON\.stringify\(currentSource\)/);
assert.match(shipped,/JSON\.stringify\(durableReview\)!==JSON\.stringify\(currentReview\)/);

const copy=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
function state(){
  return {updatedAt:"2026-11-03T00:00:00.000Z",
    source:{fileName:"synthetic-ro-report",sha256:"synthetic-hash-before",acceptedDigests:["synthetic-before"]},
    records:[{id:"SYN-O-1",ro:"SYN-001",management:{note:"Original open note"}}],
    closedRecords:[{id:"SYN-C-2",ro:"SYN-002",management:{note:"Original closed note"}}],
    reviewQueue:[{id:"SYN-REVIEW-1",reason:"Synthetic owner ambiguity",resolved:false}]
  };
}
function fixture(local=state(),durable=state(),implementation=shipped){
  const model={root:{id:"Synthetic Workspace"},state:copy(local),recovery:{}};
  const calls={reads:0,operations:0,writes:0,locks:0};
  const ctx=vm.createContext({model,
    STATE_PATH:["data","current-state.json"],RECOVERY_PATH:["data","recovery.json"],
    navigator:{locks:{request:async(_name,_options,callback)=>{calls.locks++;return callback();}}},
    readJson:async parts=>{calls.reads++;return parts.at(-1)==="current-state.json"?copy(durable):null;},
    writeJson:async()=>{calls.writes++;},Promise,Error,JSON
  });
  vm.runInContext(implementation+"\nthis.withSourceLock=withSupervisorWorkbookLock;",ctx);
  return {model,calls,durable:copy(durable),
    run:()=>ctx.withSourceLock(async()=>{calls.operations++;return "authorized";})};
}
test("matching source digest, review queue and Open/Closed RO populations remain writable",async()=>{
  const original=state(),h=fixture(original,original);
  assert.equal(await h.run(),"authorized");
  assert.deepEqual(h.calls,{reads:2,operations:1,writes:0,locks:1});
  assert.deepEqual(h.model.state,original,"before and after source data is unchanged");
});
test("a later validated source digest cannot be silently overwritten from an older tab",async()=>{
  const before=state(),after=copy(before);
  after.source.sha256="synthetic-newer-digest";
  after.source.acceptedDigests.push("synthetic-newer");
  assert.deepEqual(after.records,before.records);assert.deepEqual(after.closedRecords,before.closedRecords);
  assert.equal(after.updatedAt,before.updatedAt,"no timestamp change is needed to expose the gap");
  const former=fixture(before,after,baseline);
  assert.equal(await former.run(),"authorized","prior implementation missed source-lineage updates");
  const current=fixture(before,after);
  await assert.rejects(current.run(),/Workspace changed in another tab or computer/);
  assert.equal(current.calls.operations,0,"no write operation authorized on stale source");
  assert.equal(current.calls.writes,0);
  assert.deepEqual(current.model.state,before,"original local source and notes untouched");
  assert.deepEqual(current.durable,after,"newer durable source remains authoritative");
});
test("a source name, report scope or accepted digest change independently rejects a stale tab",async()=>{
  const before=state();
  for(const edit of [
    data=>{data.source.fileName="synthetic-replaced-report";},
    data=>{data.source.reportDate="2026-11-03";},
    data=>{data.source.acceptedDigests.push("synthetic-new-accepted");},
    data=>{data.source=null;}
  ]){
    const after=copy(before);edit(after);
    const h=fixture(before,after);
    await assert.rejects(h.run(),/Workspace changed/);
    assert.equal(h.calls.operations,0);assert.equal(h.calls.writes,0);
  }
});
test("review queue changes in another tab cannot be silently replaced",async()=>{
  const before=state();
  for(const edit of [
    data=>{data.reviewQueue[0].reason="Different owner conflict";},
    data=>{data.reviewQueue[0].resolved=true;},
    data=>{data.reviewQueue=[];},
    data=>{data.reviewQueue.push({id:"SYN-REVIEW-2",reason:"New synthetic concern"});}
  ]){
    const after=copy(before);edit(after);
    const old=fixture(before,after,baseline);
    assert.equal(await old.run(),"authorized","old gate missed pending review evidence");
    const h=fixture(before,after);
    await assert.rejects(h.run(),/Workspace changed/);
    assert.equal(h.calls.operations,0);assert.equal(h.calls.writes,0);
    assert.deepEqual(h.model.state,before);
    assert.deepEqual(h.durable,after);
  }
});
test("a truly absent legacy source and queue match null/empty but unknown types fail closed",async()=>{
  const legacy=state();legacy.source=null;legacy.reviewQueue=[];
  const absent=copy(legacy);delete absent.source;delete absent.reviewQueue;
  assert.equal(await fixture(legacy,absent).run(),"authorized");
  assert.equal(await fixture(absent,legacy).run(),"authorized");
  for(const malformed of [
    {source:"not-an-authorized-source"},
    {source:[]},
    {reviewQueue:null},
    {reviewQueue:{"not-an-array":true}}
  ]){
    const invalid=copy(legacy);Object.assign(invalid,malformed);
    const h=fixture(legacy,invalid);
    await assert.rejects(h.run(),/Workspace changed/);
    assert.equal(h.calls.operations,0);
    assert.equal(h.calls.writes,0);
  }
});
test("existing Open/Closed RO and updatedAt checks remain protective",async()=>{
  const before=state();
  for(const edit of [
    data=>{data.records[0].management.note="newer open note";},
    data=>{data.closedRecords[0].management.note="newer closed note";},
    data=>{data.updatedAt="2026-11-03T00:01:00.000Z";}
  ]){
    const changed=copy(before);edit(changed);
    const h=fixture(before,changed);
    await assert.rejects(h.run(),/Workspace changed/);
    assert.equal(h.calls.operations,0);
  }
});
function percentile(samples,q){const a=[...samples].sort((x,y)=>x-y);return +a[Math.max(0,Math.ceil(a.length*q)-1)].toFixed(3);}
test("24 paired production lock measurements with synthetic large record populations",async()=>{
  const dataset=state();
  dataset.records=Array.from({length:2100},(_,i)=>({id:"SYN-O-"+i,management:{note:"Open synthetic "+i}}));
  dataset.closedRecords=Array.from({length:1200},(_,i)=>({id:"SYN-C-"+i,management:{note:"Closed synthetic "+i}}));
  dataset.reviewQueue=Array.from({length:40},(_,i)=>({id:"SYN-REVIEW-"+i,reason:"Synthetic "+i}));
  const snapshot=JSON.stringify(dataset);
  const previous=fixture(dataset,dataset,baseline),current=fixture(dataset,dataset,shipped);
  for(let i=0;i<4;i++){await previous.run();await current.run();}
  const oldMs=[],newMs=[];
  for(let i=0;i<24;i++){
    const pair=i%2?[[current,newMs],[previous,oldMs]]:[[previous,oldMs],[current,newMs]];
    for(const [h,values] of pair){
      const start=performance.now();assert.equal(await h.run(),"authorized");
      values.push(performance.now()-start);
    }
  }
  assert.equal(JSON.stringify(dataset),snapshot,"source fields and manager history remain unchanged");
  assert.equal(previous.calls.writes,0);assert.equal(current.calls.writes,0);
  console.log("58-06 source authority workbook lock paired microbenchmark",JSON.stringify({
    samples:24,openRecords:2100,closedRecords:1200,pendingReviews:40,
    before:{p50:percentile(oldMs,.5),p95:percentile(oldMs,.95)},
    after:{p50:percentile(newMs,.5),p95:percentile(newMs,.95)},
    scope:"actual production lock with synthetic Node VM readback; not OneDrive or browser timing"
  }));
});

test("malformed in-memory source or review queue also fails closed before starting a write",async()=>{
  const saved=state();
  for(const edit of [
    data=>{data.source="unverified-source-string";},
    data=>{data.source=[];},
    data=>{data.reviewQueue=null;},
    data=>{data.reviewQueue={items:[]};}
  ]){
    const local=copy(saved);edit(local);
    const h=fixture(local,saved);
    await assert.rejects(h.run(),/Workspace changed/);
    assert.equal(h.calls.operations,0);
    assert.equal(h.calls.writes,0);
    assert.deepEqual(h.durable,saved,"authoritative saved state is never silently normalized");
  }
});

test("malformed active Open RO arrays never authorize a Workbook operation even when both copies match",async()=>{
  const original=state();
  const empty=copy(original);empty.records=[];
  assert.equal(await fixture(empty,empty).run(),"authorized","verified empty Open RO array remains valid");
  for(const badRecords of [null,"not-an-array",{items:[]},17]){
    const malformed=copy(original);malformed.records=badRecords;
    const former=fixture(malformed,malformed,baseline);
    assert.equal(await former.run(),"authorized","old equality-only gate missed matching malformed Open RO records");
    const guarded=fixture(malformed,malformed);
    await assert.rejects(guarded.run(),/Workspace changed in another tab or computer/);
    assert.equal(guarded.calls.operations,0);
    assert.equal(guarded.calls.writes,0);
    assert.deepEqual(guarded.model.state,malformed,"malformed local state remains untouched for recovery");
    assert.deepEqual(guarded.durable,malformed,"durable state is not silently normalized");
  }
  const absent=copy(original);delete absent.records;
  const h=fixture(absent,absent);
  await assert.rejects(h.run(),/Workspace changed/,"absent current RO population must not masquerade as verified empty");
  assert.equal(h.calls.operations,0);assert.equal(h.calls.writes,0);
});
