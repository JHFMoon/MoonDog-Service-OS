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
  let next=1,calls=0,permissionRequests=0,reason="WORKSPACE_BUSY",writable=false;
  const root={id:"saved-workspace"};
  const context={
    connectedNativeRoot:root,authorityRevalidationExhausted:false,
    writeAuthority:{get canWrite(){return writable;},get reason(){return reason;},validate:async(_root,ask)=>{assert.equal(ask,false);calls++;permissionRequests+=ask?1:0;if(calls>=3){writable=true;reason="READY";return true;}return false;}},
    setTimeout:(fn,delay)=>{const id=next++;timers.set(id,fn);delays.push(delay);return id;},
    clearTimeout:id=>timers.delete(id),
    window:{addEventListener:(name,fn)=>listeners.window[name]=fn},
    document:{addEventListener:(name,fn)=>listeners.document[name]=fn,visibilityState:"visible"},
    renderSetup(){},setConnectionState(){},status(){},console
  };
  vm.runInNewContext(app.slice(start,end)+"\nglobalThis.startRetry=scheduleAuthorityRevalidation;",context);
  context.startRetry(root);
  while(timers.size){const [id,fn]=timers.entries().next().value;timers.delete(id);await fn();}
  assert.equal(calls,3);
  assert.deepEqual(delays,[1200,2500,5000]);
  assert.equal(permissionRequests,0);
  assert.equal(context.authorityRevalidationExhausted,false);
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
    renderSetup(){},setConnectionState(){},status(){},console
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
    setTimeout:(fn,delay)=>{const id=next++;timers.set(id,fn);delays.push(delay);return id;},
    clearTimeout:id=>timers.delete(id),
    finishConnection:async(received,ask)=>{assert.equal(received,handle);assert.equal(ask,false);if(++attempts<3)throw Object.assign(Error("synthetic OneDrive lock"),{name:"NotReadableError"});model.pendingRoot=null;},
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

test("saved-folder retries are bounded and preserve the handle after persistent transient errors",async()=>{
  const start=app.indexOf("  let savedConnectionRetryTimer=null");
  const end=app.indexOf("  async function restoreConnection()",start);
  const handle={kind:"directory",name:"Synthetic Workspace"},timers=new Map(),delays=[],messages=[];
  let next=1,attempts=0;
  const model={pendingRoot:handle,root:null,workspaceConnectionCommittedRoot:null};
  const context={
    model,ui:{backupRecoverySection:{scrollIntoView(){}}},
    writeAuthority:{reason:"WORKSPACE_BUSY",disable(){}},
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
  assert.match(messages.at(-1).message,/checks ended.*handle and files remain intact/i);
});
