"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Execute the actual production Daily Walk prioritizer and visible reason,
// without creating a folder, an operational file, or a browser session.
require("../assets/freshness.js");
const app = fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function productionFunction(name, terminator) {
  const begin = app.indexOf("  function "+name+"(");
  const end = app.indexOf(terminator, begin);
  assert.ok(begin>=0&&end>begin,"Actual production function boundaries exist: "+name);
  return app.slice(begin,end);
}
const source = productionFunction("dailyFocusPriority","  const MANAGER_WORK_DAYS")+
               productionFunction("focusReason","  function renderDailyFocus");
const context = {
  freshness: globalThis.MoonDogFreshness,
  localDateKey: () => "2026-01-20",
  clarificationFor: record => Boolean(record.needsClarification)
};
vm.runInNewContext(source,context);
const prioritize = context.dailyFocusPriority, reason = context.focusReason;
const ro = (date,action="Call customer with parts ETA")=>({management:{reviewDate:date,nextAction:action}});

test("invalid Gregorian commitment cannot display as completed future plan in Daily Walk",()=>{
  for(const date of ["2026-02-29","2026-02-31","2026-04-31","2026-00-30","2026-13-01","not-a-date"]){
    const record=ro(date);
    assert.equal(prioritize(record,"2026-01-20"),3,date+" must need a real commitment");
    assert.equal(reason(record,"2026-01-20")[0],"Next action and commitment needed",date+" cannot show Committed");
  }
});
test("legitimate overdue, due-today, future and missing-action plans preserve their manager priority",()=>{
  assert.equal(prioritize(ro("2026-01-19"),"2026-01-20"),1);
  assert.equal(reason(ro("2026-01-19"),"2026-01-20")[0],"OVERDUE · 2026-01-19");
  assert.equal(prioritize(ro("2026-01-20"),"2026-01-20"),2);
  assert.equal(reason(ro("2026-01-20"),"2026-01-20")[0],"DUE TODAY");
  assert.equal(prioritize(ro("2026-02-28"),"2026-01-20"),4);
  assert.equal(reason(ro("2026-02-28"),"2026-01-20")[0],"Committed · 2026-02-28");
  assert.equal(prioritize(ro("2026-02-28",""),"2026-01-20"),3);
  assert.equal(prioritize(ro(""),"2026-01-20"),3);
});
test("an RO clarification remains the highest Daily Walk selection priority",()=>{
  const record={...ro("2026-02-31"),needsClarification:true};
  assert.equal(prioritize(record,"2026-01-20"),0);
  assert.equal(reason(record,"2026-01-20")[0],"Ask in person");
});
