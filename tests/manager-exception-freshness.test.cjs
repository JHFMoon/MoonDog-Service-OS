"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const read=file=>fs.readFileSync(path.join(__dirname,"..","assets",file),"utf8");
const app=read("app.js");
const priorityStart=app.indexOf("  function dailyFocusPriority(record");
const priorityEnd=app.indexOf("\n  const MANAGER_WORK_DAYS",priorityStart);
assert.ok(priorityStart>=0&&priorityEnd>priorityStart,"production manager priority function exists");
const dailyPriority=app.slice(priorityStart,priorityEnd);

function buildEngine(){
  const context=vm.createContext({Date,Intl,console,__moondogSettingsModel:{
    settings:{store:{timeZone:"UTC"},future:{managerSchedule:{days:[1,2,3,4,5]}}}
  }});
  vm.runInContext(read("freshness.js"),context);
  vm.runInContext(read("daily-engine.js"),context);
  context.freshness=context.MoonDogFreshness;
  context.clarificationFor=()=>false;
  vm.runInContext(dailyPriority+"\\nthis.dailyPriority=dailyFocusPriority;",context);
  return {engine:context.MoonDogDailyEngine,ranking:context.ServiceRefreshIntelligence,dailyPriority:context.dailyPriority};
}

test("unchanged exception evidence remains deduplicated across source reimport and only new evidence resurfaces",()=>{
  const {engine,ranking}=buildEngine();
  const task={id:"coaching:synthetic-advisor:tires",type:"coaching",advisor:"synthetic-advisor",
    key:"tires",actual:80,rank:6,fingerprint:"synthetic-report-revision-1"};
  const duplicate={...task};
  const acknowledged={at:"2026-10-22T12:00:00.000Z",details:{
    taskId:task.id,action:"completed",actual:80,rank:6,
    fingerprint:"synthetic-report-revision-1",until:"2026-10-22T14:00:00.000Z"
  }};
  const now=Date.parse("2026-10-27T18:00:00.000Z");
  assert.deepEqual(Array.from(ranking.topFive([task,duplicate],[acknowledged],engine,now),item=>item.id),[],
    "same verified report after a repeated import must not recreate acknowledged work");
  const changed={...task,fingerprint:"synthetic-report-revision-2"};
  assert.equal(engine.eligible(changed,[acknowledged],now),true,
    "new source evidence becomes actionable after the configured three-workday follow-up");
});

test("a synthetic RO commitment's production priority escalates after its due date",()=>{
  const {engine,dailyPriority}=buildEngine();
  const record={id:"synthetic-case-alpha",advisor:"Synthetic Advisor",advisorCode:"synthetic-advisor",daysOpen:4,
    sourceStatus:"Synthetic Repair",management:{status:"Being Repaired",nextAction:"Synthetic follow-up",
      reviewDate:"2026-10-26",managerReviewedOn:""}};
  const api={closed:()=>false,priority:dailyPriority,status:row=>row.management?.status||""};
  const before=engine.roTask(record,api,"2026-10-25",Date.parse("2026-10-25T12:00:00.000Z"));
  const after=engine.roTask(record,api,"2026-10-27",Date.parse("2026-10-27T12:00:00.000Z"));
  assert.equal(before.rank,4,"a future verified date starts as a planned RO task");
  assert.equal(after.rank,1,"production priority marks the same promise overdue after its date passes");
  const completed={at:"2026-10-24T16:00:00.000Z",details:{
    taskId:before.id,action:"completed",rank:before.rank,fingerprint:before.fingerprint,
    until:"2026-10-29T18:00:00.000Z"
  }};
  assert.equal(engine.eligible(before,[completed],Date.parse("2026-10-25T12:00:00.000Z")),false,
    "the saved promise remains suppressed before the due date");
  assert.equal(engine.eligible(after,[completed],Date.parse("2026-10-27T12:00:00.000Z")),true,
    "the actual production rank escalation resurfaces the missed promise despite the active acknowledgment window");
});
