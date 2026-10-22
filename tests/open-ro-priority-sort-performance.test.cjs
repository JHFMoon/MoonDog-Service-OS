"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {performance}=require("node:perf_hooks");

const source=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=source.indexOf("  function sortOpenRoRows(");
const end=source.indexOf("  function renderTable()",start);
assert.ok(start>=0&&end>start,"Run the actual production Open RO sorting function");
const production=source.slice(start,end);

// Frozen pre-change priority comparator, for ordering and timing comparison.
// The original recalculated admin closeout 1-3 times for EACH comparison.
const baseline=String.raw`
function baselineSort(rows,today,mode="priority"){
  const byRo=(a,b)=>String(a.ro||"").localeCompare(String(b.ro||""),undefined,{numeric:true});
  const byAdvisor=(a,b)=>String(a.advisor||"").localeCompare(String(b.advisor||""))||byRo(a,b);
  const byLongest=(a,b)=>(Number(b.daysOpen)||0)-(Number(a.daysOpen)||0)||byRo(a,b);
  const priority=(record)=>clarificationFor(record)?0:isClosedManagement(record.management)?8:adminCloseoutState(record,today).overdue?1:adminCloseoutState(record,today).needsCommitment?2:adminCloseoutState(record,today).dueToday?3:record.management.reviewDate&&record.management.reviewDate<today?4:record.management.reviewDate===today?5:!record.management.nextAction?6:7;
  const byPriority=(a,b)=>priority(a)-priority(b)||String(a.management.reviewDate||"9999-12-31").localeCompare(String(b.management.reviewDate||"9999-12-31"))||byAdvisor(a,b);
  return [...rows].sort(mode==="longest"?byLongest:mode==="advisor"?byAdvisor:mode==="ro"?byRo:byPriority);
}
`;

function harness() {
  let closeoutCalls=0;
  const context={
    clarificationFor:r=>r.management?.clarification?.reason||"",
    isClosedManagement:m=>String(m?.status||"").toLowerCase()==="closed",
    adminCloseoutState:(r,today)=>{
      closeoutCalls++;
      const c=r.management?.adminCloseout;
      if(!c?.blocker||c.physicalWorkStatus!=="verified")return {overdue:false,needsCommitment:false,dueToday:false};
      // Synthetic verified administrative commitments and revision history:
      // enough real work to reveal repeated evaluations, no private data.
      const taskDate=c.taskDate||"",closeDate=c.expectedCloseDate||"";
      let missed=0;
      for(const revision of c.revisions||[]){
        if(revision?.previous?.taskDate&&revision.at.slice(0,10)>revision.previous.taskDate)missed++;
      }
      return {overdue:!!((taskDate&&taskDate<today)||(closeDate&&closeDate<today)),
        needsCommitment:!taskDate||!closeDate,
        dueToday:taskDate===today||closeDate===today,missed};
    }
  };
  vm.runInNewContext(production+"\n"+baseline+"\nthis.sortNew=sortOpenRoRows;this.sortOld=baselineSort;",context);
  return {context,getCalls:()=>closeoutCalls,reset:()=>{closeoutCalls=0;}};
}

function fixtures(n=4000){
  return Array.from({length:n},(_,i)=>({
    ro:String(30000+i),advisor:"Synthetic "+(i%9),daysOpen:i%46,
    management:{
      status:i%13===0?"Closed":"Open",
      reviewDate:["2026-10-20","2026-10-21","2026-10-22",""][i%4],
      nextAction:i%6===0?"":"Follow up",
      clarification:i%23===0?{reason:"Needs verification"}:null,
      adminCloseout:i%4===0?{
        blocker:"Billing",physicalWorkStatus:"verified",
        taskDate:["2026-10-19","2026-10-21",""][i%3],
        expectedCloseDate:["2026-10-22","2026-10-20",""][i%3],
        revisions:Array.from({length:10},(_,k)=>({
          at:"2026-10-"+String(5+k).padStart(2,"0")+"T12:00:00Z",
          previous:{taskDate:"2026-10-05"}
        }))
      }:null
    }
  }));
}
const ids=records=>Array.from(records,record=>record.ro);
const TODAY="2026-10-21";

