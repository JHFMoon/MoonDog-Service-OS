"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {performance} = require("node:perf_hooks");
const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  function sortOpenRoRows(rows,today,mode=\"priority\"){");
const end = app.indexOf("  function renderTable()",start);
assert.ok(start >= 0 && end > start, "Use the shipped Open RO priority sorter");
const source = app.slice(start,end);
// Execute the shipped administrative-closeout logic in both comparator variants,
// including validated task/close dates, historical revisions and closed-RO gating.
const productionCloseout = "  function adminCloseoutDaysLate(date, today) {\n    if (!adminCloseoutValidDate(date) || !adminCloseoutValidDate(today)) return 0;\n    const due = Date.parse(date + \"T12:00:00Z\"), current = Date.parse(today + \"T12:00:00Z\");\n    return Math.max(0, Math.round((current - due) / 86400000));\n  }\n  function adminCloseoutValidDate(value) {\n    if (typeof value !== \"string\" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value) || value.startsWith(\"0000-\")) return false;\n    const time = Date.parse(value + \"T12:00:00Z\");\n    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;\n  }\n  // Historic imported revisions do not prove a missed promise unless the\n  // previous deadline and the revision timestamp are both valid evidence.\n  function adminCloseoutRevisionDay(at) {\n    const match = typeof at === \"string\" && at.match(/^(\\d{4}-\\d{2}-\\d{2})T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|[+-](?:(?:0\\d|1[0-3]):[0-5]\\d|14:00))$/);\n    return match && adminCloseoutValidDate(match[1]) && Number.isFinite(Date.parse(at)) ? match[1] : \"\";\n  }\n  function adminCloseoutState(record, today = localDateKey()) {\n    const closeout = record?.management?.adminCloseout;\n    // Never resurface administrative follow-ups once the RO is verified closed.\n    if (!closeout?.blocker || isClosedManagement(record?.management)) {\n      return { active: false, overdue: false, dueToday: false, needsCommitment: false };\n    }\n    if (closeout.physicalWorkStatus !== \"verified\") {\n      return { active: false, verified: false, overdue: false, dueToday: false, needsCommitment: false };\n    }\n    // A manager review/reminder date is not proof of an advisor task commitment.\n    // Legacy or imported malformed dates are not verified missed promises.\n    // Leave the item actionable as an absent commitment for manager review.\n    const taskDate = adminCloseoutValidDate(closeout.taskDate) ? closeout.taskDate : \"\";\n    const closeDate = adminCloseoutValidDate(closeout.expectedCloseDate) ? closeout.expectedCloseDate : \"\";\n    const taskOverdue = Boolean(taskDate && taskDate < today);\n    const closeOverdue = Boolean(closeDate && closeDate < today);\n    const taskDueToday = taskDate === today;\n    const closeDueToday = closeDate === today;\n    return {\n      active: true, verified: true, blocker: closeout.blocker, taskDate, closeDate,\n      physicalWorkStatus: closeout.physicalWorkStatus || \"verified\",\n      pickupStatus: closeout.pickupStatus || \"\",\n      pickupContactDate: closeout.pickupContactDate || \"\",\n      expectedPickupDate: closeout.expectedPickupDate || \"\",\n      warrantyStatus: closeout.warrantyStatus || \"\",\n      evidence: closeout.evidence || \"\",\n      coachingStatus: closeout.coachingStatus || \"\",\n      coachingAction: closeout.coachingAction || \"\",\n      evidenceHistoryCount: Array.isArray(closeout.evidenceHistory) ? closeout.evidenceHistory.length : 0,\n      needsCommitment: !taskDate || !closeDate,\n      taskOverdue, closeOverdue, overdue: taskOverdue || closeOverdue,\n      taskDueToday, closeDueToday, dueToday: taskDueToday || closeDueToday,\n      taskDaysLate: adminCloseoutDaysLate(taskDate, today),\n      closeDaysLate: adminCloseoutDaysLate(closeDate, today),\n      missedRevisions: (Array.isArray(closeout.revisions) ? closeout.revisions : []).filter((revision) => {\n        const changedOn = adminCloseoutRevisionDay(revision?.at);\n        if (!changedOn) return false;\n        const previous = revision?.previous;\n        return Boolean(previous && (\n          (adminCloseoutValidDate(previous.taskDate) && changedOn > previous.taskDate) ||\n          (adminCloseoutValidDate(previous.expectedCloseDate) && changedOn > previous.expectedCloseDate)\n        ));\n      }).length,\n      revisionCount: Array.isArray(closeout.revisions) ? closeout.revisions.length : 0\n    };\n  }";
// Pre-change comparator is the behavior oracle, not the performance target.
const original = "  function sortOpenRoRows(rows,today,mode=\"priority\"){\n    const byRo=(a,b)=>String(a.ro||\"\").localeCompare(String(b.ro||\"\"),undefined,{numeric:true});\n    const byAdvisor=(a,b)=>String(a.advisor||\"\").localeCompare(String(b.advisor||\"\"))||byRo(a,b);\n    const byLongest=(a,b)=>(Number(b.daysOpen)||0)-(Number(a.daysOpen)||0)||byRo(a,b);\n    const priority=(record)=>clarificationFor(record)?0:isClosedManagement(record.management)?8:adminCloseoutState(record,today).overdue?1:adminCloseoutState(record,today).needsCommitment?2:adminCloseoutState(record,today).dueToday?3:record.management.reviewDate&&record.management.reviewDate<today?4:record.management.reviewDate===today?5:!record.management.nextAction?6:7;\n    const byPriority=(a,b)=>priority(a)-priority(b)||String(a.management.reviewDate||\"9999-12-31\").localeCompare(String(b.management.reviewDate||\"9999-12-31\"))||byAdvisor(a,b);\n    return [...rows].sort(mode===\"longest\"?byLongest:mode===\"advisor\"?byAdvisor:mode===\"ro\"?byRo:byPriority);\n  }\n";
function harness(code) {
  const calls = {clarification:0,closeout:0,closed:0};
  const context = {
    clarificationFor(record){calls.clarification++;return record.management.clarification || false;},
    isClosedManagement(m){calls.closed++;return m.status === "Closed";},

  };
  vm.runInNewContext(productionCloseout+"\nthis.shippedCloseout=adminCloseoutState",context);
  const shippedCloseout=context.shippedCloseout;
  context.adminCloseoutState=(record,today)=>{calls.closeout++;return shippedCloseout(record,today);};
  vm.runInNewContext(code+"\nthis.sortRows=sortOpenRoRows",context);
  return {sort:context.sortRows,calls,reset(){calls.clarification=0;calls.closeout=0;calls.closed=0;}};
}
function records(count=800){
  // No dealership data, no identifying employee/customer or VIN data.
  return Array.from({length:count},(_,i)=>{
    const due=["2026-10-17","2026-10-21","2026-10-24",""][i%4];
    return {id:"synthetic-"+i,ro:String(10000+(count-i)),advisor:"Synthetic "+(i%7),
      daysOpen:i%29,management:{
        status:i%13===0?"Closed":"Open",clarification:i%17===0?"Review reason":"",
        reviewDate:due,nextAction:i%5===0?"":"Review",
        adminCloseout:i%3===0?{blocker:"Billing / paperwork",physicalWorkStatus:"verified",
          taskDate:i%9===0?"":i%6===0?"2026-10-19":i%4===0?"2026-10-21":"2026-10-24",
          expectedCloseDate:i%11===0?"":i%7===0?"2026-10-18":"2026-10-24",
          revisions:i%6===0?[{at:"2026-10-21T12:00:00Z",
            previous:{taskDate:"2026-10-17",expectedCloseDate:"2026-10-18"}}]:[]}:null
      }};
  });
}
function ids(rows){return [...rows].map(r=>r.id);}
test("priority, RO, advisor and longest sorts preserve exact pre-change ordering",()=>{
  const old=harness(original),current=harness(source),rows=records(1200);
  const unchanged=ids(rows);
  for(const mode of ["priority","ro","advisor","longest","unknown"]){
    assert.deepEqual(ids(current.sort(rows,"2026-10-21",mode)),
      ids(old.sort(rows,"2026-10-21",mode)),mode+" must not change ranking");
    assert.deepEqual(ids(rows),unchanged,"sort must not change authoritative source order");
  }
  new vm.Script(app);
});
test("priority is recalculated after edits and business date changes",()=>{
  const old=harness(original),current=harness(source),rows=records(90);
  current.sort(rows,"2026-10-21");
  rows[10].management.clarification="Needs manager attention";
  rows[9].management.reviewDate="2026-10-20";
  for(const date of ["2026-10-21","2026-10-24"]){
    assert.deepEqual(ids(current.sort(rows,date)),ids(old.sort(rows,date)),
      "per-call cache must never hold yesterday's priorities or unsaved edits");
  }
});
test("a large priority sort evaluates closeout at most once per RO",()=>{
  const rows=records(1200),old=harness(original),current=harness(source);
  const before=old.sort(rows,"2026-10-21"),after=current.sort(rows,"2026-10-21");
  assert.deepEqual(ids(after),ids(before));
  assert.ok(current.calls.closeout<=rows.length,"no O(n log n) repeated closeout checks");
  assert.ok(current.calls.clarification<=rows.length,"clarification computed once per RO");
  assert.ok(old.calls.closeout>current.calls.closeout*4,
    "baseline repeats closeout work many times on this fixed fixture");
});
test("measured p50/p95 comparison is synthetic and informational, not a device claim",()=>{
  const rows=records(1400),old=harness(original),current=harness(source);
  const percentile=(values,ratio)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.ceil(sorted.length*ratio)-1];};
  const sample=(instance)=>{
    const times=[];
    for(let i=0;i<18;i++){
      const start=performance.now();
      const ordered=instance.sort(rows,"2026-10-21");
      times.push(performance.now()-start);
      if(i===0)assert.equal(ordered.length,rows.length);
    }
    return {p50:percentile(times,.5),p95:percentile(times,.95)};
  };
  // Warm each isolated comparator before measuring. Timing varies by CI host.
  sample(old);sample(current);
  const baseline=sample(old),optimized=sample(current);
  const report={dataset:"synthetic-1400-open-ros",iterations:18,
    beforeP50Ms:+baseline.p50.toFixed(3),afterP50Ms:+optimized.p50.toFixed(3),
    beforeP95Ms:+baseline.p95.toFixed(3),afterP95Ms:+optimized.p95.toFixed(3)};
  console.log("#58 Open RO priority sort before/after (CI synthetic only):",JSON.stringify(report));
  assert.ok(Number.isFinite(report.beforeP95Ms)&&Number.isFinite(report.afterP95Ms));
});
