"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

// Exercise the production month-end correction apply function with a synthetic
// verified candidate and fault-injected durable writes/readbacks.
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf("  async function applyMonthEndCorrection(");
const end=app.indexOf("  function syncArrivalDate(",start);
assert.ok(start>=0&&end>start,"production month-end correction apply function must exist");

function fixture({failBackup=false,failWrite=false,mismatchReadback=false}={}){
  const month="2026-09",original={schemaVersion:2,status:"locked",lockedAt:"original-lock",basis:{saprPeriodEnd:"2026-09-30"},advisors:{}},candidate={schemaVersion:2,status:"locked",lockedAt:"new-lock",basis:{saprPeriodEnd:"2026-09-30"},advisors:{"123":{name:"Synthetic Advisor",metrics:{syntheticValue:0.75}}}};
  const model={operationalMetrics:{updatedAt:"prior-update",monthlySummaries:{[month]:original}}};
  const events=[];
  const context={
    model,window:{confirm:()=>true},OPERATIONAL_METRICS_PATH:["data","operational-metrics.json"],
    monthEndCorrectionCandidate:()=>structuredClone(candidate),stamp:()=>"2026-10-21T12-00-00-000Z",now:()=>"2026-10-21T12:00:00Z",
    writeJson:async(parts)=>{const key=parts.join("/");events.push(["write",key]);if(key.startsWith("backups/")&&failBackup)throw Error("synthetic backup failure");if(key==="data/operational-metrics.json"&&failWrite)throw Error("synthetic operational-metrics write failure");},
    readJson:async()=>mismatchReadback?{monthlySummaries:{[month]:{status:"locked",lockedAt:"other"}}}:structuredClone(model.operationalMetrics),
    addHistory:async(type)=>events.push(["history",type]),renderAll:()=>events.push(["render"])
  };
  const apply=vm.runInNewContext(app.slice(start,end)+"\nglobalThis.apply=applyMonthEndCorrection;",context);
  return{run:()=>context.apply(month),model,events,original};
}

test("verified correction persists before history and render",async()=>{
  const f=fixture();await f.run();
  assert.equal(f.model.operationalMetrics.monthlySummaries["2026-09"].correctedAt,"2026-10-21T12:00:00Z");
  assert.equal(f.model.operationalMetrics.monthlySummaries["2026-09"].correctionOf,"original-lock");
  assert.deepEqual(f.events.map(([type])=>type),["write","write","history","render"]);
});

test("backup failure leaves the original in-memory summary untouched",async()=>{
  const f=fixture({failBackup:true});await assert.rejects(f.run(),/synthetic backup failure/);
  assert.strictEqual(f.model.operationalMetrics.monthlySummaries["2026-09"],f.original);
  assert.deepEqual(f.events.map(([type])=>type),["write"]);
});

test("operational write failure rolls back in-memory summary and update timestamp",async()=>{
  const f=fixture({failWrite:true});await assert.rejects(f.run(),/synthetic operational-metrics write failure/);
  assert.strictEqual(f.model.operationalMetrics.monthlySummaries["2026-09"],f.original);
  assert.equal(f.model.operationalMetrics.updatedAt,"prior-update");
  assert.equal(f.events.some(([type])=>type==="history"),false);
});

test("mismatched readback rolls back in-memory correction and records no success",async()=>{
  const f=fixture({mismatchReadback:true});await assert.rejects(f.run(),/could not be verified after saving/);
  assert.strictEqual(f.model.operationalMetrics.monthlySummaries["2026-09"],f.original);
  assert.equal(f.model.operationalMetrics.updatedAt,"prior-update");
  assert.equal(f.events.some(([type])=>type==="history"),false);
});
