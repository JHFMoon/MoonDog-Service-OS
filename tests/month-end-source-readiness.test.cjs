"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const app=read("assets/app.js");
function source(name){
  const start=app.indexOf("  function "+name+"(");
  const end=app.indexOf("\n  function ",start+11);
  assert.ok(start>=0&&end>start,"production helper exists: "+name);
  return app.slice(start,end);
}
const production=[
  source("lastDayOfMonth"),source("monthFinalOperatingDate"),
  source("virObservationDate"),source("latestMonthlySnapshot"),
  source("monthEndSourceReadiness"),source("monthlyMetricEntity"),
  source("buildMonthEndSummary")
].join("\n");

function harness(expectations={}){
  const context=vm.createContext({
    Date,Intl,console,
    model:{settings:{setup:{sourceExpectations:expectations},advisors:{}},operationalMetrics:{}},
    localDateKey:value=>new Date(value).toISOString().slice(0,10),
    sourceExpectation:key=>expectations[key]||"recommended",
    npsSummary:()=>({nps:null,responses:0}),
    validAdvisorIdentity:()=>false,
    advisorDisplayName:(_code,source)=>source?.name||"Synthetic Advisor",
    now:()=>"2026-10-01T12:00:00.000Z"
  });
  vm.runInNewContext(read("assets/freshness.js")+"\nthis.MoonDogFreshness=globalThis.MoonDogFreshness;",context);
  context.freshness=context.MoonDogFreshness;
  vm.runInNewContext(production+"\nthis.buildSummary=buildMonthEndSummary;this.readiness=monthEndSourceReadiness;",context);
  return context;
}
function completeSources(){
  const month="2026-09";
  const period={periodStart:month+"-01",periodEnd:month+"-30"};
  const performance={...period,saprDaysCompleted:22,saprTotalDays:22,store:{},advisors:{}};
  const metrics={
    csi:{imports:[{...period,latestCsiRefreshDate:month+"-30"}],surveys:{}},
    vir:{snapshots:{synthetic:{...period,observationTimestamp:month+"-30T12:00:00.000Z"}}},
    menu:{snapshots:{synthetic:{...period}}},
    mediaAsr:{snapshots:{synthetic:{...period}}}
  };
  return {month,metrics,performance:{synthetic:performance}};
}

test("month-end finalization remains pending until every required source covers the operating period",()=>{
  const ctx=harness(),month="2026-09";
  const metrics={csi:{imports:[],surveys:{}},vir:{snapshots:{}},menu:{snapshots:{}},mediaAsr:{snapshots:{}}};
  const result=ctx.buildSummary(month,{},metrics);
  assert.equal(result.status,"pending-finalization");
  assert.deepEqual(Array.from(result.needed),["sapr","vir","menu","mediaAsr","csi"]);
  assert.equal("store" in result,false,"incomplete source evidence cannot create final totals");
});

test("complete synthetic source periods lock with explicit source provenance and zero CSI responses remain valid",()=>{
  const {month,metrics,performance}=completeSources(),ctx=harness();
  const readiness=ctx.readiness(month,metrics,performance);
  assert.equal(readiness.ready,true);
  const result=ctx.buildSummary(month,performance,metrics);
  assert.equal(result.status,"locked");
  assert.equal(result.basis.saprPeriodEnd,"2026-09-30");
  assert.equal(result.basis.virPeriodEnd,"2026-09-30");
  assert.equal(result.basis.menuPeriodEnd,"2026-09-30");
  assert.equal(result.basis.mediaPeriodEnd,"2026-09-30");
  assert.equal(result.basis.csiResponses,0,"verified zero-response evidence is distinct from missing import");
  assert.equal(result.readiness.csi.state,"ready");
});

test("temporarily unavailable historical sources remain pending, while explicit not-used scope is recorded",()=>{
  const {month,metrics,performance}=completeSources();
  delete metrics.mediaAsr;
  const pending=harness({mediaAsr:"temporarily-unavailable"});
  const blocked=pending.buildSummary(month,performance,metrics);
  assert.equal(blocked.status,"pending-finalization");
  assert.ok(Array.from(blocked.needed).includes("mediaAsr"));

  const optional=harness({mediaAsr:"not-used"});
  const ready=optional.readiness(month,metrics,performance);
  assert.equal(ready.sources.mediaAsr.state,"not-used");
  assert.equal(ready.ready,true);
});
