"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

// Run the shipped production function rather than a duplicate implementation.
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf("  async function ensurePreviousMonthSummary(){");
const end=app.indexOf("  function monthEndCorrectionCandidate(",start);
assert.ok(start>=0&&end>start,"production month-end durable writer is present");
const production=app.slice(start,end);
const copy=value=>JSON.parse(JSON.stringify(value));
function deferred(){
  let release;
  const promise=new Promise(resolve=>{release=resolve;});
  return {promise,release};
}
function oldMetrics(){
  return {schemaVersion:1,updatedAt:"prior-durable",csi:{surveys:{"synthetic-id":{score:9}}},
    monthlySummaries:{"2026-09":{status:"locked",basis:{saprPeriodEnd:"2026-09-30"}}}};
}
function monthSummary(){
  return {schemaVersion:2,month:"2026-10",status:"locked",lockedAt:"synthetic-now",
    readiness:{sapr:{state:"ready"}},basis:{saprPeriodEnd:"2026-10-31"},
    store:{roCount:12},advisors:{"101":{name:"Synthetic Advisor"}}};
}
function harness(options={}){
  const before=oldMetrics(),root={name:"synthetic-root"};
  const model={root,operationalMetrics:copy(before)};
  const originalRef=model.operationalMetrics,writes=[],history=[],durable=new Map();
  let fail=options.fail||"",misread=!!options.misread,unready=!!options.unready;
  const ctx=vm.createContext({
    model,OPERATIONAL_METRICS_PATH:["data","operational-metrics.json"],
    priorMonthKey:()=>"2026-10",now:()=>"synthetic-now",stamp:()=>"synthetic",
    buildMonthEndSummary:()=>unready?{month:"2026-10",status:"pending-finalization",needed:["sapr"]}:monthSummary(),
    writeJson:async(key,value)=>{
      const name=key.join("/");
      writes.push({name,value:copy(value)});
      if(name.startsWith("backups/")&&fail==="backup")throw Error("synthetic backup write denied");
      if(name==="data/operational-metrics.json"&&fail==="metrics")throw Error("synthetic durable write denied");
      if(name.startsWith("backups/")&&options.onBackup)options.onBackup(model);
      if(name==="data/operational-metrics.json"&&options.metricsGate)await options.metricsGate.promise;
      durable.set(name,copy(value));
      if(name==="data/operational-metrics.json"&&options.onMetricsWrite)options.onMetricsWrite(model);
    },
    readJson:async(key)=>{
      const value=durable.get(key.join("/"));
      if(misread)return {...copy(value),updatedAt:"corrupted-readback"};
      return copy(value);
    },
    addHistory:async(type,description,details)=>{
      if(fail==="history")throw Error("synthetic audit history unavailable");
      history.push({type,description,details:copy(details)});
    }
  });
  vm.runInContext(production+"\nthis.run=ensurePreviousMonthSummary;",ctx);
  return {ctx,model,root,originalRef,before,writes,history,durable,
    run:()=>ctx.run(),
    stopFailing:()=>{fail="";misread=false;unready=false;},
    persisted:()=>copy(durable.get("data/operational-metrics.json"))};
}

