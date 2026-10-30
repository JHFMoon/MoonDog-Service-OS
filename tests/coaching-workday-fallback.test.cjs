"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

// Execute the real shipped Daily Engine, not a reimplementation of its calendar.
const freshnessSource=fs.readFileSync(path.join(__dirname,"..","assets","freshness.js"),"utf8");
const source=fs.readFileSync(path.join(__dirname,"..","assets","daily-engine.js"),"utf8");
function engineWithDays(days) {
  const context=vm.createContext({
    Date, Intl,
    __moondogSettingsModel:{settings:{future:{managerSchedule:{days}}}}
  });
  // The production engine uses the canonical freshness calendar for business-zone
  // workday arithmetic. Keep this harness aligned with that shipped dependency.
  vm.runInContext(freshnessSource,context);
  vm.runInContext(source,context);
  return context.MoonDogDailyEngine;
}
const item={
  id:"coaching:101:cpElr", type:"coaching", key:"cpElr",
  rank:6, actual:196, fingerprint:"verified-new-report"
};
function priorReview(action="completed",at=new Date(2026,9,8,13).toISOString()){
  return {
    at,
    details:{
      taskId:item.id, action, actual:197, fingerprint:"older-report"
    }
  };
}
const localTime=day=>new Date(day+"T15:00:00").getTime();

test("a saved calendar containing only invalid weekdays falls back instead of hanging coaching",()=>{
  const engine=engineWithDays([-1,7,99,NaN,"2",null]);
  const events=[priorReview()];
  assert.equal(engine.eligible(item,events,localTime("2026-10-12")),false,
    "Monday is not the third default working day after Thursday");
  assert.equal(engine.eligible(item,events,localTime("2026-10-13")),true,
    "Tuesday is the third default working day after Thursday");
});

test("valid configured weekdays remain authoritative when mixed with corrupt entries",()=>{
  const engine=engineWithDays([2,-1,8,"5"]);
  const events=[priorReview()];
  assert.equal(engine.eligible(item,events,localTime("2026-10-26")),false,
    "only real configured Tuesday counts toward three working days");
  assert.equal(engine.eligible(item,events,localTime("2026-10-27")),true);
});

test("non-array legacy calendars and not-an-issue seven-day waits remain safe",()=>{
  const events=[priorReview("not-an-issue")];
  for(const days of [null,"Tuesday",{},[]]){
    const engine=engineWithDays(days);
    assert.equal(engine.eligible(item,events,localTime("2026-10-16")),false);
    assert.equal(engine.eligible(item,events,localTime("2026-10-17")),true);
  }
});

test("valid schedules and urgent material deterioration retain existing behavior",()=>{
  const engine=engineWithDays([2,3,4,5,6]);
  const events=[priorReview()];
  assert.equal(engine.eligible(item,events,localTime("2026-10-12")),false);
  assert.equal(engine.eligible(item,events,localTime("2026-10-13")),true);
  assert.equal(engine.eligible({...item,actual:188},events,localTime("2026-10-09")),true);
});

test("configured Monday-Friday workdays control actual coaching due dates",()=>{
  const engine=engineWithDays([1,2,3,4,5]);
  const lastCompleted=new Date(2026,9,7,13).toISOString(); // Wednesday
  const events=[priorReview("completed",lastCompleted)];
  assert.equal(engine.eligible(item,events,localTime("2026-10-10")),false,
    "Saturday is not a manager workday and cannot be the third day");
  assert.equal(engine.eligible(item,events,localTime("2026-10-12")),true,
    "Monday is the third scheduled day after Wednesday");
});
