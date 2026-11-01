"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const F=require("../assets/freshness.js");

const today="2026-10-07";

test("missing, stale, and unsupported sources remain unverified metric dependencies",()=>{
  const cases=[
    ["missing",F.evaluateSource({key:"sapr",exists:false,today})],
    ["stale",F.evaluateSource({key:"sapr",exists:true,today,periodStart:"2026-10-01",periodEnd:"2026-10-05"})],
    ["unsupported",F.evaluateSource({key:"sapr",exists:true,today,invalid:"Unsupported report format"})]
  ];
  for(const [label,evidence] of cases){
    assert.equal(evidence.status,label==="unsupported"?"invalid":label,label);
    assert.equal(evidence.safeForCurrent,false,label+" evidence cannot be used as current");
    assert.equal(evidence.safeForPurpose,false,label+" evidence cannot verify its purpose");
    const metric=F.evaluateMetric([evidence]);
    assert.equal(metric.verified,false,label+" dependency must block metric verification");
    assert.equal(metric.status,evidence.status,label+" confidence status must be preserved");
    assert.deepEqual(metric.blocking,[evidence],label+" dependency must remain visible as a blocker");
  }
});

test("a valid current source remains usable as a positive control",()=>{
  const evidence=F.evaluateSource({key:"sapr",exists:true,today,periodStart:"2026-10-01",periodEnd:"2026-10-06"});
  const metric=F.evaluateMetric([evidence]);
  assert.equal(evidence.status,"current");
  assert.equal(metric.verified,true);
  assert.deepEqual(metric.blocking,[]);
});

test("combined metrics retain every missing and stale dependency in input order",()=>{
  const stale=F.evaluateSource({key:"sapr",exists:true,today,periodEnd:"2026-10-05"});
  const missing=F.evaluateSource({key:"csi",exists:false,today});
  const metric=F.evaluateMetric([stale,missing]);
  assert.equal(metric.verified,false);
  assert.equal(metric.status,"stale");
  assert.deepEqual(metric.blocking,[stale,missing]);
  assert.deepEqual(metric.dependencies,[stale,missing]);
});


test("every catalogued source preserves missing and unsupported confidence as a metric blocker",()=>{
  const keys=Object.keys(F.SOURCE_DEFINITIONS);
  assert.equal(keys.length,14,"the confidence matrix must cover every catalogued source family");
  for(const key of keys){
    for(const [label,input] of [
      ["missing",{exists:false}],
      ["unsupported",{exists:true,invalid:"Unsupported synthetic report format"}]
    ]){
      const evidence=F.evaluateSource({key,today,...input});
      const expectedStatus=label==="missing"?"missing":"invalid";
      assert.equal(evidence.status,expectedStatus, key+" "+label+" state");
      assert.equal(evidence.safeForCurrent,false,key+" "+label+" cannot be current");
      assert.equal(evidence.safeForPurpose,false,key+" "+label+" cannot verify its purpose");
      const metric=F.evaluateMetric([evidence]);
      assert.equal(metric.verified,false,key+" "+label+" must block metric verification");
      assert.equal(metric.status,expectedStatus,key+" confidence state must be visible");
      assert.strictEqual(metric.blocking[0],evidence,key+" original evidence remains in the blocker list");
      assert.strictEqual(metric.dependencies[0],evidence,key+" original evidence remains a dependency");
    }
  }
});

test("every time-cadenced source rejects an old period as stale evidence",()=>{
  const staleByCadence={
    "same-business-day":{sourceDate:"2026-10-06"},
    "same-business-day-period":{periodStart:"2026-10-06",periodEnd:"2026-10-06"},
    "prior-operating-day":{periodStart:"2026-10-01",periodEnd:"2026-10-05"},
    "cumulative-observation":{sourceDate:"2026-10-03",observationVerified:true},
    "weekly-monday":{releaseWeek:"2026-09-28"},
    "state-current":{stale:true}
  };
  for(const [key,definition] of Object.entries(F.SOURCE_DEFINITIONS)){
    const staleInput=staleByCadence[definition.cadence];
    if(!staleInput)continue; // Period-bound reference feeds have no daily currentness rule.
    const evidence=F.evaluateSource({key,exists:true,today,...staleInput});
    assert.equal(evidence.status,"stale",key+" old source must be labeled stale");
    assert.equal(evidence.safeForCurrent,false,key+" stale source cannot be used as current");
    assert.equal(evidence.safeForPurpose,false,key+" stale source cannot verify its purpose");
    const metric=F.evaluateMetric([evidence]);
    assert.equal(metric.verified,false,key+" stale source must block metric verification");
    assert.equal(metric.status,"stale",key+" stale confidence must remain visible");
  }
});

