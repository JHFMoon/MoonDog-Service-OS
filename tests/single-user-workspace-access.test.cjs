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

test("workspace validation retries stop on a durable transaction or restore hold",async()=>{
  for(const hold of ["PENDING_TRANSACTION","INTERRUPTED_RESTORE"]){
    const start=app.indexOf("  let authorityRevalidationTimer=null");
    const end=app.indexOf("  ui.worksheetOrderSettings.addEventListener",start);
    const timers=new Map();let next=1,calls=0,reason=hold;
    const root={};const context={
      connectedNativeRoot:root,authorityRevalidationExhausted:false,
      writeAuthority:{canWrite:false,get reason(){return reason;},validate:async()=>{calls++;return false;}},
      setTimeout:(fn,delay)=>{const id=next++;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
      window:{addEventListener(){}},document:{addEventListener(){},visibilityState:"visible"},
      renderSetup(){},setConnectionState(){},status(){},console
    };
    vm.runInNewContext(app.slice(start,end)+"\nglobalThis.startRetry=scheduleAuthorityRevalidation;",context);
    context.startRetry(root);
    const [id,fn]=timers.entries().next().value;timers.delete(id);await fn();
    assert.equal(calls,1,hold);
    assert.equal(timers.size,0,hold);
  }
});
