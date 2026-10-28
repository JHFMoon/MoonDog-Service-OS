"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const app=read("assets/app.js"),html=read("index.html"),guard=read("assets/moondog-write-authority.js");
const start=app.indexOf("  function writeAuthorityGuidance(");
const end=app.indexOf("  const norm = (v)",start);
assert.ok(start>0&&end>start,"Missing production connection rendering boundaries");

function page(writable,reason=writable?"READY":"PERMISSION_REQUIRED"){
  const events=new Map(),messages=[],status={textContent:""};
  const ui={
    connectButton:{textContent:"",disabled:false},
    permissionBadge:{textContent:"",className:"badge muted"},
    status
  };
  const model={root:{name:"Workspace"},pendingRoot:null,connectionState:"STARTING"};
  const authority={canWrite:writable,reason,failureName:"NotReadableError"};
  const folder={name:"Workspace"},ctx={
    model,ui,writeAuthority:authority,connectedNativeRoot:folder,authorityRevalidationExhausted:false,
    document:{body:{classList:{toggle:()=>{}}}},
    clearAuthorityRevalidation(){},scheduleAuthorityRevalidation(){},
    status:(message,type)=>messages.push({message,type}),
    globalThis:{addEventListener:(name,fn)=>events.set(name,fn)}
  };
  vm.runInNewContext(app.slice(start,end),ctx);
  return {ui,model,authority,events,messages,ctx,connect:()=>ctx.setConnectionState("CONNECTED")};
}

