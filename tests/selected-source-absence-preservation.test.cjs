"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const freshness=require("../assets/freshness.js");

// Execute the published production adapter, not a parallel/test-only implementation.
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const begin=app.indexOf("  function sourceFreshness(key, options = {}) {");
const end=app.indexOf("  function metricDependencyEvidence(",begin);
assert.ok(begin>=0&&end>begin,"production source-authority adapter exists");
const source=app.slice(begin,end);
const TODAY="2026-10-30",CURRENT_IMPORT="2026-10-30T18:00:00.000Z";
const copy=value=>JSON.parse(JSON.stringify(value));
const interval={periodStart:"2026-10-01",periodEnd:"2026-10-29",importedAt:CURRENT_IMPORT};
const reference={
  ...interval,period:"2026-10",sourceFile:"synthetic-reference.xlsx",metrics:{gross:0}
};
const selected={
  openRo:{reportDate:TODAY,importedAt:CURRENT_IMPORT},
  sapr:{...interval,store:{totalGross:0},advisors:{"101":{totalGross:0}},
    validation:{advisorDetailSheets:1,saprDaysVerified:true}},
  csi:{scopeVerified:true,scopeStart:"2026-10-01",scopeEnd:"2026-10-29",
    reportObservationVerified:true,reportObservationDate:"2026-10-29",importedAt:CURRENT_IMPORT},
  nextAppointments:{...interval,validation:{periodVerified:true}},
  vir:{observationDate:"2026-10-29",
    observationTimestamp:"2026-10-29T18:00:00.000Z",importedAt:CURRENT_IMPORT},
  menu:{periodStart:"2026-10-26",periodEnd:"2026-11-01",
    releaseWeek:"2026-10-26",importedAt:CURRENT_IMPORT},
  appointments:{date:TODAY,importedAt:CURRENT_IMPORT},
  supervisorWorkbook:{generatedAt:"2026-10-29T18:00:00.000Z",stale:false},
  sor:copy(reference),appointmentActivity:copy(reference),
  efficiency:copy(reference),mediaAsr:copy(reference),
  mediaAsrTech:copy(reference),openRoSummary:copy(reference)
};
const families=Object.keys(selected);
function fixture(){
  const snapshots=copy(selected),calls=[];
  const model={
    state:{source:snapshots.openRo,records:[{
      ro:"SYNTHETIC-ONLY",
      management:{status:"MANAGER-REVIEWED",ownerAssignmentSource:"manager-cleared",
        notes:"Retained local manager decision"}
    }]},
    performance:{snapshots:{current:snapshots.sapr}},
    operationalMetrics:{csi:{imports:[snapshots.csi]}},
    appointments:{days:{[TODAY]:snapshots.appointments}},
    recovery:{supervisorWorkbook:snapshots.supervisorWorkbook}
  };
  const before=JSON.stringify(model);
  const context=vm.createContext({
    freshness,Date,Intl,model,
    businessTimeZone:()=> "UTC",
    localDateKey:value=>value instanceof Date?value.toISOString().slice(0,10):TODAY,
    sourceExpectation:()=> "recommended",
    currentSaprSnapshot:()=>{calls.push("sapr");return snapshots.sapr;},
    latestOperationalSnapshot:key=>{calls.push(key);return snapshots[key];},
    latestVirObservation:()=>{calls.push("vir");return snapshots.vir;},
    verifiedVirSourceObservationDate:item=>item?.observationDate||"",
    verifiedMenuTrendReleases:({retained})=>new Set(retained?.releaseWeek?[retained.releaseWeek]:[]),
    validCoverageDate:value=>freshness.validDateKey(value)?value:"",
    csiReportedPeriod:(start,end)=>({
      periodStart:start,periodEnd:end,verified:Boolean(start&&end)
    }),
    lastDayOfMonth:freshness.lastDayOfMonth
  });
  vm.runInContext(source+"\nthis.evaluate=sourceFreshness;",context);
  return {model,calls,before,source:key=>context.evaluate(key,{today:TODAY}),
    evaluate:(key,item)=>context.evaluate(key,{today:TODAY,item})};
}

