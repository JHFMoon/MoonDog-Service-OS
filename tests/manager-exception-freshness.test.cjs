"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const read=file=>fs.readFileSync(path.join(__dirname,"..","assets",file),"utf8");

function engine(){
  const context=vm.createContext({Date,Intl,console,__moondogSettingsModel:{
    settings:{store:{timeZone:"UTC"},future:{managerSchedule:{days:[1,2,3,4,5]}}}
  }});
  vm.runInContext(read("freshness.js"),context);
  vm.runInContext(read("daily-engine.js"),context);
  return {engine:context.MoonDogDailyEngine,ranking:context.ServiceRefreshIntelligence};
}

test("unchanged exception evidence remains deduplicated across source reimport and only new evidence resurfaces",()=>{
  const {engine,ranking}=engine();
  const task={id:"coaching:synthetic-advisor:tires",type:"coaching",advisor:"synthetic-advisor",
    key:"tires",actual:80,rank:6,fingerprint:"synthetic-report-revision-1"};
  const duplicate={...task,id:"coaching:synthetic-advisor:tires:reimport"};
  const acknowledged={at:"2026-10-22T12:00:00.000Z",details:{
    taskId:task.id,action:"completed",actual:80,rank:6,
    fingerprint:"synthetic-report-revision-1",until:"2026-10-22T14:00:00.000Z"
  }};
  const now=Date.parse("2026-10-27T18:00:00.000Z");
  assert.deepEqual(ranking.topFive([task,duplicate],[acknowledged],engine,now),[],
    "same verified report after a repeated import must not recreate acknowledged work");
  const changed={...task,fingerprint:"synthetic-report-revision-2"};
  assert.equal(engine.eligible(changed,[acknowledged],now),true,
    "new source evidence becomes actionable after the configured three-workday follow-up");
  assert.equal(JSON.stringify([task,duplicate]).includes("Customer"),false,
    "fixture contains no customer or operational data");
});

test("a missed synthetic RO follow-up resurfaces when its promised date passes and priority escalates",()=>{
  const {engine}=engine();
  const id="ro:synthetic-case-alpha";
  const saved={id,type:"ro",recordId:"synthetic-case-alpha",rank:4,fingerprint:"synthetic-plan-revision-1",
    record:{management:{reviewDate:"2026-10-26",managerReviewedOn:""}}};
  const completed={at:"2026-10-24T16:00:00.000Z",details:{
    taskId:id,action:"completed",rank:4,fingerprint:"synthetic-plan-revision-1",
    until:"2026-10-24T18:00:00.000Z"
  }};
  assert.equal(engine.eligible(saved,[completed],Date.parse("2026-10-25T16:00:00.000Z")),false,
    "a future manager commitment remains suppressed before its due date");
  const missed={...saved,rank:2,record:{management:{reviewDate:"2026-10-24",managerReviewedOn:""}}};
  assert.equal(engine.eligible(missed,[completed],Date.parse("2026-10-25T16:00:00.000Z")),true,
    "a missed promised date is new escalation even when the source fingerprint is unchanged");
});
