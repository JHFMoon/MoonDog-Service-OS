"use strict";

// #59-01 — actual Performance trend/source selection, synthetic data only.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const freshness=require("../assets/freshness.js");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function src(a,b){
  const x=app.indexOf(a),y=app.indexOf(b,x+a.length);
  assert.ok(x>=0&&y>x,"Required production function "+a);
  return app.slice(x,y);
}
const dateValidator=src("  function validCoverageDate(","  function coverageTimestamp(");
const virValidator=src("  function verifiedVirSourceObservationDate(","  function sourceFreshness(");
const sourceSelector=src("  function sourceFreshness(","  function metricDependencyEvidence(");
const sourceTrends=src("  const TREND_SOURCES=","  function trendMeasures(");
const trendPoints=src("  function trendPoints(","  function availableTrendMeasures(");
const today="2026-10-30";

function exercise(family,snapshot) {
  const model={
    performance:{snapshots:{}},
    operationalMetrics:{
      vir:{snapshots: family==="vir"?{"synthetic":snapshot}:{}},
      nextAppointments:{snapshots:family==="nextAppointments"?{"synthetic":snapshot}:{}}
    },
    settings:{advisors:{}}
  };
  const ctx=vm.createContext({
    freshness,model,Date,Intl,
    sourceExpectation:()=> "recommended",
    businessTimeZone:()=> "America/Los_Angeles",
    localDateKey:()=>today,
    allVirObservations:()=>Object.values(model.operationalMetrics.vir.snapshots),
    dailyEvidenceDate:(key,item)=>{
      if(key!=="vir")return "";
      if(freshness.validDateKey(item.reportDate))return item.reportDate;
      return typeof item.observationTimestamp==="string"?
        item.observationTimestamp.slice(0,10):"";
    },
    advisorDisplayName:()=> "Synthetic Advisor",
    standard:()=>null
  });
  vm.runInContext(dateValidator+"\n"+virValidator+"\n"+sourceSelector+"\n"+
    sourceTrends+"\n"+trendPoints+
    "\nthis.plot=trendPoints;this.evidence=sourceFreshness;",ctx);
  const measure=family==="vir"?
    {family,key:"utilization",unit:"percent",roles:["store"]}:
    {family,key:"scheduled",unit:"count",roles:["store"]};
  return {
    model,
    points:()=>JSON.parse(JSON.stringify(ctx.plot(measure,"store","",today))),
    evidence:()=>ctx.evidence(family,{item:snapshot,today,
      purpose:"historical",targetStart:"2026-10-29",targetEnd:"2026-10-29"})
  };
}

test("verified Next Appointments source period supplies one dated Performance value",()=>{
  const f=exercise("nextAppointments",{
    periodStart:"2026-10-01",periodEnd:"2026-10-29",
    importedAt:"2026-10-30T08:00:00Z",summary:{scheduled:12}
  });
  assert.equal(f.evidence().safeForPurpose,true);
  const points=f.points();
  assert.equal(points.length,1);
  assert.equal(points[0].value,12);
  assert.equal(points[0].date,"2026-10-29");
  assert.equal(points[0].periodVerified,true);
});

test("Next Appointments cannot project a count from an invalid or unverified source period",()=>{
  for(const change of [
    {periodStart:"2026-02-30",periodEnd:"2026-10-29"},
    {periodStart:"2026-10-30",periodEnd:"2026-10-29"},
    {periodEnd:"2026-10-29"},
    {periodStart:"2026-10-01",periodEnd:"2026-10-29",
      validation:{parser:"appointments-created-summary-v1",periodVerified:false}}
  ]){
    const data={importedAt:"2026-10-30T08:00:00Z",summary:{scheduled:0},...change};
    const f=exercise("nextAppointments",data);
    const before=JSON.stringify(f.model);
    assert.equal(f.evidence().reportPeriodVerified,false,
      "invalid or one-day-only report cannot verify a declared interval: "+JSON.stringify(change));
    assert.deepEqual(f.points(),[],
      "Performance must not show zero as verified from missing/invalid interval");
    assert.equal(JSON.stringify(f.model),before,"source selection is read-only");
  }
});

test("VIR source-supplied report observation remains usable as a point-in-time Performance value",()=>{
  const f=exercise("vir",{
    reportDate:"2026-10-29",importedAt:"2026-10-30T08:00:00Z",
    store:{utilization:83}
  });
  assert.equal(f.evidence().safeForPurpose,true);
  assert.equal(f.points().length,1);
  assert.equal(f.points()[0].value,83);
  assert.equal(f.points()[0].date,"2026-10-29");
});

test("an invalid declared VIR date cannot borrow a separately valid file observation to plot a verified metric",()=>{
  const f=exercise("vir",{
    reportDate:"2026-02-30",
    observationTimestamp:"2026-10-29T14:15:00Z",
    importedAt:"2026-10-30T08:00:00Z",
    store:{utilization:0}
  });
  assert.equal(f.evidence().status,"invalid");
  assert.deepEqual(f.points(),[],
    "invalid explicit report-date claim must veto a file-timestamp fallback or a false verified zero");
});
