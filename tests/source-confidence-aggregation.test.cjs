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
