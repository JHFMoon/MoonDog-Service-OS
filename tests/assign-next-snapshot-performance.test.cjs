"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {performance}=require("node:perf_hooks");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function section(startText,endText){
  const start=app.indexOf(startText),end=app.indexOf(endText,start);
  assert.ok(start>=0&&end>start,startText+" production section must exist");
  return app.slice(start,end);
}
const setup=section("  function ensureAssignDay(","  function openedTodayVerified(");
const opened=section("  function openedTodayVerified(","  async function saveOpenRoWorkload(");
const rows=section("  function assignNextRows(","  function renderAssignNext()");
const instrumented=setup.replace(
  "const snapshot=model.assignNext.currentOpenRo, records=snapshot?.records;",
  "globalThis.__validationCalls=(globalThis.__validationCalls||0)+1;const snapshot=model.assignNext.currentOpenRo, records=snapshot?.records;"
);
assert.notEqual(instrumented,setup,"count real production snapshot validations");

const DAY="2026-10-21";
const ADVISORS={"1001":"Advisor A","1002":"Advisor B","1003":"Advisor C","1004":"Advisor D","1005":"Advisor E","1006":"Advisor F"};
function fixture(count){
  const records=Array.from({length:count},(_,i)=>({
    ro:String(100000+i),advisorCode:Object.keys(ADVISORS)[i%6],isOpen:true,openedDate:DAY
  }));
  const snapshot=count?{
    sourceType:"open-ro",records,asOf:"2026-10-21T15:00:00Z",coverageDate:DAY,
    validation:{canonicalRecords:count}
  }:null;
  const context=vm.createContext({
    model:{assignNext:{currentOpenRo:snapshot,days:{}},performance:{snapshots:{}}},
    ASSIGN_NEXT_ADVISORS:ADVISORS,
    storeDateKey:()=>DAY,
    text:value=>String(value??""),
    businessTimeZone:()=>"America/Los_Angeles",
    freshness:{evaluateSource:()=>({safeForCurrent:true})},
    globalThis:null
  });
  context.globalThis=context;
  vm.runInContext(instrumented+"\n"+opened+"\n"+rows+
    "\nglobalThis.runOld=()=>{const day=ensureAssignDay();const snapshot=activeWorkloadSnapshot(day.date);return {snapshot,rows:assignNextRows(day.date)}};"+
    "\nglobalThis.runOptimized=()=>{const day=ensureAssignDay();const snapshot=activeWorkloadSnapshot(day.date);return {snapshot,rows:assignNextRows(day.date,snapshot)}};",context);
  return context;
}
function signature(result){
  return JSON.stringify({snapshot:result.snapshot?{count:result.snapshot.records.length}:null,rows:result.rows});
}
function measure(run,iterations=16){
  const values=[];
  for(let i=0;i<iterations;i++){
    const start=performance.now();run();values.push(performance.now()-start);
  }
  values.sort((a,b)=>a-b);
  return {p50:+values[Math.ceil(values.length*.5)-1].toFixed(3),p95:+values[Math.ceil(values.length*.95)-1].toFixed(3)};
}

test("Assign Next reuses the validated workload snapshot without changing recommendations",()=>{
  for(const count of [0,5000]){
    const baseline=fixture(count),optimized=fixture(count);
    baseline.__validationCalls=0;optimized.__validationCalls=0;
    const before=baseline.runOld(),after=optimized.runOptimized();
    if(count){
      assert.ok(before.snapshot&&after.snapshot,"numeric advisor codes must keep the large workload valid");
      assert.equal(before.snapshot.records.length,count);
      assert.equal(after.snapshot.records.length,count);
      assert.deepEqual(Array.from(before.rows,row=>row.open).sort((a,b)=>a-b),[833,833,833,833,834,834]);
    }else{
      assert.equal(before.snapshot,null);assert.equal(after.snapshot,null);
    }
    assert.equal(baseline.__validationCalls,2,"existing render path validates once for the summary and again in assignNextRows");
    assert.equal(optimized.__validationCalls,1,"optimized render path validates once and passes the same snapshot to row selection");
    assert.equal(signature(after),signature(before),"advisor counts, availability and ranking must remain identical");
    const oldRun=()=>baseline.runOld(),newRun=()=>optimized.runOptimized();
    oldRun();newRun();
    const oldTiming=measure(oldRun),newTiming=measure(newRun);
    console.log("#58 Assign Next snapshot reuse (synthetic calculation path only):",JSON.stringify({
      dataset:count?"synthetic-5000-open-ros":"synthetic-empty-workload",
      iterations:16,beforeP50Ms:oldTiming.p50,afterP50Ms:newTiming.p50,
      beforeP95Ms:oldTiming.p95,afterP95Ms:newTiming.p95,
      validationsPerRenderBefore:2,validationsPerRenderAfter:1
    }));
  }
});
