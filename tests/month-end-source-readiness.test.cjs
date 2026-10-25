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
  for(const metric of ["totalGross","cpGross","roCount","cpHoursPerRo","cpElr","vir","menuPresentation","menuPenetration","mediaViewed","nps"]){
    assert.equal(result.store[metric],null,`missing ${metric} remains unknown instead of zero`);
  }
});

test("stale CSI period remains pending even when its refresh timestamp reaches month end",()=>{
  const {month,metrics,performance}=completeSources(),ctx=harness();
  metrics.csi.imports[0].periodEnd="2026-09-15";
  const result=ctx.buildSummary(month,performance,metrics);
  assert.equal(result.status,"pending-finalization");
  assert.equal(result.readiness.csi.state,"pending");
  assert.ok(Array.from(result.needed).includes("csi"));
});

test("same-period conflicting pending VIR evidence cannot lock the monthly summary",()=>{
  const {month,metrics,performance}=completeSources(),ctx=harness();
  const durable=metrics.vir.snapshots.synthetic;
  durable.store={utilization:0.6};
  metrics.vir.pending={syntheticPending:{...durable,store:{utilization:0.75}}};
  const result=ctx.buildSummary(month,performance,metrics);
  assert.equal(result.status,"pending-finalization");
  assert.equal(result.readiness.vir.state,"pending");
  assert.equal(result.readiness.vir.status,"conflict");
  assert.ok(Array.from(result.needed).includes("vir"));
  assert.equal("store" in result,false,"conflicting monthly inputs cannot produce final totals");
});

test("explicit zero remains a real metric while missing fields remain unknown",()=>{
  const {month,metrics,performance}=completeSources(),ctx=harness();
  performance.synthetic.store={totalGross:0,cpGross:0,totalRO:0,cpHours:0,cpElr:0};
  metrics.vir.snapshots.synthetic.store={utilization:0};
  metrics.menu.snapshots.synthetic.store={presentation:0,penetration:0};
  metrics.mediaAsr.snapshots.synthetic.store={mediaViewedRate:0};
  const result=ctx.buildSummary(month,performance,metrics);
  assert.equal(result.status,"locked");
  for(const metric of ["totalGross","cpGross","roCount","cpHoursPerRo","cpElr","vir","menuPresentation","menuPenetration","mediaViewed"]){
    assert.equal(result.store[metric],0,`explicit zero ${metric} is preserved`);
  }
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
