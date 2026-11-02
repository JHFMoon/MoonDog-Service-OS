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
    csi:{imports:[{refreshDate:"2026-10-01",scopeStart:month+"-01",scopeEnd:month+"-30",scopeVerified:true}],surveys:{}},
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

test("a malformed explicit historical source start cannot finalize the month",()=>{
  const {month,metrics,performance}=completeSources(),ctx=harness();
  metrics.menu.snapshots.synthetic.periodStart="2026-02-30";
  const result=ctx.buildSummary(month,performance,metrics);
  assert.equal(result.status,"pending-finalization");
  assert.equal(result.readiness.sources.menu.state,"pending");
  assert.equal(result.readiness.sources.menu.status,"invalid");
  assert.ok(Array.from(result.needed).includes("menu"));
  assert.equal("store" in result,false,"invalid source-period lineage cannot create final totals");
});

test("stale CSI period remains pending even when its refresh timestamp reaches month end",()=>{
  const {month,metrics,performance}=completeSources(),ctx=harness();
  metrics.csi.imports[0].scopeEnd="2026-09-15";
  const result=ctx.buildSummary(month,performance,metrics);
  assert.equal(result.status,"pending-finalization");
  assert.equal(result.readiness.sources.csi.state,"pending");
  assert.ok(Array.from(result.needed).includes("csi"));
});

test("partial CSI scope cannot finalize the month even when the scope ends on month end",()=>{
  const {month,metrics,performance}=completeSources(),ctx=harness();
  metrics.csi.imports[0].scopeStart="2026-09-02";
  const result=ctx.buildSummary(month,performance,metrics);
  assert.equal(result.status,"pending-finalization");
  assert.equal(result.readiness.sources.csi.state,"pending");
  assert.equal(result.readiness.sources.csi.status,"unverified-scope");
  assert.ok(Array.from(result.needed).includes("csi"));
});

test("an early CSI export cannot finalize a month before its observation date reaches month end",()=>{
  const {month,metrics,performance}=completeSources(),ctx=harness();
  metrics.csi.imports[0].refreshDate="2026-09-15";
  metrics.csi.imports[0].importedAt="2026-09-15T16:00:00.000Z";
  const result=ctx.buildSummary(month,performance,metrics);
  assert.equal(result.status,"pending-finalization");
  assert.equal(result.readiness.sources.csi.state,"pending");
  assert.ok(Array.from(result.needed).includes("csi"));
});

test("an explicitly unused CSI source does not block finalization without a report",()=>{
  const {month,metrics,performance}=completeSources(),ctx=harness({csi:"not-used"});
  metrics.csi.imports=[];
  const result=ctx.buildSummary(month,performance,metrics);
  assert.equal(result.status,"locked");
  assert.equal(result.readiness.csi.state,"not-used");
});

test("month-end readiness selects the latest CSI import that covers the target month",()=>{
  const {month,metrics,performance}=completeSources(),ctx=harness();
  metrics.csi.imports.push({refreshDate:"2026-10-02",scopeStart:"2026-10-01",scopeEnd:"2026-10-02",scopeVerified:true});
  const result=ctx.buildSummary(month,performance,metrics);
  assert.equal(result.status,"locked","a newer import for another month cannot hide retained full-month evidence");
  assert.equal(result.readiness.csi.state,"ready");
});

test("CSI with absent or unverified report scope remains pending despite a recent refresh",()=>{
  const {month,metrics,performance}=completeSources(),ctx=harness();
  delete metrics.csi.imports[0].scopeStart;
  delete metrics.csi.imports[0].scopeEnd;
  metrics.csi.imports[0].scopeVerified=false;
  const result=ctx.buildSummary(month,performance,metrics);
  assert.equal(result.status,"pending-finalization");
  assert.equal(result.readiness.sources.csi.state,"pending");
  assert.equal(result.readiness.sources.csi.status,"unverified-scope");
});

test("same-period conflicting pending VIR evidence cannot lock the monthly summary",()=>{
  const {month,metrics,performance}=completeSources(),ctx=harness();
  const durable=metrics.vir.snapshots.synthetic;
  durable.store={utilization:0.6};
  metrics.vir.pending={syntheticPending:{...durable,store:{utilization:0.75}}};
  const result=ctx.buildSummary(month,performance,metrics);
  assert.equal(result.status,"pending-finalization");
  assert.equal(result.readiness.sources.vir.state,"pending");
  assert.equal(result.readiness.sources.vir.status,"conflict");
  assert.ok(Array.from(result.needed).includes("vir"));
  assert.equal("store" in result,false,"conflicting monthly inputs cannot produce final totals");
});

