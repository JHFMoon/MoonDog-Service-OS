"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

// Execute the real shipped Daily Engine, not a reimplementation of its calendar.
const source=fs.readFileSync(path.join(__dirname,"..","assets","daily-engine.js"),"utf8");
function engineWithDays(days) {
  const context=vm.createContext({
    Date, Intl,
    __moondogSettingsModel:{settings:{future:{managementSchedule:{days}}}}
  });
  vm.runInContext(source,context);
  return context.MoonDogDailyEngine;
}
const item={
  id:"coaching:101:cpElr", type:"coaching", key:"cpElr",
  rank:6, actual:196, fingerprint:"verified-new-report"
};
function priorReview(action="completed"){
  return {
    at:"2026-10-08T18:00:00Z",
    details:{
      taskId:item.id, action, actual:197, fingerprint:"older-report"
    }
  };
}
const time=iso=>Date.parse(iso);

test("a saved calendar containing only invalid weekdays falls back instead of hanging coaching",()=>{
  const engine=engineWithDays([-1,7,99,NaN,"2",null]);
  const events=[priorReview()];
  assert.equal(engine.eligible(item,events,time("2026-10-12T18:00:00Z")),false,
    "Monday is not the third default working day after Thursday");
  assert.equal(engine.eligible(item,events,time("2026-10-13T18:00:00Z")),true,
    "Tuesday is the third default working day after Thursday");
});

test("valid configured weekdays remain authoritative when mixed with corrupt entries",()=>{
  const engine=engineWithDays([2,-1,8,"5"]);
  const events=[priorReview()];
  assert.equal(engine.eligible(item,events,time("2026-10-26T18:00:00Z")),false,
    "only real configured Tuesday counts toward three working days");
  assert.equal(engine.eligible(item,events,time("2026-10-27T18:00:00Z")),true);
});

test("non-array legacy calendars and not-an-issue seven-day waits remain safe",()=>{
  const events=[priorReview("not-an-issue")];
  for(const days of [null,"Tuesday",{},[]]){
    const engine=engineWithDays(days);
    assert.equal(engine.eligible(item,events,time("2026-10-16T18:00:00Z")),false);
    assert.equal(engine.eligible(item,events,time("2026-10-17T18:00:00Z")),true);
  }
});

test("valid schedules and urgent material deterioration retain existing behavior",()=>{
  const engine=engineWithDays([2,3,4,5,6]);
  const events=[priorReview()];
  assert.equal(engine.eligible(item,events,time("2026-10-12T18:00:00Z")),false);
  assert.equal(engine.eligible(item,events,time("2026-10-13T18:00:00Z")),true);
  assert.equal(engine.eligible({...item,actual:188},events,time("2026-10-09T18:00:00Z")),true);
});
