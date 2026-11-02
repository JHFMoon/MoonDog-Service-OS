"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const begin=app.indexOf("  function performancePlan(");
const end=app.indexOf("  function currentCsiSurveys(",begin);
assert.ok(begin>=0&&end>begin,"production Performance plan selector exists");
const production=app.slice(begin,end);
const freshness=fs.readFileSync(path.join(__dirname,"..","assets","freshness.js"),"utf8");
const entity={totalGross:2400,cpGross:1600,totalRevenue:9000};

function plan(snapshot,{helper=true}={}){
  const context=vm.createContext({
    Date,Intl,
    localDateKey:()=>"2026-10-06",
    businessTimeZone:()=>"UTC",
    freshness:{timeParts:()=>({hour:19})},
    lastDayOfMonth:month=>month+"-31",
    configuredNumber:target=>Number.isFinite(target)?target:null
  });
  if(helper)vm.runInContext(freshness,context);
  vm.runInContext(production+"\nthis.makePlan=performancePlan;",context);
  return context.makePlan(snapshot,entity,10000);
}
const sample=(days,end="2026-10-06")=>({
  periodEnd:end,saprDaysCompleted:days,saprTotalDays:22,
  validation:{saprDaysVerified:true,finalTotalsVerified:true}
});

test("Performance/Meeting SAPR projection remains unknown for impossible reported working days",()=>{
  for(const days of [-2,-0.5,23]){
    const result=plan(sample(days));
    assert.equal(result.completed,null,"invalid days cannot be a denominator: "+days);
    assert.equal(result.totalDays,null);
    assert.equal(result.pace,null);
    assert.equal(result.cpPace,null);
    assert.equal(result.grossPerDay,null);
  }
  const missing=plan(sample(null));
  assert.equal(missing.completed,null);
  const invalidDate=plan(sample(8,"2026-02-30"));
  assert.equal(invalidDate.completed,null,
    "a rejected report date must not silently restore raw source counts");
  assert.equal(invalidDate.pace,null);
});

test("verified zero SAPR days stay valid but cannot be used as a divisor",()=>{
  const result=plan(sample(0));
  assert.equal(result.completed,0);
  assert.equal(result.totalDays,22);
  assert.equal(result.pace,null);
  assert.equal(result.cpPace,null);
  assert.equal(result.remainingDays,22);
  assert.ok(Number.isFinite(result.grossPerDay));
});

test("verified current SAPR days calculate the same gross pacing across views",()=>{
  const result=plan(sample(8));
  assert.equal(result.completed,8);
  assert.equal(result.totalDays,22);
  assert.equal(result.pace,6600);
  assert.equal(result.cpPace,4400);
});

test("legacy no-helper fallback rejects impossible day counts while preserving verified ones",()=>{
  assert.equal(plan(sample(-1),{helper:false}).completed,null);
  const healthy=plan(sample(8),{helper:false});
  assert.equal(healthy.completed,8);
  assert.equal(healthy.totalDays,22);
  assert.equal(healthy.pace,6600);
});
