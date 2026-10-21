"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const app=read("assets/app.js"),html=read("index.html"),guard=read("assets/moondog-write-authority.js");
const start=app.indexOf("  function setConnectionState(");
const end=app.indexOf("  const norm = (v)",start);
assert.ok(start>0&&end>start,"Missing production connection rendering boundaries");

function page(writable){
  const events=new Map(),messages=[],status={textContent:""};
  const ui={
    connectButton:{textContent:"",disabled:false},
    permissionBadge:{textContent:"",className:"badge muted"},
    status
  };
  const model={root:{name:"Workspace"},pendingRoot:null,connectionState:"STARTING"};
  const authority={canWrite:writable};
  const folder={name:"Workspace"},ctx={
    model,ui,writeAuthority:authority,connectedNativeRoot:folder,
    document:{body:{classList:{toggle:()=>{}}}},
    status:(message,type)=>messages.push({message,type}),
    globalThis:{addEventListener:(name,fn)=>events.set(name,fn)}
  };
  vm.runInNewContext(app.slice(start,end),ctx);
  return {ui,model,authority,events,messages,connect:()=>ctx.setConnectionState("CONNECTED")};
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
  assert.equal(a.ui.connectButton.textContent,"Restore editing");
  a.events.get("moondog-write-authority")();
  assert.equal(a.model.pendingRoot.name,"Workspace");
  a.authority.canWrite=true;
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
  assert.match(guard,/revision\.revision !== expected/);
  assert.match(guard,/File changed during write/);
  assert.match(guard,/journal\.revisionBefore/);
  assert.match(guard,/if \(editable === value\) return/);
  new vm.Script(guard);new vm.Script(app);
});