test("invalid duplicate period evidence blocks an otherwise current metric without hiding either dependency",()=>{
  const current=F.evaluateSource({key:"menu",exists:true,today,releaseWeek:"2026-10-05"});
  const duplicate=F.evaluateSource({
    key:"menu",exists:true,today,releaseWeek:"2026-10-05",
    invalid:"Conflicting duplicate synthetic Menu Sales report for the same release week."
  });
  const metric=F.evaluateMetric([current,duplicate]);

  assert.equal(current.status,"current","the accepted report remains an independently valid source");
  assert.equal(duplicate.status,"invalid","duplicate conflict stays explicitly classified");
  assert.equal(metric.verified,false,"a valid report cannot mask a conflicting duplicate");
  assert.equal(metric.status,"invalid","the invalid confidence is surfaced by the aggregate");
  assert.deepEqual(metric.blocking,[duplicate],"the rejected duplicate remains the blocking evidence");
  assert.deepEqual(metric.dependencies,[current,duplicate],"both source records remain auditable dependencies");
});

test("conflicting source evidence blocks an otherwise current metric for every catalogued family",()=>{
  const validInputFor=key=>{
    const cadence=F.SOURCE_DEFINITIONS[key].cadence;
    const base={key,exists:true,today};
    if(cadence==="same-business-day")return {...base,sourceDate:today};
    if(cadence==="same-business-day-period")return {...base,periodStart:today,periodEnd:today};
    if(cadence==="prior-operating-day")return {...base,periodStart:"2026-10-01",periodEnd:"2026-10-06"};
    if(cadence==="cumulative-observation")return {...base,observationVerified:true,sourceDate:"2026-10-06"};
    if(cadence==="weekly-monday")return {...base,releaseWeek:"2026-10-05"};
    if(cadence==="state-current")return {...base,stale:false};
    return {...base,periodStart:"2026-10-01",periodEnd:"2026-10-06"};
  };
  const keys=Object.keys(F.SOURCE_DEFINITIONS);
  for(const key of keys){
    const valid=F.evaluateSource(validInputFor(key));
    const conflicting=F.evaluateSource({...validInputFor(key),
      invalid:"Conflicting duplicate synthetic source for the same reporting period."});
    const metric=F.evaluateMetric([valid,conflicting]);
    assert.ok(["current","historical-valid"].includes(valid.status),key+" positive control must be valid");
    assert.equal(conflicting.status,"invalid",key+" conflicting source must remain explicitly invalid");
    assert.equal(metric.verified,false,key+" conflict cannot produce a verified metric");
    assert.equal(metric.status,"invalid",key+" aggregate must expose the conflict");
    assert.deepEqual(metric.blocking,[conflicting],key+" conflicting evidence remains the blocker");
    assert.deepEqual(metric.dependencies,[valid,conflicting],key+" retains both source dependencies");
  }
});

const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function productionLineageLabels(){
  const start=app.indexOf("  function sourceStatusLabel(");
  const end=app.indexOf("  function advisorNextWin(",start);
  assert.ok(start>=0&&end>start,"production source confidence and lineage labels exist");
  const context=vm.createContext({});
  vm.runInContext(app.slice(start,end)+
    ";this.sourceStatusLabel=sourceStatusLabel;this.sourceLineageLabel=sourceLineageLabel;",context);
  return context;
}

test("production freshness states render truthful source confidence labels across every catalogued family",()=>{
  const labels=productionLineageLabels();
  const keys=Object.keys(F.SOURCE_DEFINITIONS);
  const importedAt="2026-10-07T15:00:00.000Z";

  for(const key of keys){
    const missing=F.evaluateSource({key,today,exists:false});
    assert.equal(labels.sourceLineageLabel(missing),
      "Missing · Report period: Not verified · Last imported: Not verified",key+" missing");

    const stale=F.evaluateSource({key,today,exists:true,purpose:"historical",
      targetStart:"2026-10-01",targetEnd:"2026-10-06",
      periodStart:"2026-09-01",periodEnd:"2026-09-30"});
    assert.equal(stale.status,"stale",key+" historical coverage gap");
    const staleLabel=labels.sourceLineageLabel({...stale,reportPeriodVerified:true,importTimestamp:importedAt});
    assert.match(staleLabel,/^Loaded but stale · Needs updating/,key+" stale presentation");
    assert.match(staleLabel,/Report period: 2026-09-01 through 2026-09-30/,key+" source coverage");
    assert.match(staleLabel,/Last imported: 2026-10-07 15:00 UTC/,key+" independent import timestamp");

    const unsupported=F.evaluateSource({key,today,exists:true,
      invalid:"Unsupported synthetic report layout"});
    assert.equal(unsupported.status,"invalid",key+" unsupported layout status");
    assert.equal(labels.sourceLineageLabel(unsupported),
      "Unsupported format · Review required · Report period: Not verified · Last imported: Not verified",
      key+" unsupported layout presentation");

    const conflict=F.evaluateSource({key,today,exists:true,
      invalid:"Conflicting duplicate synthetic report for the same period."});
    assert.equal(conflict.status,"invalid",key+" duplicate conflict status");
    assert.equal(labels.sourceLineageLabel(conflict),
      "Conflict · Review required · Report period: Not verified · Last imported: Not verified",
      key+" duplicate conflict presentation");
  }
});