test("all four sorts match pre-change order without mutating the input",()=>{
  const h=harness(),rows=fixtures(1500),before=ids(rows);
  for(const mode of ["priority","advisor","ro","longest"]){
    assert.deepEqual(ids(h.context.sortNew(rows,TODAY,mode)),ids(h.context.sortOld(rows,TODAY,mode)),mode+" order must match");
  }
  assert.deepEqual(ids(rows),before,"sorting never mutates authoritative input");
  assert.deepEqual(ids(h.context.sortNew([],TODAY)),[]);
  assert.deepEqual(ids(h.context.sortNew([rows[0]],TODAY)),[rows[0].ro]);
});

test("priority state is checked at most once per RO per render",()=>{
  const h=harness(),rows=fixtures(3000);
  h.context.sortOld(rows,TODAY);
  const baselineCalls=h.getCalls();
  h.reset();
  h.context.sortNew(rows,TODAY);
  const optimizedCalls=h.getCalls();
  assert.ok(optimizedCalls<=rows.length,"each candidate is scored no more than once");
  assert.ok(baselineCalls>optimizedCalls*5,"remove repeated administrative parsing within sort comparators");
  h.reset();
  for(const mode of ["advisor","longest","ro"])h.context.sortNew(rows,TODAY,mode);
  assert.equal(h.getCalls(),0,"non-priority sorts never parse administrative commitments");
});

test("the next render immediately reflects edits, closures and new source rows",()=>{
  const h=harness(),rows=fixtures(180);
  const before=ids(h.context.sortNew(rows,TODAY));
  const target=rows.at(-1);
  target.management.reviewDate="2026-10-01";
  target.management.clarification={reason:"Needs review"};
  const after=ids(h.context.sortNew(rows,TODAY));
  assert.notDeepEqual(after,before,"current RO edits invalidate the call-local ranking");
  assert.equal(after[0],target.ro,"clarification takes top priority");
  target.management.clarification=null;
  target.management.status="Closed";
  const closed=ids(h.context.sortNew(rows,TODAY));
  assert.deepEqual(closed,ids(h.context.sortOld(rows,TODAY)),"closed-state change is authoritative");
  rows.push({...target,ro:"new-record",management:{...target.management,status:"Open",clarification:{reason:"Missing details"}}});
  assert.equal(h.context.sortNew(rows,TODAY)[0].ro,"new-record","newly imported ROs join the next sort");
});

test("large synthetic priority sort has measured baseline and no display-order change",()=>{
  const h=harness(),rows=fixtures(5000);
  assert.deepEqual(ids(h.context.sortNew(rows,TODAY)),ids(h.context.sortOld(rows,TODAY)));
  const sample=fn=>{
    for(let i=0;i<3;i++)fn(rows,TODAY);
    const times=[];
    for(let i=0;i<11;i++){const started=performance.now();fn(rows,TODAY);times.push(performance.now()-started);}
    times.sort((a,b)=>a-b);
    return {p50:times[5],p95:times[10]};
  };
  const old=sample(h.context.sortOld),current=sample(h.context.sortNew);
  const number=n=>Number(n.toFixed(1));
  console.log("Synthetic Open RO priority sort (5000 ROs, 11 warmed samples): before p50="+number(old.p50)+"ms p95="+number(old.p95)+"ms; after p50="+number(current.p50)+"ms p95="+number(current.p95)+"ms; p50 reduction="+number(100*(1-current.p50/old.p50))+"%. Hardware/browser/OneDrive not measured.");
  assert.ok(Number.isFinite(old.p50)&&Number.isFinite(current.p50));
  assert.match(production,/const ranks=new Map\(\)/,"priority cache must be call-local");
  new vm.Script(source);
});
