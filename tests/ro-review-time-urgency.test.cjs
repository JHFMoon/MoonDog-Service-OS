"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const source=fs.readFileSync(path.join(__dirname,"..","assets","daily-engine.js"),"utf8");
const context=vm.createContext({Date,Intl});
vm.runInContext(source,context);
const engine=context.MoonDogDailyEngine;
const day="2026-10-13";
const now=new Date(2026,9,13,12,0).getTime();
const api={
  closed:()=>false,
  priority:()=>5, // Isolate the clock-based escalation from source/date priority.
  status:()=>"Repair"
};
const makeRO=(reviewDate=day,reviewTime="")=>({
  id:"SYNTHETIC-RO",
  daysOpen:0,
  management:{reviewDate,reviewTime,nextAction:"",status:"Repair",communication:""}
});
const ranked=(reviewTime,reviewDate=day)=>engine.roTask(makeRO(reviewDate,reviewTime),api,day,now);

test("invalid clock strings cannot turn routine ROs into false overdue commitments",()=>{
  for(const invalid of ["-10:00","11:-01","11:60","99:00","24:00","not-time"]){
    const result=ranked(invalid);
    assert.equal(result.rank,5,invalid+" should not be urgent");
    assert.equal(result.hard,false);
    assert.equal(result.title,"Review this RO");
    assert.equal(result.deadline,day+"T23:59:00");
  }
});

test("real past commitments still receive urgent RO follow-up",()=>{
  for(const time of ["11:30","9:15","09:15"]){
    const result=ranked(time);
    assert.equal(result.rank,1,time+" is past the local noon review");
    assert.equal(result.title,"Follow up on this commitment");
    assert.equal(result.hard,true);
    assert.equal(result.deadline,day+"T"+(time.length===4?"0"+time:time)+":00");
  }
});

test("future valid clock and date preserve normal rank and comparable deadline",()=>{
  const future=ranked("13:15");
  assert.equal(future.rank,5);
  assert.equal(future.deadline,day+"T13:15:00");
  assert.equal(ranked("").deadline,day+"T23:59:00");
  assert.equal(ranked("08:30","2026-02-31").deadline,null,
    "impossible calendar days must not participate in deadline ordering");
  assert.equal(ranked("08:30","2026-10-14").deadline,"2026-10-14T08:30:00");
});

test("the date-source due-today priority remains authoritative",()=>{
  const dueTodayApi={...api,priority:()=>2};
  const item=engine.roTask(makeRO(day,"13:15"),dueTodayApi,day,now);
  assert.equal(item.rank,2);
  assert.equal(item.title,"Keep this commitment today");
});

test("RO commitment deferral honors the dealership timezone rather than the computer clock",()=>{
  const freshnessSource=fs.readFileSync(path.join(__dirname,"..","assets","freshness.js"),"utf8");
  function inStore(zone){
    const cx=vm.createContext({Date,Intl,__moondogSettingsModel:{settings:{store:{timeZone:zone}}}});
    vm.runInContext(freshnessSource,cx);
    vm.runInContext(source,cx);
    return cx.MoonDogDailyEngine;
  }
  const cases=[
    ["Pacific standard","America/Los_Angeles","2026-11-16T17:30:00.000Z","2026-11-16","09:35","2026-11-16T17:32:30.000Z"],
    ["Pacific daylight","America/Los_Angeles","2026-07-20T16:30:00.000Z","2026-07-20","09:35","2026-07-20T16:32:30.000Z"],
    ["Eastern standard","America/New_York","2026-11-16T14:30:00.000Z","2026-11-16","09:35","2026-11-16T14:32:30.000Z"],
    ["Japan standard","Asia/Tokyo","2026-11-16T00:30:00.000Z","2026-11-16","09:35","2026-11-16T00:32:30.000Z"]
  ];
  for(const [label,zone,now,day,time,expected] of cases){
    const engine=inStore(zone),ro=makeRO(day,time),at=Date.parse(now);
    const urgent=engine.roTask(ro,{...api,priority:()=>1},day,at);
    assert.equal(urgent.deadline,day+"T"+time+":00",label+" source deadline");
    assert.equal(engine.deferUntil(urgent,[],at),expected,
      label+" follow-up must occur before the real store-local commitment");
  }
  const engine=inStore("America/Los_Angeles"),at=Date.parse("2026-11-16T17:30:00Z");
  assert.equal(engine.deferUntil({id:"synthetic",hard:true,
    deadline:"2026-11-16T17:35:00Z"},[],at),"2026-11-16T17:32:30.000Z",
    "explicit UTC deadline remains absolute");
  assert.equal(engine.deferUntil({id:"synthetic",hard:true,
    deadline:"2026-11-16T09:25:00"},[],at),"2026-11-16T17:40:00.000Z",
    "an already overdue promise preserves the existing bounded deferral");
});
