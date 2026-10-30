"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");

// The runner is forced to UTC so the fixture reliably differs from the
// configured store timezone. The application still uses synthetic data only.
process.env.TZ="UTC";
require("../assets/freshness.js");
globalThis.__moondogSettingsModel={settings:{
  store:{timeZone:"America/Los_Angeles"},
  future:{managerSchedule:{days:[2,3,4,5,6]}}
}};
const engine=require("../assets/daily-engine.js");

function completedEvent(at){
  return {at,details:{taskId:"coaching:synthetic:tires",taskType:"coaching",
    action:"completed",actual:80,rank:6,fingerprint:"old-report"}};
}
const changedTask={id:"coaching:synthetic:tires",type:"coaching",advisor:"synthetic",
  key:"tires",actual:80,rank:6,fingerprint:"new-report"};

test("coaching follow-up cooldown uses configured business timezone, not UTC host date",()=>{
  const event=completedEvent("2026-10-26T01:00:00.000Z"); // Sun Oct 25, 18:00 PDT
  assert.equal(engine.eligible(changedTask,[event],Date.parse("2026-10-29T18:59:00.000Z")),false,
    "three configured workdays end at noon in the store timezone, not before it");
  assert.equal(engine.eligible(changedTask,[event],Date.parse("2026-10-29T19:00:00.000Z")),true,
    "new evidence can resurface at business-zone noon after the three-workday cooldown");
});

test("coaching follow-up resolves business-zone noon correctly across daylight-saving transition",()=>{
  const event=completedEvent("2026-10-30T23:00:00.000Z"); // Fri Oct 30, 16:00 PDT
  assert.equal(engine.eligible(changedTask,[event],Date.parse("2026-11-05T19:59:00.000Z")),false,
    "cooldown remains active through 11:59 PST after the daylight-saving change");
  assert.equal(engine.eligible(changedTask,[event],Date.parse("2026-11-05T20:00:00.000Z")),true,
    "cooldown expires at noon PST after the daylight-saving change");
});
