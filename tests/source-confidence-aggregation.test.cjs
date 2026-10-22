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
