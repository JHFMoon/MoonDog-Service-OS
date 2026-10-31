"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const source=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function part(start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"production boundary: "+start);
  return source.slice(a,b);
}
// Execute the genuine connection eligibility gates up to the irreversible
// model.root replacement, without loading a real Workspace or customer data.
const gate=part("  let workspaceConnectionBusy=false;","  async function finishConnection(");
const finish=part("  async function finishConnection(","  async function completeWorkspaceConnection(");
const writable=part("  async function completeWorkspaceConnection(","    const previousRoot = model.root, previousNativeRoot = connectedNativeRoot;")+
  "    return 'authorized writable connection';\n  }\n";
const readonly=part("  async function finishReadOnlyConnection(","    const previousRoot = model.root, previousNativeRoot = connectedNativeRoot;")+
  "    return 'authorized read-only connection';\n  }\n";
const supervisor=part("  let supervisorWorkbookOperationTail = Promise.resolve();","  const dailyPickedSources = new Map();");
assert.match(writable,/beforeCommitBlock=workspaceConnectionBlockReason\(\)/);
assert.match(readonly,/beforeCommitBlock=workspaceConnectionBlockReason\(\)/);
assert.match(supervisor,/supervisorWorkbookInFlight\+\+/);

function deferred(){
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {promise,resolve};
}
function harness(){
  const rootA={id:"Workspace A"},rootB={id:"Workspace B"};
  const model={root:rootA,pendingRoot:null,state:{updatedAt:"committed",records:[]},recovery:{}};
  const config={validate:async()=>{},permission:async()=>"granted",operationalRoot:async handle=>handle,canWrite:true};
  const ctx=vm.createContext({
    model,folderWatch:{busy:false},dailyImportBusy:false,appointmentImportBusy:false,
    writeAuthority:{
      get canWrite(){return config.canWrite;},
      validate:async(...args)=>config.validate(...args)
    },
    permission:async(...args)=>config.permission(...args),
    operationalRoot:async(...args)=>config.operationalRoot(...args),
    STATE_PATH:["state"],RECOVERY_PATH:["recovery"],
    readJson:async p=>p[0]==="state"?{updatedAt:"committed",records:[]}:null,
    navigator:{locks:{request:async(_name,_options,operation)=>operation()}},
    Promise,Error
  });
  vm.runInContext(gate+finish+writable+readonly+supervisor+
    "\nthis.connect=handle=>finishConnection(handle,false);"+
    "\nthis.withWorkbookLock=withSupervisorWorkbookLock;"+
    "\nthis.pendingWorkbookCount=()=>supervisorWorkbookInFlight;",ctx);
  return {ctx,model,rootA,rootB,config};
}

test("active and queued workbook operations reject reconnect before changing Workspace",async()=>{
  const h=harness(),started=deferred(),hold=deferred();
  const first=h.ctx.withWorkbookLock(async()=>{started.resolve();await hold.promise;return "saved";});
  await started.promise;
  const second=h.ctx.withWorkbookLock(async()=> "next saved");
  assert.equal(h.ctx.pendingWorkbookCount(),2,"queued work must also hold source authority");
  await assert.rejects(h.ctx.connect(h.rootB),error=>error?.code==="WORKSPACE_CONNECTION_BUSY");
  assert.equal(h.model.root,h.rootA);
  hold.resolve();
  assert.equal(await first,"saved");
  assert.equal(await second,"next saved");
  assert.equal(h.ctx.pendingWorkbookCount(),0);
  assert.equal(await h.ctx.connect(h.rootB),"authorized writable connection");
});

test("a workbook cannot start while permission validation is already in progress",async()=>{
  const h=harness(),permissionStarted=deferred(),permissionHold=deferred();
  h.config.permission=async()=>{permissionStarted.resolve();await permissionHold.promise;return "granted";};
  const connecting=h.ctx.connect(h.rootB);
  await permissionStarted.promise;
  let mutated=false;
  await assert.rejects(h.ctx.withWorkbookLock(async()=>{mutated=true;}),/Workspace connection is in progress/);
  assert.equal(mutated,false,"no workbook mutation can begin under a pending reconnect");
  assert.equal(h.ctx.pendingWorkbookCount(),0);
  permissionHold.resolve();
  assert.equal(await connecting,"authorized writable connection");
});

test("a picked import becoming busy during permission stops validation before authority changes",async()=>{
  const h=harness(),permissionStarted=deferred(),permissionHold=deferred();
  let validationCalls=0;
  h.config.permission=async()=>{permissionStarted.resolve();await permissionHold.promise;return "granted";};
  h.config.validate=async()=>{validationCalls++;};
  const connecting=h.ctx.connect(h.rootB);
  await permissionStarted.promise;
  h.ctx.dailyImportBusy=true;
  permissionHold.resolve();
  await assert.rejects(connecting,error=>error?.code==="WORKSPACE_CONNECTION_BUSY");
  assert.equal(validationCalls,0,"do not change write authority after a picked import starts");
  assert.equal(h.model.root,h.rootA);
  h.ctx.dailyImportBusy=false;
});

test("writable and read-only directory awaits refuse a competing import before root replacement",async()=>{
  for(const canWrite of [true,false]){
    const h=harness(),rootStarted=deferred(),rootHold=deferred();
    h.config.canWrite=canWrite;
    h.config.operationalRoot=async handle=>{rootStarted.resolve();await rootHold.promise;return handle;};
    const connecting=h.ctx.connect(h.rootB);
    await rootStarted.promise;
    h.ctx.dailyImportBusy=true;
    rootHold.resolve();
    await assert.rejects(connecting,error=>error?.code==="WORKSPACE_CONNECTION_BUSY");
    assert.equal(h.model.root,h.rootA,"no Workspace switch, including read-only case");
    h.ctx.dailyImportBusy=false;
  }
});

test("failed and stale queued workbook operations release the reconnect exclusion",async()=>{
  const h=harness();
  await assert.rejects(h.ctx.withWorkbookLock(async()=>{throw Error("synthetic failed save");}),/failed save/);
  assert.equal(h.ctx.pendingWorkbookCount(),0);
  const blocked=deferred(),begun=deferred();
  const first=h.ctx.withWorkbookLock(async()=>{begun.resolve();await blocked.promise;});
  await begun.promise;
  const queued=h.ctx.withWorkbookLock(async()=>{throw Error("queued operation must not run");});
  // Simulate an external root replacement to verify the lock itself fails closed,
  // even if a future connection path bypasses the normal eligibility gate.
  h.model.root=h.rootB;
  blocked.resolve();
  await first;
  await assert.rejects(queued,/Workspace changed while the Supervisor Workbook operation was queued/);
  assert.equal(h.ctx.pendingWorkbookCount(),0);
});
