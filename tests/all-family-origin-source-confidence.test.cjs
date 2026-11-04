"use strict";
// Actual shared sourceFreshness() selector, synthetic cross-dealership metadata.
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const freshness=require("../assets/freshness.js");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf("  function sourceFreshness(");
const end=app.indexOf("  function metricDependencyEvidence(",start);
assert.ok(start>=0&&end>start,"shared production source confidence adapter exists");
const selected=app.slice(start,end);
const dodge={name:"Synthetic Exampletown",code:"09001",brand:"Dodge"};
const bmw={...dodge,brand:"BMW"};
const today="2026-10-30";
const base={
  importedAt:"2026-10-30T08:00:00.000Z",reportDate:today,date:today,
  period:"2026-10",periodStart:"2026-10-01",periodEnd:"2026-10-29",
  scopeVerified:true,scopeStart:"2026-10-01",scopeEnd:"2026-10-29",
  reportObservationVerified:true,reportObservationDate:"2026-10-29",
  observationTimestamp:"2026-10-29T17:30:00.000Z",
  sourceModifiedAt:"2026-10-29T17:30:00.000Z",
  releaseWeek:"2026-10-26",generatedAt:"2026-10-29T17:30:00.000Z",
  rows:0
};
function runtime(settings=dodge){
  const model={settings:{store:settings},
    state:{source:base},operationalMetrics:{csi:{imports:[base]}},
    appointments:{days:{[today]:base}},recovery:{supervisorWorkbook:base}};
  const ctx=vm.createContext({
    freshness,model,Date,Intl,
    sourceExpectation:()=>"recommended",
    businessTimeZone:()=>"America/Los_Angeles",
    localDateKey:value=>value instanceof Date?value.toISOString().slice(0,10):today,
    currentSaprSnapshot:()=>base,latestOperationalSnapshot:()=>base,
    latestVirObservation:()=>base,
    verifiedVirSourceObservationDate:item=>freshness.validDateKey(item?.reportDate)?item.reportDate:"",
    validCoverageDate:value=>freshness.validDateKey(value)?value:"",
    csiReportedPeriod:(scopeStart,scopeEnd,observed)=>({
      periodStart:scopeStart||observed||"",periodEnd:scopeEnd||observed||"",
      verified:Boolean(scopeEnd||observed)
    }),
    verifiedMenuTrendReleases:()=>new Set(["2026-10-26"]),
    lastDayOfMonth:freshness.lastDayOfMonth
  });
  vm.runInContext(selected+"\nthis.check=sourceFreshness;",ctx);
  return(item,family)=>ctx.check(family,{item,today});
}
test("each of the fourteen source selectors fails closed on a conflicting reported dealership after restart",()=>{
  const select=runtime();
  const families=Object.keys(freshness.SOURCE_DEFINITIONS);
  assert.equal(families.length,14);
  for(const family of families){
    const marked={...base,sourceReportedStore:{...bmw}};
    const original=JSON.stringify(marked),persisted=JSON.parse(original);
    const invalid=select(persisted,family);
    assert.equal(invalid.sourceStoreConfidence,"store-conflict",family);
    assert.equal(invalid.status,"invalid",family+" must not present a foreign source as current");
    assert.equal(invalid.safeForPurpose,false,family);
    assert.equal(invalid.reportPeriodVerified,false,family);
    assert.equal(freshness.evaluateMetric([invalid]).verified,false,family);
    assert.equal(JSON.stringify(marked),original,family+" observation is read-only");
  }
});
test("complete source markers can establish an exact local match while partial markers remain unverified",()=>{
  const select=runtime();
  for(const family of Object.keys(freshness.SOURCE_DEFINITIONS)){
    const matched=select({...base,sourceReportedStore:{...dodge}},family);
    assert.equal(matched.sourceStoreConfidence,"verified-source-store",family);
    const partial=select({...base,sourceReportedStore:{code:dodge.code}},family);
    assert.equal(partial.sourceStoreConfidence,"configured-destination-only",family);
    const legacy=select({...base},family);
    assert.equal(Object.hasOwn(legacy,"sourceStoreConfidence"),false,
      family+" old sources do not acquire fabricated marker evidence");
  }
});
test("verified source alias is constrained to current brand, family and full reported identity",()=>{
  const vendor={name:"Synthetic Vendor Alias",code:"V-09001",brand:"Dodge"};
  const alias={storeIdentityVerified:true,family:"mediaAsr",
    sourceStore:{...vendor},configuredStore:{...dodge}};
  const report={...base,sourceReportedStore:vendor,sourceStoreAlias:alias};
  assert.equal(runtime(dodge)(report,"mediaAsr").sourceStoreConfidence,"verified-source-store");
  assert.equal(runtime(bmw)(report,"mediaAsr").sourceStoreConfidence,"store-conflict");
  assert.equal(runtime(dodge)(report,"efficiency").sourceStoreConfidence,"store-conflict");
  assert.equal(runtime(dodge)({...report,sourceStoreAlias:{...alias,storeIdentityVerified:false}},"mediaAsr").sourceStoreConfidence,"store-conflict");
});
