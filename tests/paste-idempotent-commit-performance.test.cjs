"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const readSource=require("./helpers/read-source.cjs");
const path=require("node:path");
const {performance}=require("node:perf_hooks");
const app=readSource(path.join(__dirname,"..","assets","app.js"));
const diffStart=app.indexOf("  function pasteDiff(");
const diffEnd=app.indexOf("  async function analyzePasteLearning(",diffStart);
const commitStart=app.indexOf("  async function commitPasteLearning(");
const commitEnd=app.indexOf("  async function savePasteLearningRule(",commitStart);
assert.ok(diffStart>0&&diffEnd>diffStart&&commitStart>diffEnd&&commitEnd>commitStart);
const diffSource=app.slice(diffStart,diffEnd);
const commitSource=app.slice(commitStart,commitEnd);
const fastPath=String.raw`      // After the shared lock has verified current durable state, a fully
      // unchanged partial import has nothing to merge, back up, or redraw.
      // Retain the same eligibility, identity and concurrent-Workspace gates.
      if(rechecked.changes?.length===preview.parsed.records.length&&
          rechecked.changes.every(change=>change.kind==="unchanged")){
        pastePreview=null;
        return{status:"unchanged",added:0,updated:0,missingClosed:0};
      }
`;
assert.equal(commitSource.split(fastPath).length,2,"exact production fast path must exist once");
const legacySource=commitSource.replace(fastPath,"");
function makeHarness(source,count=2100,options={}){
  const root={name:"Synthetic only"};
  const records=Array.from({length:count},(_,i)=>({id:"synthetic-"+i,ro:String(930000+i),
    vin:"SYNTHETIC-INVALID-VIN-A",sourceStatus:"Open",advisorCode:"110",opened:"10/12/2026"}));
  const incoming=records.slice(0,Math.min(count,300)).map(row=>({...row}));
  const model={root,state:{updatedAt:"synthetic-before",records,closedRecords:[],
    source:{fileName:"synthetic-verified",importedAt:"2026-10-12T12:00:00.000Z"}}};
  const calls={locks:0,writeChecks:0,writes:0,backups:0,history:0,renders:0};
  const cx={model,folderWatch:{busy:false},pasteCommitBusy:false,dailyImportBusy:false,
    appointmentImportBusy:false,workspaceConnectionBusy:false,postConnectionScanBusy:false,
    writeAuthority:{requireWrite:()=>{calls.writeChecks++;if(options.denied)throw Error("Permission denied");}},
    withSupervisorWorkbookLock:async operation=>{calls.locks++;if(options.staleDurable)throw Error("Workspace changed in another tab");return operation();},
    defaultManagementFor:()=>({}),operationalStatusFromImport:()=>null,
    backupState:async()=>{calls.backups++;},writeJson:async()=>{calls.writes++;},
    addHistory:async()=>{calls.history++;},markSupervisorWorkbookStale:async()=>{},
    renderAll:()=>{calls.renders++;},now:()=>new Date("2026-10-12T12:01:00.000Z").toISOString(),
    recordDiagnostic:()=>{},STATE_PATH:["data","current-state.json"],pastePreview:null};
  vm.runInNewContext(diffSource+"\n"+source+"\nthis.commit=commitPasteLearning;",cx);
  function resetPreview(){
    const diff=cx.pasteDiff({records:incoming,issues:[]});
    cx.pastePreview={nonce:"synthetic-reviewed",root,updatedAt:model.state.updatedAt,
      priorIds:model.state.records.map(row=>row.id).join("|"),parsed:{records:incoming,issues:[]},
      diff};
  }
  resetPreview();
  return{cx,model,records,incoming,calls,resetPreview,run:()=>cx.commit("synthetic-reviewed")};
}
function percentile(values,p){
  const ordered=[...values].sort((a,b)=>a-b);
  return ordered[Math.min(ordered.length-1,Math.max(0,Math.ceil(ordered.length*p)-1))];
}
test("unchanged reimport skips merge maps and redraw after required authority checks",async()=>{
  const h=makeHarness(commitSource,2100);
  const original=JSON.stringify(h.model.state);
  const result=await h.run();
  assert.equal(result.status,"unchanged");
  assert.equal(result.added,0);assert.equal(result.updated,0);assert.equal(result.missingClosed,0);
  assert.equal(h.calls.locks,1);assert.equal(h.calls.writeChecks,1);
  assert.equal(h.calls.writes,0);assert.equal(h.calls.backups,0);assert.equal(h.calls.history,0);
  assert.equal(h.calls.renders,0);assert.equal(h.cx.pastePreview,null);
  assert.equal(JSON.stringify(h.model.state),original);
  h.resetPreview();
  assert.equal((await h.run()).status,"unchanged","repeated no-op must stay idempotent");
  assert.equal(JSON.stringify(h.model.state),original);
});
test("fast path does not bypass permission, lock, stale preview or VIN conflict",async()=>{
  const denied=makeHarness(commitSource,2100,{denied:true});
  await assert.rejects(()=>denied.run(),/Permission denied/);
  assert.equal(denied.calls.locks,0);
  const stale=makeHarness(commitSource,2100,{staleDurable:true});
  await assert.rejects(()=>stale.run(),/Workspace changed/);
  assert.equal(stale.calls.locks,1);
  const preview=makeHarness(commitSource,2100);
  preview.model.state.updatedAt="changed";
  await assert.rejects(()=>preview.run(),/changed/);
  assert.equal(preview.calls.locks,0);
  const conflict=makeHarness(commitSource,2100);
  conflict.incoming[0].vin="SYNTHETIC-INVALID-VIN-B";
  conflict.resetPreview();
  await assert.rejects(()=>conflict.run(),/identities changed|Unresolved issues/);
  assert.equal(conflict.calls.writes,0);
});
test("changed records follow the same durable write path, not the no-op shortcut",async()=>{
  const h=makeHarness(commitSource,2100);
  h.incoming[0].sourceStatus="Working";
  h.resetPreview();
  const out=await h.run();
  assert.equal(out.status,"saved");assert.equal(out.updated,1);
  assert.equal(h.calls.locks,1);assert.equal(h.calls.writeChecks,1);
  assert.equal(h.calls.backups,1);assert.equal(h.calls.writes,1);
  assert.equal(h.calls.history,1);assert.equal(h.calls.renders,1);
  assert.equal(h.model.state.records.find(r=>r.ro===h.incoming[0].ro).sourceStatus,"Working");
});
test("paired 24-sample VM calculation benchmark: unchanged clipboard reimport at 2100 and 15000 ROs",async()=>{
  for(const count of [2100,15000]){
    const old=makeHarness(legacySource,count),next=makeHarness(commitSource,count);
    for(let n=0;n<4;n++){
      old.resetPreview();await old.run();
      next.resetPreview();await next.run();
    }
    const before=[],after=[];
    for(let n=0;n<24;n++){
      const first=n%2===0?old:next,second=n%2===0?next:old;
      first.resetPreview();
      const start=performance.now();await first.run();
      const firstMs=performance.now()-start;
      second.resetPreview();
      const secondStart=performance.now();await second.run();
      const secondMs=performance.now()-secondStart;
      if(n%2===0){before.push(firstMs);after.push(secondMs);}
      else{after.push(firstMs);before.push(secondMs);}
    }
    assert.equal(old.model.state.updatedAt,"synthetic-before");
    assert.equal(next.model.state.updatedAt,"synthetic-before");
    assert.equal(old.calls.writes,0);assert.equal(next.calls.writes,0);
    const result={records:count,reimported:Math.min(count,300),samples:24,
      legacy:{p50:+percentile(before,.5).toFixed(3),p95:+percentile(before,.95).toFixed(3)},
      optimized:{p50:+percentile(after,.5).toFixed(3),p95:+percentile(after,.95).toFixed(3)},
      scope:"actual extracted production functions; synthetic Node VM; unchanged reimport calculation after mocked lock; excludes disk, full browser rendering and OneDrive"};
    console.log("58-05 paired unchanged-paste-reimport performance",JSON.stringify(result));
  }
});