test("unknown source readiness never writes a false locked month",async()=>{
  const h=harness({unready:true});
  const result=await h.run();
  assert.equal(result.status,"pending-finalization");
  assert.deepEqual(h.writes,[]);
  assert.strictEqual(h.model.operationalMetrics,h.originalRef);
  assert.equal(h.model.operationalMetrics.monthlySummaries["2026-10"],undefined);
});
test("failed backup does not publish a month or write metrics; retry succeeds",async()=>{
  const h=harness({fail:"backup"});
  await assert.rejects(h.run(),/synthetic backup write denied/);
  assert.strictEqual(h.model.operationalMetrics,h.originalRef);
  assert.deepEqual(copy(h.model.operationalMetrics),h.before);
  assert.deepEqual(h.writes.map(x=>x.name),["backups/synthetic-before-month-end-summary.json"]);
  h.stopFailing();
  await h.run();
  assert.equal(h.model.operationalMetrics.monthlySummaries["2026-10"].status,"locked");
  assert.deepEqual(copy(h.model.operationalMetrics),h.persisted());
});
test("failed operational write preserves the previous in-memory source and supports retry",async()=>{
  const h=harness({fail:"metrics"});
  await assert.rejects(h.run(),/synthetic durable write denied/);
  assert.strictEqual(h.model.operationalMetrics,h.originalRef);
  assert.deepEqual(copy(h.model.operationalMetrics),h.before);
  assert.equal(h.history.length,0);
  h.stopFailing();await h.run();
  assert.deepEqual(copy(h.model.operationalMetrics),h.persisted());
  assert.equal(h.history.length,1);
});
test("exact durable readback mismatch does not accept status-only locked evidence",async()=>{
  const h=harness({misread:true});
  await assert.rejects(h.run(),/could not be verified after saving/);
  assert.strictEqual(h.model.operationalMetrics,h.originalRef);
  assert.deepEqual(copy(h.model.operationalMetrics),h.before);
  assert.equal(h.history.length,0);
  h.stopFailing();await h.run();
  assert.deepEqual(copy(h.model.operationalMetrics),h.persisted());
});
test("in-flight OneDrive-like durable operation cannot expose an unverified summary",async()=>{
  const gate=deferred(),h=harness({metricsGate:gate});
  const pending=h.run();
  for(let i=0;i<12&&h.writes.length<2;i++)await Promise.resolve();
  assert.equal(h.writes.length,2,"backup occurs before main durable write");
  assert.strictEqual(h.model.operationalMetrics,h.originalRef);
  assert.equal(h.model.operationalMetrics.monthlySummaries["2026-10"],undefined);
  gate.release();
  const result=await pending;
  assert.equal(result.status,"locked");
  assert.deepEqual(copy(h.model.operationalMetrics),h.persisted());
  assert.equal(h.history[0].details.saprPeriodEnd,"2026-10-31");
});
test("connection switch during backup refuses a write into the replacement Workspace",async()=>{
  const h=harness({onBackup:model=>{model.root={name:"different-synthetic-root"};}});
  await assert.rejects(h.run(),/source data changed during backup/);
  assert.strictEqual(h.model.operationalMetrics,h.originalRef);
  assert.deepEqual(copy(h.model.operationalMetrics),h.before);
  assert.equal(h.writes.filter(x=>x.name==="data/operational-metrics.json").length,0);
});
test("concurrent source refresh during backup invalidates stale month candidate",async()=>{
  const h=harness({onBackup:model=>{model.operationalMetrics.csi.surveys["later"]={score:4};}});
  await assert.rejects(h.run(),/source data changed during backup/);
  assert.equal(h.model.operationalMetrics.monthlySummaries["2026-10"],undefined);
  assert.equal(h.model.operationalMetrics.csi.surveys.later.score,4);
  assert.equal(h.writes.filter(x=>x.name==="data/operational-metrics.json").length,0);
});
test("workspace changes during pending durable write never installs the stale snapshot in memory",async()=>{
  const h=harness({onMetricsWrite:model=>{model.root={name:"new-root"};}});
  await assert.rejects(h.run(),/Workspace changed during durable verification/);
  assert.strictEqual(h.model.operationalMetrics,h.originalRef);
  assert.deepEqual(copy(h.model.operationalMetrics),h.before);
  assert.equal(h.history.length,0);
});
test("successful lock retains prior source, prunes only staged old months, and snapshots exactly",async()=>{
  const h=harness();
  for(let month=1;month<=25;month++){
    const year=2024+Math.floor((month-1)/12),m=String((month-1)%12+1).padStart(2,"0");
    h.model.operationalMetrics.monthlySummaries[year+"-"+m]={status:"locked",store:{roCount:month}};
  }
  const old=copy(h.model.operationalMetrics);
  await h.run();
  const months=Object.keys(h.model.operationalMetrics.monthlySummaries);
  assert.equal(months.length,24);
  assert.equal(months.includes("2026-10"),true);
  assert.equal(months.includes("2024-01"),false);
  const backup=h.durable.get("backups/synthetic-before-month-end-summary.json");
  assert.deepEqual(backup,old,"pre-lock backup preserves full original metrics snapshot");
  assert.deepEqual(copy(h.model.operationalMetrics),h.persisted());
  assert.equal(h.model.operationalMetrics.csi.surveys["synthetic-id"].score,9);
});
test("history-write failure cannot roll back already verified month or produce duplicate lock",async()=>{
  const h=harness({fail:"history"});
  await assert.rejects(h.run(),/synthetic audit history unavailable/);
  assert.deepEqual(copy(h.model.operationalMetrics),h.persisted());
  const oldWriteCount=h.writes.length;
  const result=await h.run();
  assert.equal(result.status,"locked");
  assert.equal(h.writes.length,oldWriteCount,"retry must not rewrite an already verified locked month");
});
test("production runtime still parses with the actual month-end writer",()=>{
  new vm.Script(app);
  assert.match(production,/JSON\.stringify\(check\)!==JSON\.stringify\(candidate\)/);
});