test("explicit zero remains a real metric while missing fields remain unknown",()=>{
  const {month,metrics,performance}=completeSources(),ctx=harness();
  performance.synthetic.store=Object.fromEntries([["totalGross",0],["cpGross",0],["totalRO",0],["cpHours",0],["cpElr",0]]);
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


test("conflicting duplicate monthly snapshots across source families cannot silently select a final value",()=>{
  const cases=[
    ["sapr","totalGross",(data)=>data.performance,(data)=>data.performance.synthetic],
    ["vir","utilization",(data)=>data.metrics.vir.snapshots,(data)=>data.metrics.vir.snapshots.synthetic],
    ["menu","presentation",(data)=>data.metrics.menu.snapshots,(data)=>data.metrics.menu.snapshots.synthetic],
    ["mediaAsr","mediaViewedRate",(data)=>data.metrics.mediaAsr.snapshots,(data)=>data.metrics.mediaAsr.snapshots.synthetic]
  ];
  for(const [source,field,snapshotsFor,originalFor] of cases){
    const data=completeSources(),ctx=harness();
    const snapshots=snapshotsFor(data),original=originalFor(data);
    original.store={[field]:0.6};
    snapshots.syntheticDuplicate={...original,store:{...original.store,[field]:0.75}};
    const result=ctx.buildSummary(data.month,data.performance,data.metrics);
    assert.equal(result.status,"pending-finalization",source+" conflict cannot lock the month");
    assert.equal(result.readiness.sources[source].state,"pending",source+" source remains pending");
    assert.equal(result.readiness.sources[source].status,"conflict",source+" conflict stays explicit");
    assert.ok(Array.from(result.needed).includes(source),source+" conflict remains actionable");
    assert.equal("store" in result,false,source+" conflicting data cannot produce final totals");
  }
});

test("equivalent duplicate monthly snapshots remain idempotent across source families",()=>{
  const cases=[
    ["sapr",(data)=>data.performance,(data)=>data.performance.synthetic],
    ["vir",(data)=>data.metrics.vir.snapshots,(data)=>data.metrics.vir.snapshots.synthetic],
    ["menu",(data)=>data.metrics.menu.snapshots,(data)=>data.metrics.menu.snapshots.synthetic],
    ["mediaAsr",(data)=>data.metrics.mediaAsr.snapshots,(data)=>data.metrics.mediaAsr.snapshots.synthetic]
  ];
  for(const [source,snapshotsFor,originalFor] of cases){
    const data=completeSources(),ctx=harness(),snapshots=snapshotsFor(data),original=originalFor(data);
    snapshots.syntheticEquivalent={...original};
    const result=ctx.buildSummary(data.month,data.performance,data.metrics);
    assert.equal(result.status,"locked",source+" equivalent snapshot remains valid");
    const readiness=result.readiness.sources||result.readiness;
    assert.equal(readiness[source].state,"ready");
  }
});


test("conflicting CSI imports for the same verified scope and refresh date keep month-end readiness pending",()=>{
  const {month,metrics,performance}=completeSources(),ctx=harness();
  const original=metrics.csi.imports[0];
  Object.assign(original,{coverageStart:month+"-01",coverageEnd:month+"-30",dailySummary:{storeNps:42,responses:4},rows:4,unresolvedAdvisorCount:0,metricSnapshotSha256:"a".repeat(64)});
  metrics.csi.imports.push({...original,sourceFile:"CSI-synthetic-conflict.csv",importedAt:"2026-10-02T12:00:00.000Z",metricSnapshotSha256:"b".repeat(64)});
  const result=ctx.buildSummary(month,performance,metrics);
  assert.equal(result.status,"pending-finalization");
  assert.equal(result.readiness.sources.csi.state,"pending");
  assert.equal(result.readiness.sources.csi.status,"conflict");
  assert.ok(Array.from(result.needed).includes("csi"));
  assert.equal("store" in result,false,"conflicting CSI evidence cannot produce final totals");
});

test("equivalent CSI duplicate imports on the same refresh date remain idempotent",()=>{
  const {month,metrics,performance}=completeSources(),ctx=harness();
  const original=metrics.csi.imports[0];
  Object.assign(original,{coverageStart:month+"-01",coverageEnd:month+"-30",dailySummary:{storeNps:42,responses:4},rows:4,unresolvedAdvisorCount:0,metricSnapshotSha256:"a".repeat(64)});
  metrics.csi.imports.push({...original,sourceFile:"CSI-synthetic-equivalent.xlsx",format:"xlsx",importedAt:"2026-10-02T12:00:00.000Z"});
  const result=ctx.buildSummary(month,performance,metrics);
  assert.equal(result.status,"locked","same-content reimports stay idempotent");
  assert.equal(result.readiness.csi.state,"ready");
});

test("later CSI refreshes for the same scope remain eligible as current evidence",()=>{
  const {month,metrics,performance}=completeSources(),ctx=harness();
  const original=metrics.csi.imports[0];
  Object.assign(original,{coverageStart:month+"-01",coverageEnd:month+"-30",dailySummary:{storeNps:42,responses:4},rows:4,unresolvedAdvisorCount:0,metricSnapshotSha256:"a".repeat(64)});
  metrics.csi.imports.push({...original,sourceFile:"CSI-synthetic-later-refresh.csv",refreshDate:"2026-10-02",importedAt:"2026-10-02T12:00:00.000Z",dailySummary:{storeNps:75,responses:5},rows:5,metricSnapshotSha256:"b".repeat(64)});
  const result=ctx.buildSummary(month,performance,metrics);
  assert.equal(result.status,"locked","a later refresh is a new observation, not a duplicate conflict");
  assert.equal(result.readiness.csi.state,"ready");
});

test("CSI metric snapshot fingerprint includes stable survey metrics but excludes comments",()=>{
  const repo="JHFMoon/MoonDog-Service-OS";
  const start=app.indexOf("  function csiMetricSnapshotPayload("),end=app.indexOf("\n  function parseCsiRows(",start);
  assert.ok(start>=0&&end>start);
  const context={};vm.runInNewContext(app.slice(start,end),context);
  const surveys={
    id_b:{id:"id_b",surveyDate:"2026-09-20",score:2,classification:"Detractor",advisorCode:"202",managerComment:"Synthetic private comment"},
    id_a:{id:"id_a",surveyDate:"2026-09-10",score:10,classification:"Promoter",advisorCode:"101",managerComment:"Another synthetic comment"}
  };
  const baseline=context.csiMetricSnapshotPayload(surveys);
  assert.equal(context.csiMetricSnapshotPayload({id_a:surveys.id_a,id_b:surveys.id_b}),baseline,"fingerprint ordering is stable");
  assert.notEqual(context.csiMetricSnapshotPayload({...surveys,id_b:{...surveys.id_b,advisorCode:"101"}}),baseline,"advisor assignment affects month-end advisor totals");
  assert.notEqual(context.csiMetricSnapshotPayload({...surveys,id_b:{...surveys.id_b,classification:"Passive"}}),baseline,"classification affects NPS metrics");
  assert.notEqual(context.csiMetricSnapshotPayload({...surveys,id_b:{...surveys.id_b,score:7}}),baseline,"score affects NPS metrics");
  assert.notEqual(context.csiMetricSnapshotPayload({...surveys,id_b:{...surveys.id_b,surveyDate:"2026-09-21"}}),baseline,"survey date affects reporting scope");
  assert.equal(context.csiMetricSnapshotPayload({...surveys,id_b:{...surveys.id_b,managerComment:"Changed synthetic note"}}),baseline,"non-metric comments are excluded");
});

test("legacy CSI duplicates without a metric fingerprint remain a visible conflict",()=>{
  const {month,metrics,performance}=completeSources(),ctx=harness();
  metrics.csi.imports.push({...metrics.csi.imports[0],sourceFile:"legacy-synthetic-copy.csv",importedAt:"2026-10-02T12:00:00.000Z"});
  const result=ctx.buildSummary(month,performance,metrics);
  assert.equal(result.status,"pending-finalization");
  assert.equal(result.readiness.sources.csi.status,"conflict");
});


test("month-end SAPR readiness never locks with negative, zero-total, or over-reported workdays",()=>{
  for(const [completed,total] of [[-1,-2],[0,0],[23,22]]){
    const {month,metrics,performance}=completeSources(),ctx=harness();
    performance.synthetic.saprDaysCompleted=completed;
    performance.synthetic.saprTotalDays=total;
    const readiness=ctx.readiness(month,metrics,performance);
    assert.equal(readiness.ready,false,"invalid SAPR days "+completed+"/"+total);
    assert.equal(readiness.sources.sapr.state,"pending");
    const summary=ctx.buildSummary(month,performance,metrics);
    assert.equal(summary.status,"pending-finalization");
    assert.ok(Array.from(summary.needed).includes("sapr"));
    assert.equal("store" in summary,false,"invalid days cannot create a locked monthly result");
  }
  const {month,metrics,performance}=completeSources(),ctx=harness();
  const valid=ctx.buildSummary(month,performance,metrics);
  assert.equal(valid.status,"locked","exact verified positive total remains eligible");
});
