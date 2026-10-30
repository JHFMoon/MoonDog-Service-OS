"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function extract(from,to){
 const start=app.indexOf(from),end=app.indexOf(to,start);
 assert.ok(start>=0&&end>start,"Expected production source segment: "+from);
 return app.slice(start,end);
}
const source=extract("  let supervisorWorkbookOperationTail = Promise.resolve();","  const dailyPickedSources = new Map();")+
 extract("  async function closeRo(","  async function showHistory(");
const copy=value=>JSON.parse(JSON.stringify(value));
function fixture(options={}){
 const rec={id:"synthetic-ro-1",ro:"123456",management:{owner:"Synthetic Advisor",nextAction:"Call customer",note:"Preserve manual edit"},sourceStatus:"Working"};
 const other={id:"synthetic-ro-2",ro:"123457",management:{owner:"Another advisor",nextAction:"Verify part"}};
 const model={root:{name:"Synthetic Workspace"},selectedId:rec.id,
  openRoSaveInFlight:false,state:{appVersion:"previous",updatedAt:"before",source:{fileName:"synthetic-verified-ro"},
  records:[rec,other],closedRecords:[]}};
 let durable=copy(model.state),writes=0,backups=0,locks=0,releaseLock;
 const events=[],messages=[],diagnostics=[];
 const held=options.holdLock?new Promise(resolve=>{releaseLock=resolve;}):null;
 const ui={editDialog:{open:true,close:()=>{ui.editDialog.open=false;events.push("dialog-close");}}};
 const cx={
  model,ui,VERSION:"synthetic-current",STATE_PATH:["data","state.json"],RECOVERY_PATH:["data","recovery.json"],
  CLOSED_RO_RETENTION_DAYS:90,supervisorWorkbookOperationTail:Promise.resolve(),
  navigator:{locks:{request:async(name,opts,run)=>{
    assert.equal(name,"moondog-supervisor-workbook");
    assert.equal(opts.mode,"exclusive");locks++;
    if(held)await held;
    return run();
  }}},
  folderWatch:{busy:false},dailyImportBusy:false,appointmentImportBusy:false,
  workspaceConnectionBusy:false,postConnectionScanBusy:false,
  connectedNativeRoot:{name:"Synthetic Root"},editDraftDirty:true,
  transientWorkspaceState:e=>e?.name==="NotReadableError",
  scheduleAuthorityRevalidation:()=>events.push("revalidation-requested"),
  writeAuthority:{requireWrite:()=>{if(options.permissionDenied)throw Object.assign(Error("Permission denied"),{name:"NotAllowedError"});}},
  readJson:async(p)=>p===cx.STATE_PATH?copy(durable):null,
  now:()=>"2026-10-30T12:25:00.000Z",
  structuredClone:globalThis.structuredClone,
  pruneClosedRecords:arr=>arr,
  recordDiagnostic:(kind,msg)=>diagnostics.push({kind,msg}),
  backupState:async(_why,prior)=>{backups++;events.push("backup");assert.equal(prior.records.length,2);if(options.failBackup)throw Error("Backup failed");},
  writeJson:async(path,next)=>{
   assert.equal(path,cx.STATE_PATH);writes++;events.push("state-write");
   if(options.failWrite)throw Error("Synthetic durable write failed");
   durable=copy(next);
   if(options.failReadback)throw Error("Synthetic read-back failure");
  },
  addHistory:async()=>{events.push("history");if(options.failHistory)throw Error("Synthetic history failure");},
  openRoWorkloadSnapshot:()=>({sourceType:"open-ro"}),
  saveOpenRoWorkload:async()=>{events.push("workload");if(options.failWorkload)throw Error("Synthetic workload failure");},
  ensureDailyFocus:async()=>{
   events.push("focus");
   if(options.failFocus){model.state.updatedAt="unverified-focus";throw Error("Synthetic focus history failed");}
  },
  markSupervisorWorkbookStale:async()=>{events.push("workbook");if(options.failWorkbook)throw Object.assign(Error("Synthetic OneDrive lock"),{name:"NotReadableError"});},
  renderAll:()=>events.push("render"),
  status:(message,type)=>messages.push({message,type})
 };
 vm.runInNewContext(source+"\nthis.closeRo=closeRo;",cx);
 return{cx,model,ui,events,messages,diagnostics,get writes(){return writes;},
  get backups(){return backups;},get locks(){return locks;},
  get durable(){return copy(durable);},changeDurable:v=>{durable=copy(v);},releaseLock:()=>releaseLock?.()};
}
test("manual close uses browser-wide lock and publishes state only after verified write",async()=>{
 const f=fixture();
 assert.equal(await f.cx.closeRo("synthetic-ro-1"),true);
 assert.equal(f.locks,1);assert.equal(f.backups,1);assert.equal(f.writes,1);
 assert.deepEqual(f.events,["backup","state-write","history","workload","focus","workbook","render","dialog-close"]);
 assert.equal(f.model.state.records.length,1);assert.equal(f.durable.records.length,1);
 assert.equal(f.model.state.closedRecords[0].management.note,"Preserve manual edit");
 assert.equal(f.durable.closedRecords[0].closedReason,"manual-manager-close");
 assert.equal(f.model.openRoSaveInFlight,false);assert.equal(f.cx.dailyImportBusy,false);
 assert.equal(f.messages.at(-1).type,"success");
 assert.match(f.messages.at(-1).message,/read-back verified/);
 const writes=f.writes;
 assert.equal(await f.cx.closeRo("synthetic-ro-1"),false,"retry cannot reclose an already-closed RO");
 assert.equal(f.writes,writes,"no duplicate durable events on retry");
});
test("failed or unauthorized pre-commit close leaves memory, durable state and draft untouched",async()=>{
 for(const options of [{failWrite:true},{failBackup:true},{permissionDenied:true}]){
  const f=fixture(options),before=copy(f.model.state);
  assert.equal(await f.cx.closeRo("synthetic-ro-1"),false);
  assert.deepEqual(f.model.state,before);assert.deepEqual(f.durable,before);
  assert.equal(f.ui.editDialog.open,true);assert.equal(f.cx.editDraftDirty,true);
  assert.equal(f.cx.dailyImportBusy,false);assert.equal(f.model.openRoSaveInFlight,false);
  assert.equal(f.messages.at(-1).type,"error");
  assert.match(f.messages.at(-1).message,/could not be verified/);
 }
});
test("secondary follow-up failures cannot roll back verified RO close",async()=>{
 const f=fixture({failHistory:true,failWorkload:true,failFocus:true,failWorkbook:true});
 assert.equal(await f.cx.closeRo("synthetic-ro-1"),true);
 assert.equal(f.model.state.records.length,1);assert.equal(f.durable.records.length,1);
 assert.equal(f.model.state.closedRecords.length,1);assert.equal(f.durable.closedRecords.length,1);
 assert.equal(f.model.state.updatedAt,f.durable.updatedAt,"a failed Focus follow-up must resync verified durable state");
 assert.equal(f.messages.at(-1).type,"error");
 assert.match(f.messages.at(-1).message,/history could not be verified/i);
 assert.match(f.messages.at(-1).message,/Do not import the previous workbook/i);
 assert.equal(f.diagnostics.filter(x=>/RO CLOSE/.test(x.kind)).length,4);
 assert.equal(f.ui.editDialog.open,false,"verified close remains closed despite warnings");
});
test("cross-tab durable conflict fails closed before backups or state writes",async()=>{
 const f=fixture(),external=f.durable;
 external.updatedAt="external-write";external.records[0].management.note="Concurrent manager edit";
 f.changeDurable(external);
 assert.equal(await f.cx.closeRo("synthetic-ro-1"),false);
 assert.equal(f.writes,0);assert.equal(f.backups,0);assert.equal(f.locks,1);
 assert.equal(f.model.state.records.length,2);assert.equal(f.ui.editDialog.open,true);
 assert.match(f.messages.at(-1).message,/refresh the Workspace/i);
});
test("in-flight close blocks second close and concurrent import, and holds lock until released",async()=>{
 const f=fixture({holdLock:true});
 const first=f.cx.closeRo("synthetic-ro-1");
 assert.equal(f.cx.dailyImportBusy,true);
 assert.equal(f.model.openRoSaveInFlight,true);
 assert.equal(await f.cx.closeRo("synthetic-ro-1"),false);
 assert.equal(f.writes,0);
 f.releaseLock();
 assert.equal(await first,true);
 assert.equal(f.model.openRoSaveInFlight,false);
 assert.equal(f.cx.dailyImportBusy,false);
 assert.equal(f.writes,1);
});
test("read-back uncertainty is explicitly unverified, never claimed rolled back",async()=>{
 const f=fixture({failReadback:true});
 assert.equal(await f.cx.closeRo("synthetic-ro-1"),false);
 assert.equal(f.model.state.records.length,2,"do not publish unverified state in memory");
 assert.equal(f.durable.records.length,1,"synthetic durable write occurred before failed readback");
 assert.match(f.messages.at(-1).message,/could not be verified/);
 assert.equal(await f.cx.closeRo("synthetic-ro-1"),false,"lock must reject stale local state on retry");
 assert.equal(f.writes,1,"retry cannot silently overwrite changed durable state");
});