test("explicit null and undefined remain MISSING for every registered source family",()=>{
  const f=fixture();
  assert.equal(families.length,14);
  for(const key of families){
    for(const item of [null,undefined]){
      const evidence=f.evaluate(key,item);
      assert.equal(evidence.status,"missing",key+" selected absent source");
      assert.equal(evidence.loaded,false,key+" cannot inherit stored source");
      assert.equal(evidence.reportPeriodVerified,false,key+" cannot certify coverage");
      assert.equal(evidence.importTimestamp,"",key+" cannot borrow import timestamp");
      assert.equal(freshness.evaluateMetric([evidence]).verified,false,key+" metric must remain unknown");
    }
  }
  assert.deepEqual(f.calls,[],"explicit selection never consults a retained source fallback");
  assert.equal(JSON.stringify(f.model),f.before,"source evaluation cannot mutate manual RO data");
});

test("omitted source selection deliberately keeps automatic retained lookup",()=>{
  const f=fixture();
  for(const key of families){
    const evidence=f.source(key);
    assert.equal(evidence.loaded,true,key+" uses verified retained input when unspecified");
    assert.notEqual(evidence.status,"missing",key);
  }
  for(const key of ["sapr","vir","nextAppointments","menu","sor","mediaAsrTech"])
    assert.ok(f.calls.includes(key),"automatic fallback retained for "+key);
  assert.equal(JSON.stringify(f.model),f.before);
});

test("explicit snapshot matches omitted snapshot identity, date and import provenance",()=>{
  const f=fixture();
  for(const key of families){
    const automatic=f.source(key),explicit=f.evaluate(key,selected[key]);
    assert.equal(explicit.status,automatic.status,key+" status");
    assert.equal(explicit.loaded,automatic.loaded,key+" load authority");
    assert.equal(explicit.periodEnd,automatic.periodEnd,key+" source period");
    assert.equal(explicit.importTimestamp,automatic.importTimestamp,key+" import lineage");
    assert.equal(explicit.reportPeriodVerified,automatic.reportPeriodVerified,key+" coverage verification");
  }
  assert.equal(selected.sapr.store.totalGross,0,"trusted zero remains zero, not missing");
  assert.equal(JSON.stringify(f.model),f.before,"manual RO decisions are read only");
});

test("selected stale Open RO and SAPR do not inherit another current source",()=>{
  const f=fixture();
  const historicalOpenRo={reportDate:"2026-10-20",importedAt:"2026-10-30T12:00:00.000Z"};
  const historicalSapr={...interval,periodEnd:"2026-10-20",
    importedAt:"2026-10-30T12:00:00.000Z"};
  for(const [key,item] of [["openRo",historicalOpenRo],["sapr",historicalSapr]]){
    assert.equal(f.source(key).status,"current",key+" automatic current fixture");
    const evidence=f.evaluate(key,item);
    assert.equal(evidence.status,"stale",key+" explicit period stays stale");
    assert.equal(evidence.importTimestamp,item.importedAt,key+" retains selected import");
    assert.equal(evidence.periodEnd,key==="sapr"?"2026-10-20":"2026-10-20");
  }
});

test("missing selection preserves intentionally cleared manager owner on the RO",()=>{
  const f=fixture(),before=f.model.state.records[0];
  for(const key of families)f.evaluate(key,null);
  assert.equal(before.management.ownerAssignmentSource,"manager-cleared");
  assert.equal(before.management.notes,"Retained local manager decision");
  assert.equal(JSON.stringify(f.model),f.before,"source confidence never writes or hydrates the manager record");
});

test("full production application still parses after source authority correction",()=>{
  new vm.Script(app);
  assert.match(source,/Object\.prototype\.hasOwnProperty\.call\(options, "item"\)/);
});
