"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const from=app.indexOf("  const MANAGER_WORK_DAYS = Object.freeze([2,3,4,5,6]);");
const to=app.indexOf("  function focusCandidates(",from);
assert.ok(from>=0&&to>from,"manager schedule helpers are available");
function makeCalendar(settings={}) {
  const context={
    model:{settings},
    DEFAULTS:{future:{managerSchedule:{days:[2,3,4,5,6],startTime:"07:30",endTime:"16:00"}}},
    freshness:{
      dayOfWeek:(key)=>new Date(key+"T12:00:00Z").getUTCDay(),
      timeParts:(date,zone)=>({date:"2026-10-13",hour:date.getUTCHours(),minute:date.getUTCMinutes(),zone})
    },
    businessTimeZone:()=> "America/Los_Angeles"
  };
  vm.runInNewContext(app.slice(from,to)+"\nthis.managerScheduleTest={managerWorkSchedule,isDailyFocusDay,isManagerWorkingTime};",context);
  return context.managerScheduleTest;
}
const when=(hour,minute=0)=>new Date(Date.UTC(2026,9,13,hour,minute));

test("defaults are Tue-Sat 07:30 to 16:00 in manager schedule only",()=>{
  const calendar=makeCalendar();
  const schedule=calendar.managerWorkSchedule();
  assert.equal(schedule.startTime,"07:30");
  assert.equal(schedule.endTime,"16:00");
  assert.equal([...schedule.days].join(","),"2,3,4,5,6");
  assert.equal(calendar.isDailyFocusDay("2026-10-12"),false);
  assert.equal(calendar.isDailyFocusDay("2026-10-13"),true);
  assert.equal(calendar.isDailyFocusDay("2026-10-18"),false);
});

test("routine manager work availability honors the entire time window",()=>{
  const calendar=makeCalendar();
  assert.equal(calendar.isManagerWorkingTime(when(7,29)),false);
  assert.equal(calendar.isManagerWorkingTime(when(7,30)),true);
  assert.equal(calendar.isManagerWorkingTime(when(15,59)),true);
  assert.equal(calendar.isManagerWorkingTime(when(16,0)),false);
});

test("changed local schedule applies without changing general operating day rules",()=>{
  const calendar=makeCalendar({future:{managerSchedule:{days:[1,2,3,4,5],startTime:"08:00",endTime:"17:30"}}});
  assert.equal(calendar.isDailyFocusDay("2026-10-12"),true);
  assert.equal(calendar.isDailyFocusDay("2026-10-17"),false);
  assert.equal(calendar.isManagerWorkingTime(when(7,59)),false);
  assert.equal(calendar.isManagerWorkingTime(when(17,29)),true);
});

test("manager schedule controls are private settings, not advisor Meeting content",()=>{
  for(const day of ["0","1","2","3","4","5","6"]) assert.match(html,new RegExp('name="managerWorkday" value="'+day+'"'));
  assert.match(html,/id="managerWorkStart"/);
  assert.match(html,/id="managerWorkEnd"/);
  assert.match(app,/model\.settings\.future=\{\.\.\.model\.settings\.future,managerSchedule:/);
  assert.match(app,/Manager end time must be later than start time/);
  assert.match(app,/isDailyFocusDay\(today\) \|\| !isManagerWorkingTime\(\)/);
  assert.match(app,/function adminCloseoutState\(/);
  assert.match(app,/function dailyFocusPriority\(/);
  assert.doesNotMatch(html,/id="advisorManagerWorkSchedule"/);
});

test("invalid previously saved schedule data falls back safely",()=>{
  const calendar=makeCalendar({future:{managerSchedule:{days:[-1,9],startTime:"99:00",endTime:"bad"}}});
  const schedule=calendar.managerWorkSchedule();
  assert.equal(schedule.days.join(","),"2,3,4,5,6");
  assert.equal(schedule.startTime,"07:30");
  assert.equal(schedule.endTime,"16:00");
});
