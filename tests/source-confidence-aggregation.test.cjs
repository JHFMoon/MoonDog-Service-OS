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
    "cumulative-observation":{sourceDate:"2026-10-03"},
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
