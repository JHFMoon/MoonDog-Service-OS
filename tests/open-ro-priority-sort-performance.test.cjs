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
const exactFunction=(name)=>{
  const start=app.indexOf("  function "+name+"("),end=app.indexOf("\n  function ",start+11);
  assert.ok(start>=0&&end>start,"Shipped helper must exist: "+name);
  const block=app.slice(start,end);
  return name==="adminCloseoutRevisionDay"?block.split("\n  const ")[0]:block;
};
const exactLine=(prefix)=>{
  const start=app.indexOf(prefix);
  assert.ok(start>=0,"Shipped constant must exist: "+prefix);
  return app.slice(start,app.indexOf("\n",start));
};
const productionCloseout=[
  exactLine("const FRESH_MANAGEMENT_STATUSES ="),
  exactLine("const COMMUNICATION_STATUSES ="),
  exactLine("const statusRecord ="),
  exactLine("const norm ="),
  ...["managementStatusDefinitions","statusById","canonicalReviewStatus",
    "currentCdkReviewStatus","normalizeCommunication","semanticFieldIssue",
    "clarificationFor","isClosedManagement","adminCloseoutDaysLate",
    "adminCloseoutValidDate","adminCloseoutRevisionDay","adminCloseoutState"]
    .map(exactFunction)
].join("\n");
// The frozen pre-change sorter is the only non-production implementation.
// Pre-change comparator is the behavior oracle, not the performance target.
const original = "  function sortOpenRoRows(rows,today,mode=\"priority\"){\n    const byRo=(a,b)=>String(a.ro||\"\").localeCompare(String(b.ro||\"\"),undefined,{numeric:true});\n    const byAdvisor=(a,b)=>String(a.advisor||\"\").localeCompare(String(b.advisor||\"\"))||byRo(a,b);\n    const byLongest=(a,b)=>(Number(b.daysOpen)||0)-(Number(a.daysOpen)||0)||byRo(a,b);\n    const priority=(record)=>clarificationFor(record)?0:isClosedManagement(record.management)?8:adminCloseoutState(record,today).overdue?1:adminCloseoutState(record,today).needsCommitment?2:adminCloseoutState(record,today).dueToday?3:record.management.reviewDate&&record.management.reviewDate<today?4:record.management.reviewDate===today?5:!record.management.nextAction?6:7;\n    const byPriority=(a,b)=>priority(a)-priority(b)||String(a.management.reviewDate||\"9999-12-31\").localeCompare(String(b.management.reviewDate||\"9999-12-31\"))||byAdvisor(a,b);\n    return [...rows].sort(mode===\"longest\"?byLongest:mode===\"advisor\"?byAdvisor:mode===\"ro\"?byRo:byPriority);\n  }\n";
function harness(code) {
  const calls={clarification:0,closeout:0,closed:0},context={};
  vm.runInNewContext(productionCloseout+
    "\nthis.shippedCloseout=adminCloseoutState;this.shippedClarification=clarificationFor;this.shippedClosed=isClosedManagement;",context);
  const closeout=context.shippedCloseout,clarification=context.shippedClarification,closed=context.shippedClosed;
  context.adminCloseoutState=(record,today)=>{calls.closeout++;return closeout(record,today);};
  context.clarificationFor=(record)=>{calls.clarification++;return clarification(record);};
  context.isClosedManagement=(management)=>{calls.closed++;return closed(management);};
  vm.runInNewContext(code+"\nthis.sortRows=sortOpenRoRows",context);
  return {sort:context.sortRows,calls,reset(){calls.clarification=0;calls.closeout=0;calls.closed=0;}};
}
function records(count=800){
  // No dealership data, no identifying employee/customer or VIN data.
  return Array.from({length:count},(_,i)=>{
    const due=["2026-10-17","2026-10-21","2026-10-24",""][i%4];
    return {id:"synthetic-"+i,ro:String(10000+(count-i)),advisor:"Synthetic "+(i%7),
      daysOpen:i%29,cdkOperational:{status:"Being Repaired",stale:false},
      management:{
        status:i%13===0?"Closed":"Being Repaired",
        clarification:i%17===0?{reason:"Review reason"}:null,
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
  rows[10].management.clarification={reason:"Needs manager attention"};
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