test("a current Open RO workload snapshot never conceals invalid source evidence in report readiness",()=>{
  const invalidReasons=[
    "Conflicting duplicate Open RO report for this operating date.",
    "Unsupported Open RO source layout.",
    "The saved Open RO source period is invalid."
  ];
  for(const reason of invalidReasons){
    const invalid=F.evaluateSource({key:"openRo",exists:true,today,sourceDate:today,invalid:reason});
    assert.equal(invalid.status,"invalid");
    const need=F.evaluateReportNeed({key:"openRo",today,evidence:invalid,currentSnapshot:true});
    assert.equal(need.state,"NEED NOW","an independent current workload cannot erase "+reason);
    assert.equal(need.actionable,true);
    assert.match(need.reason,/missing, invalid or stale/);
    assert.equal(F.evaluateMetric([invalid]).verified,false);
  }
  // Keep the existing, separately validated workload fallback for a missing
  // source snapshot. Only an explicit invalid/contradictory source is a blocker.
  const missing=F.evaluateSource({key:"openRo",exists:false,today});
  assert.equal(F.evaluateReportNeed({key:"openRo",today,evidence:missing,currentSnapshot:true}).state,"CURRENT");
  assert.equal(F.evaluateReportNeed({key:"openRo",today,evidence:missing,currentSnapshot:false}).state,"NEED NOW");
  const valid=F.evaluateSource({key:"openRo",exists:true,today,sourceDate:today});
  assert.equal(valid.status,"current");
  assert.equal(F.evaluateReportNeed({key:"openRo",today,evidence:valid,currentSnapshot:true}).state,"CURRENT");
  assert.equal(F.evaluateReportNeed({key:"openRo",today,evidence:valid}).state,"CURRENT");
});


test("disabled or temporarily unavailable sources alone never verify a metric",()=>{
  const cases=[
    F.evaluateSource({key:"sapr",exists:false,today,expectation:"not-used"}),
    F.evaluateSource({key:"csi",exists:false,today,expectation:"temporarily-unavailable"})
  ];
  assert.deepEqual(cases.map(item=>item.status),["not-used","temporarily-unavailable"]);
  for(const item of cases){
    assert.equal(item.safeForPurpose,false);
    const metric=F.evaluateMetric([item]);
    assert.equal(metric.verified,false,item.status+" must not mean metric verified");
    assert.equal(metric.status,item.status);
    assert.deepEqual(metric.blocking,[item]);
    assert.deepEqual(metric.dependencies,[item]);
  }
  const combined=F.evaluateMetric(cases);
  assert.equal(combined.verified,false,"two unavailable inputs must not become verified");
  assert.deepEqual(combined.blocking,cases);
});

test("optional exclusions remain allowed when another source actually verifies the calculation",()=>{
  const current=F.evaluateSource({key:"sapr",exists:true,today,periodStart:"2026-10-01",periodEnd:"2026-10-06"});
  const notUsed=F.evaluateSource({key:"vir",exists:false,today,expectation:"not-used"});
  const unavailable=F.evaluateSource({key:"csi",exists:false,today,expectation:"temporarily-unavailable"});
  const metric=F.evaluateMetric([current,notUsed,unavailable]);
  assert.equal(current.safeForPurpose,true);
  assert.equal(metric.verified,true,"configured exclusions must not invalidate verified SAPR-only evidence");
  assert.deepEqual(metric.blocking,[]);
  const missing=F.evaluateSource({key:"menu",exists:false,today});
  const blocked=F.evaluateMetric([current,notUsed,missing]);
  assert.equal(blocked.verified,false);
  assert.deepEqual(blocked.blocking,[missing],"a real missing dependency must still block");
  assert.equal(F.evaluateMetric([]).verified,true,"empty dependency behavior is unchanged");
});


test("production metric evidence suppresses zero when only temporarily unavailable source exists",()=>{
  const metricStart=app.indexOf("  function metricEvidence({");
  const metricEnd=app.indexOf("  function metricEvidenceText(",metricStart);
  const dependencyStart=app.indexOf("  function metricDependencyEvidence(");
  const dependencyEnd=app.indexOf("  function sourceStatusLabel(",dependencyStart);
  assert.ok(metricStart>=0&&metricEnd>metricStart&&dependencyStart>=0&&dependencyEnd>dependencyStart);
  const context=vm.createContext({freshness:F});
  vm.runInContext(app.slice(metricStart,metricEnd)+"\n"+app.slice(dependencyStart,dependencyEnd)+
    ";this.metricEvidence=metricEvidence;this.metricDependencyEvidence=metricDependencyEvidence;",context);
  const input=F.evaluateSource({key:"csi",exists:false,today,expectation:"temporarily-unavailable"});
  const candidate=context.metricEvidence({value:0,source:"Synthetic CSI",period:today});
  assert.equal(candidate.verified,true,"positive control represents an otherwise verified zero");
  const blocked=context.metricDependencyEvidence([input],candidate);
  assert.equal(blocked.verified,false,"unavailable-only evidence cannot verify the zero");
  assert.equal(blocked.value,null,"unknown is never displayed as a verified zero");
  assert.equal(blocked.lastVerifiedValue,0,"last verified source value remains distinguishable");
  assert.equal(blocked.status,"temporarily-unavailable");
  assert.equal(blocked.source,"CSI");
});