test("writable Workspace shows a normal connected state with no owner ceremony",()=>{
  const a=page(true);a.connect();
  assert.equal(a.ui.permissionBadge.textContent,"Connected: Workspace");
  assert.equal(a.ui.connectButton.textContent,"Change folder");
  assert.equal(a.ui.connectButton.disabled,false);
  assert.equal(a.model.pendingRoot,null);
});
test("readable-only folder is not misrepresented as writable; recovery reuses the same handle",()=>{
  const a=page(false);a.connect();
  assert.equal(a.ui.permissionBadge.textContent,"Read-only: Workspace");
  assert.equal(a.ui.connectButton.textContent,"Restore folder access");
  a.events.get("moondog-write-authority")();
  assert.equal(a.model.pendingRoot.name,"Workspace");
  a.authority.canWrite=true;a.authority.reason="READY";
  a.events.get("moondog-write-authority")();
  assert.equal(a.model.pendingRoot,null);
  assert.equal(a.ui.permissionBadge.textContent,"Connected: Workspace");
});
test("there is no misleading standalone red authority dot or fake ownership check",()=>{
  assert.doesNotMatch(html,/writeAuthorityDot|write-authority-dot/);
  assert.doesNotMatch(app,/renderWriteAuthority|authorityDot/);
  assert.match(app,/showDirectoryPicker\(\{ id: "moondog-operations", mode: "readwrite" \}\)/);
  assert.match(app,/model\.pendingRoot = handle;\s*stopFolderWatch\("Folder write permission unavailable"\)/);
});
test("browser permission and protected durable-writing rules remain enabled",()=>{
  assert.match(guard,/queryPermission\(\{ mode: "readwrite" \}\)/);
  assert.match(guard,/requestPermission\(\{ mode: "readwrite" \}\)/);
  assert.match(guard,/await recoverPending\(root, revision\)/);
  assert.match(guard,/restore-in-progress\.json/);
  assert.match(guard,/if\(!editable \|\| localRestoreOwner/);
  assert.match(guard,/current\.revision !== expected/);
  assert.match(guard,/File changed during write/);
  assert.match(guard,/journal\.revisionBefore/);
  assert.match(guard,/if \(editable === value\) return/);
  new vm.Script(guard);new vm.Script(app);
});


test("read-only reasons show the specific cause and one matching recovery action",()=>{
  const cases=[
    ["PERMISSION_REQUIRED","Restore folder access","Edge needs read/write permission"],
    ["WORKSPACE_BUSY","Retrying Workspace…","OneDrive"],
    ["PENDING_TRANSACTION","Review recovery","pending transaction"],
    ["INTERRUPTED_RESTORE","Review recovery","interrupted restore"],
    ["VALIDATION_FAILED","Recheck Workspace","NotReadableError"]
  ];
  for(const [reason,action,message] of cases){
    const a=page(false,reason);a.connect();
    assert.equal(a.ui.connectButton.textContent,action,reason);
    assert.match(a.ui.permissionBadge.title,new RegExp(message,"i"),reason);
    assert.equal(a.ui.permissionBadge.textContent,"Read-only: Workspace");
    assert.ok(a.messages.some(x=>new RegExp(message,"i").test(x.message)),reason);
  }
  const exhausted=page(false,"WORKSPACE_BUSY");exhausted.ctx.authorityRevalidationExhausted=true;exhausted.connect();
  assert.equal(exhausted.ui.connectButton.textContent,"Retry Workspace");
  assert.equal(exhausted.ui.connectButton.disabled,false);
});

test("bounded authority retries recover transient failures without an implicit permission request",async()=>{
  const start=app.indexOf("  let authorityRevalidationTimer=null");
  const end=app.indexOf("  ui.worksheetOrderSettings.addEventListener",start);
  assert.ok(start>=0&&end>start,"extract production bounded retry scheduler");
  const timers=new Map(),delays=[],listeners={window:{},document:{}};
  let next=1,calls=0,permissionRequests=0,watchRestarts=0,reason="WORKSPACE_BUSY",writable=false;
  const root={id:"saved-workspace"};
  const context={
    connectedNativeRoot:root,authorityRevalidationExhausted:false,
    writeAuthority:{get canWrite(){return writable;},get reason(){return reason;},validate:async(_root,ask)=>{assert.equal(ask,false);calls++;permissionRequests+=ask?1:0;if(calls>=3){writable=true;reason="READY";return true;}return false;}},
    setTimeout:(fn,delay)=>{const id=next++;timers.set(id,fn);delays.push(delay);return id;},
    clearTimeout:id=>timers.delete(id),
    window:{addEventListener:(name,fn)=>listeners.window[name]=fn},
    document:{addEventListener:(name,fn)=>listeners.document[name]=fn,visibilityState:"visible"},
    renderSetup(){},startFolderWatch(){watchRestarts++;},setConnectionState(){},status(){},console
  };
  vm.runInNewContext(app.slice(start,end)+"\nglobalThis.startRetry=scheduleAuthorityRevalidation;",context);
  context.startRetry(root);
  while(timers.size){const [id,fn]=timers.entries().next().value;timers.delete(id);await fn();}
  assert.equal(calls,3);
  assert.deepEqual(delays,[1200,2500,5000]);
  assert.equal(permissionRequests,0);
  assert.equal(context.authorityRevalidationExhausted,false);
  assert.equal(watchRestarts,1,"successful write recovery restarts the enabled Report Inbox watch");
});

test("automatic validation never runs through a pending transaction or interrupted restore hold",()=>{
  const start=app.indexOf("  let authorityRevalidationTimer=null");
  const end=app.indexOf("  ui.worksheetOrderSettings.addEventListener",start);
  for(const reason of ["PENDING_TRANSACTION","INTERRUPTED_RESTORE"]){
    const timers=new Map();
    const context={
      connectedNativeRoot:{},authorityRevalidationExhausted:false,
      writeAuthority:{canWrite:false,reason,validate:async()=>{throw Error("held states must not be automatically retried");}},
      setTimeout:(fn,delay)=>{timers.set(1,{fn,delay});return 1;},clearTimeout:id=>timers.delete(id),
      window:{addEventListener(){}},document:{addEventListener(){},visibilityState:"visible"},
      setConnectionState(){},status(){},renderSetup(){},console
    };
    vm.runInNewContext(app.slice(start,end)+"\nglobalThis.startRetry=scheduleAuthorityRevalidation;",context);
    context.startRetry(context.connectedNativeRoot);
    assert.equal(timers.size,0,reason);
  }
});

test("page focus immediately revalidates a restored permission without requesting it",async()=>{
  const start=app.indexOf("  let authorityRevalidationTimer=null");
  const end=app.indexOf("  ui.worksheetOrderSettings.addEventListener",start);
  const timers=new Map(),listeners={window:{},document:{}},delays=[];
  let next=1,reason="PERMISSION_REQUIRED",writable=false,calls=0;
  const root={id:"persisted-handle"};
  const context={
    connectedNativeRoot:root,authorityRevalidationExhausted:false,
    writeAuthority:{get canWrite(){return writable;},get reason(){return reason;},validate:async(_root,ask)=>{assert.equal(ask,false);calls++;writable=true;reason="READY";return true;}},
    setTimeout:(fn,delay)=>{const id=next++;timers.set(id,fn);delays.push(delay);return id;},
    clearTimeout:id=>timers.delete(id),
    window:{addEventListener:(name,fn)=>listeners.window[name]=fn},
    document:{addEventListener:(name,fn)=>listeners.document[name]=fn,visibilityState:"visible"},
    renderSetup(){},startFolderWatch(){},setConnectionState(){},status(){},console
  };
  vm.runInNewContext(app.slice(start,end)+"\nglobalThis.startRetry=scheduleAuthorityRevalidation;",context);
  context.startRetry(root);
  listeners.window.focus();
  assert.deepEqual(delays,[1200,0],"focus replaces the remaining backoff with an immediate query");
  const [id,fn]=timers.entries().next().value;timers.delete(id);await fn();
  assert.equal(calls,1);
  assert.equal(timers.size,0);
  assert.equal(writable,true);
});

test("refresh and browser restart reuse the saved handle and query permission without prompting",async()=>{
  const start=app.indexOf("  async function restoreConnection() {");
  const end=app.indexOf("  function headerMap(",start);
  assert.ok(start>=0&&end>start,"extract production saved-handle restoration");
  const handle={kind:"directory",name:"Synthetic Workspace",queryPermission:async()=>"granted"};
  let used=null,ask=null,queries=0,requestCalls=0;
  const context={
    window:{showDirectoryPicker(){throw Error("restoring a saved handle must not open a picker");},indexedDB:{}},
    indexedDB:{},model:{pendingRoot:null},ui:{homeConnect:{textContent:""}},
    recallRoot:async()=>handle,
    permission:async(received,request)=>{assert.equal(received,handle);queries++;if(request)requestCalls++;return "granted";},
    finishConnection:async(received,request)=>{used=received;ask=request;context.model.pendingRoot=null;},
    setConnectionState(){},recordDiagnostic:async()=>{},stopFolderWatch(){},
    writeAuthority:{disable(){}},transientWorkspaceState:()=>false,console
  };
  vm.runInNewContext(app.slice(start,end)+"\nglobalThis.restore=restoreConnection;",context);
  await context.restore();
  assert.equal(used,handle);
  assert.equal(ask,false);
  assert.equal(queries,1);
  assert.equal(requestCalls,0);
  assert.equal(context.model.pendingRoot,null);
});


test("production connection keeps the saved handle when a transient snapshot read interrupts reconnect",async()=>{
  const start=app.indexOf("  async function completeWorkspaceConnection(handle, ask) {");
  const end=app.indexOf("  async function postConnectReconciliation(",start);
  assert.ok(start>=0&&end>start,"extract the production Workspace connection path");
  const handle={kind:"directory",name:"Synthetic Workspace"};
  let reads=0;
  const context={
    model:{pendingRoot:handle,root:null,applicationRoot:null,state:{},appointments:{},performance:{},operationalMetrics:{},meetingCycle:{},assignNext:{},autoImport:{},recovery:{}},
    workspaceConnectionBlockReason:()=>"",
    permission:async(received,ask)=>{assert.equal(received,handle);assert.equal(ask,false);return "granted";},
    writeAuthority:{canWrite:true,validate:async()=>{}},
    wrapOperationalRoot:value=>value,operationalRoot:async value=>value,
    document:{dispatchEvent(){}},Event,
    readJson:async(_path,fallback)=>{reads++;if(reads===1)return {};if(reads===2)return null;throw Object.assign(Error("synthetic OneDrive lock"),{name:"NotReadableError"});},
    SETTINGS_PATH:"data/settings.json",SOURCE_ADAPTER_BOOTSTRAP_PATH:"data/source-adapter.json",
    STATE_PATH:"data/state.json",APPOINTMENTS_PATH:"data/appointments.json",
    PERFORMANCE_PATH:"data/performance.json",OPERATIONAL_METRICS_PATH:"data/metrics.json",
    MEETING_CYCLE_PATH:"data/meeting.json",ASSIGN_NEXT_PATH:"data/assign-next.json",
    AUTO_IMPORT_PATH:"data/auto-import.json",RECOVERY_PATH:"data/recovery.json",
    rememberRoot:async()=>{},initializeFolders:async()=>{},recordDiagnostic:async()=>{},
    VERSION:"synthetic",console
  };
  vm.runInNewContext("let connectedNativeRoot=null;"+app.slice(start,end)+"\nglobalThis.connect=completeWorkspaceConnection;",context);
  await assert.rejects(context.connect(handle,false),/synthetic OneDrive lock/);
  assert.equal(reads>=3,true,"the interruption occurs while reading authoritative connection snapshots");
  assert.equal(context.model.pendingRoot,handle,
    "the exact saved folder handle must remain available for the bounded automatic retry");
});

test("explicit Retry saved folder schedules bounded recovery after a transient OneDrive failure",async()=>{
  const start=app.indexOf("  async function connect() {");
  const end=app.indexOf("  let savedConnectionRetryTimer=null",start);
  assert.ok(start>=0&&end>start,"extract production explicit saved-folder retry");
  const handle={kind:"directory",name:"Synthetic Workspace"},stagedRoot={kind:"synthetic-staged-root"};
  const model={pendingRoot:handle,root:stagedRoot,applicationRoot:handle,workspaceConnectionCommittedRoot:null};
  let retries=0,scheduled=null,permissionPrompts=0,writeEnabled=true,cleared=[];
  const context={
    __moondogDailyUI:{confirmWorkspaceChange:()=>true},
    model,connectedNativeRoot:handle,
    window:{showDirectoryPicker(){permissionPrompts++;throw Error("saved-handle retry must not open a new folder picker");}},
    writeAuthority:{disable(){writeEnabled=false;}},
    finishConnection:async(received,ask)=>{assert.equal(received,handle);assert.equal(ask,true);throw Object.assign(Error("synthetic OneDrive busy"),{name:"NotReadableError"});},
    transientWorkspaceState:error=>error?.name==="NotReadableError",
    scheduleSavedConnectionRetry:received=>{retries++;scheduled=received;},
    setConnectionState(){},clearTimeout:id=>cleared.push(id),
    console
  };
  vm.runInNewContext("let savedConnectionRetryTimer=41,savedConnectionRetryAttempts=5;"+app.slice(start,end)+"\\nglobalThis.connectNow=connect;",context);
  await assert.rejects(context.connectNow(),/synthetic OneDrive busy/);
  assert.deepEqual(cleared,[41],"explicit retry cancels the prior timer before starting a fresh bounded window");
  assert.equal(retries,1);
  assert.equal(scheduled,handle);
  assert.equal(permissionPrompts,0);
  assert.equal(writeEnabled,false);
  assert.equal(model.root,null,"the failed staged root is discarded from memory only");
  assert.equal(model.pendingRoot,handle,"the selected Workspace handle remains available for automatic retry");
});

test("non-transient saved reconnect failure revokes staged write authority and retains the folder handle",async()=>{
  const start=app.indexOf("  let savedConnectionRetryTimer=null");
  const end=app.indexOf("  async function restoreConnection()",start);
  assert.ok(start>=0&&end>start,"extract the production saved-folder retry loop");
  const handle={kind:"directory",name:"Synthetic Workspace"},stagedRoot={kind:"synthetic-uncommitted-root"};
  const model={pendingRoot:handle,root:stagedRoot,applicationRoot:handle,workspaceConnectionCommittedRoot:null};
  let next=1,writeEnabled=true,disabled=0,stopped=0;
  const timers=new Map(),messages=[];
  const context={
    model,connectedNativeRoot:handle,authorityRevalidationExhausted:false,
    writeAuthority:{reason:"READY",disable(){writeEnabled=false;disabled++;}},
    setTimeout:(fn,delay)=>{const id=next++;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
    finishConnection:async()=>{throw Error("synthetic malformed snapshot");},
    transientWorkspaceState:()=>false,stopFolderWatch(){stopped++;},
    setConnectionState:(state,message)=>messages.push({state,message}),
    navigateTo(){},run:async()=>{},connect:async()=>{},console
  };
  vm.runInNewContext(app.slice(start,end)+"\nglobalThis.retry=scheduleSavedConnectionRetry;",context);
  context.retry(handle);
  const [id,fn]=timers.entries().next().value;timers.delete(id);await fn();
  assert.equal(disabled,1);
  assert.equal(writeEnabled,false);
  assert.equal(stopped,1);
  assert.equal(model.root,null,"uncommitted staged root is removed from the in-memory model");
  assert.equal(model.applicationRoot,null);
  assert.equal(context.connectedNativeRoot,null);
  assert.equal(model.pendingRoot,handle,"the original handle remains available for a clean retry");
  assert.equal(messages.at(-1).state,"CONNECTION ERROR");
});

test("saved-folder reconnection retries transient OneDrive failures with the same handle and no prompt",async()=>{
  const start=app.indexOf("  let savedConnectionRetryTimer=null");
  const end=app.indexOf("  async function restoreConnection()",start);
  assert.ok(start>=0&&end>start,"extract production saved-folder retry loop");
  const handle={kind:"directory",name:"Synthetic Workspace"},workspaceBytes=new Uint8Array([3,1,4,1,5]),markerBytes=new Uint8Array([9,2,6]);
  const originalWorkspace=workspaceBytes.slice(),originalMarker=markerBytes.slice();
  const timers=new Map(),delays=[],connectionErrors=[];
  let next=1,attempts=0,permissionRequests=0;
  const model={pendingRoot:handle,root:null,workspaceConnectionCommittedRoot:null};
  const context={
    model,ui:{backupRecoverySection:{scrollIntoView(){}}},
    writeAuthority:{reason:"WORKSPACE_BUSY",disable(){}},
    stopFolderWatch(){},
    setTimeout:(fn,delay)=>{const id=next++;timers.set(id,fn);delays.push(delay);return id;},
    clearTimeout:id=>timers.delete(id),
    finishConnection:async(received,ask)=>{assert.equal(received,handle);assert.equal(ask,false);if(++attempts<3){model.pendingRoot=null;throw Object.assign(Error("synthetic OneDrive lock"),{name:"NotReadableError"});}model.pendingRoot=null;},
    transientWorkspaceState:error=>error?.name==="NotReadableError",
    setConnectionState:(state,message)=>connectionErrors.push({state,message}),
    navigateTo(){},run:async()=>{},connect:async()=>{permissionRequests++;},console
  };
  vm.runInNewContext(app.slice(start,end)+"\nglobalThis.retry=scheduleSavedConnectionRetry;",context);
  context.retry(handle);
  while(timers.size){const [id,fn]=timers.entries().next().value;timers.delete(id);await fn();}
  assert.equal(attempts,3);
  assert.deepEqual(delays,[1200,3000,8000]);
  assert.equal(permissionRequests,0);
  assert.deepEqual([...workspaceBytes],[...originalWorkspace]);
  assert.deepEqual([...markerBytes],[...originalMarker]);
  assert.equal(model.pendingRoot,null);
});

test("failed non-transient reconnect revokes write access, stops Report Inbox Watch, and retains the saved handle",async()=>{
  const start=app.indexOf("  let savedConnectionRetryTimer=null");
  const end=app.indexOf("  async function restoreConnection()",start);
  const handle={kind:"directory",name:"Synthetic Workspace"};
  const stagedRoot={name:"Uncommitted Workspace"},actions=[],timers=new Map();
  let authorityWritable=true;
  const model={pendingRoot:handle,root:stagedRoot,applicationRoot:handle,workspaceConnectionCommittedRoot:null};
  const context={
    model,ui:{backupRecoverySection:{scrollIntoView(){}}},
    writeAuthority:{reason:"READY",get canWrite(){return authorityWritable;},disable(){authorityWritable=false;actions.push("disabled");}},
    stopFolderWatch:reason=>actions.push("watch stopped: "+reason),
    setTimeout:(fn,delay)=>{timers.set(delay,fn);return delay;},
    clearTimeout:id=>timers.delete(id),
    finishConnection:async(received,ask)=>{
      assert.equal(received,handle);
      assert.equal(ask,false);
      // A successful initial permission check can clear the pending handle
      // and enable editing before the authoritative snapshot read fails.
      model.pendingRoot=null;
      throw Error("Synthetic malformed settings JSON");
    },
    transientWorkspaceState:()=>false,
    setConnectionState:(state,message)=>actions.push(state+": "+message),
    navigateTo(){},run:async()=>{},connect:async()=>{},console
  };
  vm.runInNewContext(app.slice(start,end)+"\nglobalThis.retry=scheduleSavedConnectionRetry;",context);
  context.retry(handle);
  await timers.get(1200)();
  assert.equal(authorityWritable,false,"a failed reconnect cannot leave editing enabled");
  assert.equal(model.pendingRoot,handle,"the saved handle remains available for explicit recovery");
  assert.equal(model.root,null,"staged, uncommitted Workspace must not stay active");
  assert.equal(model.applicationRoot,null);
  assert.ok(actions.some(item=>item.startsWith("watch stopped:")),"Report Inbox Watch must not write");
  assert.match(actions.at(-1),/Saved folder reconnect stopped/);
  assert.equal(timers.size,1,"a permanent error must not schedule another retry");
});

test("a recovered read-only Workspace restarts Report Inbox Watch after durable validation",async()=>{
  const start=app.indexOf("  let authorityRevalidationTimer=null");
  const end=app.indexOf('  window.addEventListener("focus"',start);
  assert.ok(start>0&&end>start,"production read-only revalidation scheduler must be present");
  const root={name:"Synthetic Workspace"},timers=new Map(),events=[];
  let next=0,canWrite=false;
  const context={
    connectedNativeRoot:root,
    writeAuthority:{get canWrite(){return canWrite;},reason:"WORKSPACE_BUSY",
      validate:async(received,ask)=>{assert.equal(received,root);assert.equal(ask,false);canWrite=true;return true;}},
    setTimeout:(fn,delay)=>{const id=++next;timers.set(id,{fn,delay});return id;},
    clearTimeout:id=>timers.delete(id),
    renderSetup(){},startFolderWatch(){events.push("watch started");},
    setConnectionState:state=>events.push("state: "+state),
    status:message=>events.push("status: "+message)
  };
  vm.runInNewContext(app.slice(start,end)+"\nglobalThis.retry=scheduleAuthorityRevalidation;",context);
  context.retry(root);
  assert.equal(timers.size,1);
  const [id,timer]=timers.entries().next().value;timers.delete(id);
  await timer.fn();
  assert.ok(events.includes("watch started"),"read-only startup must resume Report Inbox Watch after recovery");
  assert.ok(events.includes("state: CONNECTED"));
  assert.equal(canWrite,true);
  assert.equal(timers.size,0);
});

test("saved-folder retries are bounded and preserve the handle after persistent transient errors",async()=>{
  const start=app.indexOf("  let savedConnectionRetryTimer=null");
  const end=app.indexOf("  async function restoreConnection()",start);
  const handle={kind:"directory",name:"Synthetic Workspace"},timers=new Map(),delays=[],messages=[];
  let next=1,attempts=0;
  const model={pendingRoot:handle,root:null,workspaceConnectionCommittedRoot:null};
  const context={
    model,ui:{backupRecoverySection:{scrollIntoView(){}}},
    writeAuthority:{reason:"WORKSPACE_BUSY",disable(){}},
    stopFolderWatch(){} ,
    setTimeout:(fn,delay)=>{const id=next++;timers.set(id,fn);delays.push(delay);return id;},
    clearTimeout:id=>timers.delete(id),
    finishConnection:async(received,ask)=>{assert.equal(received,handle);assert.equal(ask,false);attempts++;throw Object.assign(Error("synthetic OneDrive lock"),{name:"NotReadableError"});},
    transientWorkspaceState:error=>error?.name==="NotReadableError",
    setConnectionState:(state,message)=>messages.push({state,message}),
    navigateTo(){},run:async()=>{},connect:async()=>{},console
  };
  vm.runInNewContext(app.slice(start,end)+"\nglobalThis.retry=scheduleSavedConnectionRetry;",context);
  context.retry(handle);
  while(timers.size){const [id,fn]=timers.entries().next().value;timers.delete(id);await fn();}
  assert.equal(attempts,5);
  assert.deepEqual(delays,[1200,3000,8000,15000,30000]);
  assert.equal(model.pendingRoot,handle,"saved folder handle stays available for explicit retry");
  assert.match(messages.at(-1).message,/checks ended.*saved folder and files remain intact/i);
});

test("explicit Restore editing resets exhausted OneDrive retry budget and reuses the saved handle",async()=>{
  const start=app.indexOf("  async function connect() {");
  const end=app.indexOf("  let savedConnectionRetryTimer=null",start);
  assert.ok(start>=0&&end>start,"extract production explicit saved-handle connection");
  const handle={kind:"directory",name:"Synthetic Workspace"};
  const cancelled=[];
  let connected=0,pickers=0;
  const context={
    model:{pendingRoot:handle},
    __moondogDailyUI:{confirmWorkspaceChange:()=>true},
    window:{showDirectoryPicker:()=>{pickers++;throw Error("Must reuse the retained handle");}},
    clearTimeout:id=>cancelled.push(id),
    setConnectionState:()=>{},
    finishConnection:async(root,ask)=>{assert.equal(root,handle);assert.equal(ask,true);connected++;},
    writeAuthority:{disable:()=>{throw Error("No write revocation on successful retry");}},
    console
  };
  vm.runInNewContext("let savedConnectionRetryTimer=17,savedConnectionRetryAttempts=5;"+
    app.slice(start,end)+
    "\nglobalThis.retrySaved=connect;globalThis.retryState=()=>({timer:savedConnectionRetryTimer,attempts:savedConnectionRetryAttempts});",context);
  await context.retrySaved();
  assert.equal(connected,1);
  assert.equal(pickers,0,"restoration must not select another folder");
  assert.deepEqual(cancelled,[17],"stale automatic reconnect is cancelled");
  assert.deepEqual({...context.retryState()},{timer:null,attempts:0},
    "manual recovery opens a fresh bounded retry budget");
});
