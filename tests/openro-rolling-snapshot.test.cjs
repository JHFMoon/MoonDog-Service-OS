"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function extract(start,end){
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"Production code markers missing: "+start);
  return app.slice(a,b);
}
const save=extract("  async function retainDailyReport(","  function trendCoverageAudit(");
const coverage=extract("  function dailySourceCoverage(","  // Retain compact reports");
const workload=extract("  function openRoWorkloadSnapshot(","  function ensureAssignDay(");

function fixture({failingWrite=false,missingFamily=false}={}){
  const earlier={
    "2026-10-13":{coverageDate:"2026-10-13",sourceFile:"old-synthetic.xlsx"},
    "2026-10-20":{coverageDate:"2026-10-20",sourceFile:"newer-synthetic.xlsx"}
  };
  const model={
    operationalMetrics:missingFamily?{updatedAt:"older"}:
      {updatedAt:"older",openRo:{dailySnapshots:structuredClone(earlier)},sapr:{dailySnapshots:{"2026-10-19":{coverageDate:"2026-10-19"}}}},
    state:{source:{importedAt:"2026-10-21T16:12:00.000Z",sourceModifiedAt:"2026-10-19T20:00:00.000Z",fileName:"synthetic-openro.xlsx"}}
  };
  const saves=[];
  const context={
    model,structuredClone,OPERATIONAL_METRICS_PATH:["data","metrics.json"],
    now:()=>"2026-10-21T16:20:00.000Z",
    localDateKey:()=>"2026-10-21",
    coverageTimestamp:value=>typeof value==="string"&&Number.isFinite(Date.parse(value))?value.slice(0,10):"",
    dailyEvidenceDate:(key,row)=>row?.coverageDate||row?.importedAt?.slice(0,10)||"",
    writeJson:async(path,value)=>{if(failingWrite)throw Error("synthetic write denied");saves.push(structuredClone(value));},
    currentMonthWindow:date=>({start:date.slice(0,7)+"-01",end:date,expectedDates:["2026-10-20"]}),
    SOURCE_COVERAGE_RULES:{openRo:{trend:"operational"},sapr:{trend:"daily-snapshot"}},
    allVirObservations:()=>[],sourceTrendObservations:()=>[],
    storeDateKey:date=>date.toISOString().slice(0,10),
    canonicalWorkloadRecords:records=>records,
    sourceRecordIsOpen:status=>status!=="CLOSED"
  };
  vm.runInNewContext(save+"\n"+coverage+"\n"+workload,context);
  return {context,model,saves,save:(key,row)=>context.retainDailyReport(key,row),
    coverage:date=>context.dailySourceCoverage("openRo",date),
    workload:(records,source,modified)=>context.openRoWorkloadSnapshot(records,source,modified)};
}

test("Open RO daily observations replace previous dates rather than accumulating trend history",async()=>{
  const f=fixture();
  await f.save("openRo",{importedAt:"2026-10-21T16:12:00.000Z",
    sourceModifiedAt:"2026-10-19T20:00:00.000Z",sourceFile:"synthetic-openro.xlsx",rowCount:397});
  const rows=f.model.operationalMetrics.openRo.dailySnapshots;
  assert.deepEqual(Object.keys(rows),["2026-10-21"]);
  assert.equal(rows["2026-10-21"].rowCount,397);
  assert.equal(rows["2026-10-21"].sourceModifiedAt,"2026-10-19T20:00:00.000Z");
  await f.save("openRo",{importedAt:"2026-10-21T17:34:00.000Z",
    sourceModifiedAt:"2026-10-21T17:32:00.000Z",sourceFile:"later-synthetic.xlsx",rowCount:392});
  assert.deepEqual(Object.keys(f.model.operationalMetrics.openRo.dailySnapshots),["2026-10-21"]);
  assert.equal(f.model.operationalMetrics.openRo.dailySnapshots["2026-10-21"].rowCount,392);
  assert.equal(f.saves.length,2);
  assert.equal(f.model.operationalMetrics.sapr.dailySnapshots["2026-10-19"].coverageDate,"2026-10-19");
});
test("Open RO can initialize absent optional metrics family",async()=>{
  const f=fixture({missingFamily:true});
  await f.save("openRo",{importedAt:"2026-10-21T17:12:00.000Z",rowCount:4});
  assert.deepEqual(Object.keys(f.model.operationalMetrics.openRo.dailySnapshots),["2026-10-21"]);
});
test("invalid observation does not discard previously verified Open RO",async()=>{
  const f=fixture();
  const before=structuredClone(f.model.operationalMetrics);
  await f.save("openRo",{importedAt:"",rowCount:0});
  assert.deepEqual(f.model.operationalMetrics,before);
  assert.equal(f.saves.length,0);
});
test("failed rolling snapshot write restores previous metrics and old evidence",async()=>{
  const f=fixture({failingWrite:true}),old=structuredClone(f.model.operationalMetrics);
  await assert.rejects(f.save("openRo",{importedAt:"2026-10-21T18:00:00.000Z",rowCount:10}),/synthetic write denied/);
  assert.deepEqual(f.model.operationalMetrics,old);
});
test("Open RO coverage uses only canonical active source, not cached historical snapshots",()=>{
  const f=fixture();
  const date=f.coverage("2026-10-21");
  assert.deepEqual(Array.from(date.presentDates),["2026-10-21"]);
  assert.equal(date.lastPoint,"2026-10-21");
  f.model.state.source=null;
  const absent=f.coverage("2026-10-21");
  assert.deepEqual(Array.from(absent.presentDates),[]);
  assert.equal(absent.lastPoint,"");
});
test("Assign Next uses accepted import time for freshness, keeping original file time as audit",()=>{
  const f=fixture();
  const item=f.workload([{ro:"90001",advisorCode:"101",opened:"2026-10-20",sourceStatus:"WORKING"}],
    {importedAt:"2026-10-21T18:01:00.000Z",sourceModifiedAt:"2026-10-20T20:00:00.000Z",fileName:"synthetic.xlsx"},
    "2026-10-20T20:00:00.000Z");
  assert.equal(item.asOf,"2026-10-21T18:01:00.000Z");
  assert.equal(item.coverageDate,"2026-10-21");
  assert.equal(item.sourceModifiedAt,"2026-10-20T20:00:00.000Z");
  assert.equal(item.records.length,1);
});
test("other report families still collect dated trend points",async()=>{
  const f=fixture();
  await f.save("sapr",{coverageDate:"2026-10-20",roCount:21});
  assert.deepEqual(Object.keys(f.model.operationalMetrics.sapr.dailySnapshots),["2026-10-19","2026-10-20"]);
});
test("Open RO coverage panel does not ask for a date range or historical trend",()=>{
  const ui=fs.readFileSync(path.join(__dirname,"..","assets","daily-ops.js"),"utf8");
  assert.match(ui,/row\.key==='openRo'[\s\S]*?current verified snapshot only; no historical date range or trend is required/);
  new vm.Script(ui);
});
test("production source and safety checks remain intact",()=>{
  new vm.Script(app);
  assert.match(app,/function sourceFreshness\(key, options = \{\}\)/);
  assert.match(app,/sourceTimestamp: item\?\.importedAt, sourceDate: item\?\.importedAt \? localDateKey/);
  assert.match(app,/verifyCompleteRoImport\(name, file, bytes, incoming\)/);
  assert.match(app,/await backupState\("before-import"\)/);
  assert.match(app,/mergeCompleteOpenRoRecords\(incoming,importedAt,"open-ro-xlsx"\)/);
});
