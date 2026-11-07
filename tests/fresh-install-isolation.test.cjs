"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const first=app.indexOf("  async function resetSelectedFreshInstallation(");
const last=app.indexOf("  async function prepareForNewStore(){",first);
assert.ok(first>0&&last>first,"production Fresh reset must be present");
const production=app.slice(first,last);

function missing(){return Object.assign(new Error("Not found"),{name:"NotFoundError"});}
function folder(name,parent=null){
  const children=new Map();
  const node={name,kind:"directory",parent,children,
    queryPermission:async()=> "granted",
    isSameEntry:async other=>other===node,
    resolve:async other=>{
      const parts=[];let cursor=other;
      while(cursor){if(cursor===node)return parts.reverse();parts.push(cursor.name);cursor=cursor.parent;}
      return null;
    },
    entries:async function*(){yield* children.entries();},
    getDirectoryHandle:async(name,{create=false}={})=>{
      let child=children.get(name);
      if(!child&&create){child=folder(name,node);children.set(name,child);}
      if(!child)throw missing();
      if(child.kind!=="directory")throw Error("Not a directory");
      return child;
    },
    getFileHandle:async(name,{create=false}={})=>{
      let child=children.get(name);
      if(!child&&create){child=file(name,node);children.set(name,child);}
      if(!child)throw missing();
      if(child.kind!=="file")throw Error("Not a file");
      return child;
    },
    removeEntry:async(name,{recursive=false}={})=>{
      const child=children.get(name);
      if(!child)throw missing();
      if(child.kind==="directory"&&child.children.size&&!recursive)
        throw Error("Not empty");
      children.delete(name);
    }
  };
  return node;
}
function file(name,parent){
  let bytes="";
  const node={name,parent,kind:"file",
    getFile:async()=>({text:async()=>bytes}),
    createWritable:async()=>{
      let pending="";
      return {write:async value=>{pending=String(value);},close:async()=>{bytes=pending;},
        abort:async()=>{}};
    }
  };
  return node;
}
async function put(root,relative,text){
  const parts=relative.split("/");
  let dir=root;
  for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part,{create:true});
  const writer=await(await dir.getFileHandle(parts.at(-1),{create:true})).createWritable();
  await writer.write(text);await writer.close();
}
async function get(root,relative){
  const parts=relative.split("/");
  let dir=root;
  for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part);
  return (await(await dir.getFileHandle(parts.at(-1))).getFile()).text();
}
const prefix="System Files/Workspace/";
const TEST_BACKUP="MoonDog-Update-Backup-synthetic";
const TEST_SHA="b".repeat(64);
const VERIFIED_INSTALL={status:"installed",channel:"beta",version:"0.10.18-beta.382",
  sha256:TEST_SHA,backupName:TEST_BACKUP};
async function installation(name,code){
  const root=folder(name);
  await put(root,"00 - OPEN DASHBOARD.html","synthetic-launcher");
  await put(root,"System Files/index.html","synthetic-runtime");
  await put(root,prefix+"data/settings.json",JSON.stringify({store:{name:code}}));
  await put(root,prefix+"data/current-state.json",JSON.stringify({records:[{ro:"12345",advisor:"7"}]}));
  await put(root,prefix+"backups/internal.zip","synthetic-private-backup");
  await put(root,prefix+"backups/system-updates/"+TEST_BACKUP+"/journal.json",
    JSON.stringify({status:"verified",verifiedUpdate:{
      version:VERIFIED_INSTALL.version,channel:"beta",sha256:TEST_SHA}}));
  await put(root,prefix+"data/history/previous.json","synthetic-history");
  await put(root,prefix+"Files To Learn/source.xlsx","synthetic-report");
  await put(root,prefix+"01 - DROP REPORTS HERE/new-report.csv","synthetic-source");
  return root;
}
function defaults(){
  return {
    "data/current-state.json":{records:[],closedRecords:[]},
    "data/settings.json":{schemaVersion:5,store:{name:""},setup:{completedAt:"",newStorePrepared:true}},
    "data/appointments.json":{days:{}},
    "data/advisor-performance.json":{snapshots:{}},
    "data/assign-next.json":{days:{}},
    "data/auto-import.json":{seen:{}},
    "data/operational-metrics.json":{csi:{surveys:{}}},
    "data/meeting-cycle.json":{metrics:{}}
  };
}
async function harness(){
  // Identical folder names and overlapping advisor/RO IDs are deliberate:
  // isolation is by handle identity, not labels or data identifiers.
  const storeA=await installation("MoonDog-Copy","SYNTHETIC-A");
  const storeB=await installation("MoonDog-Copy","SYNTHETIC-B");
  const sysB=await storeB.getDirectoryHandle("System Files");
  const wsB=await sysB.getDirectoryHandle("Workspace");
  const events=[];
  const confirmationPrompts=[];
  let responses=[true,true];
  const context=vm.createContext({
    confirm:prompt=>{
      confirmationPrompts.push(prompt);
      return responses.shift()===true;
    },
    connectedNativeRoot:storeB,
    FRESH_RESET_MARKER:"MOONDOG_FRESH_RESET_PENDING.json",
    model:{applicationRoot:storeB,root:wsB},
    writeAuthority:{canWrite:true,requireWrite:()=>{}},
    workspaceConnectionBusy:false,workspaceRecoveryBusy:false,newStoreBusy:false,
    workspaceConnectionBlockReason:()=>"",
    stopFolderWatch:()=>events.push("stopped-watch"),
    freshProductState:defaults,
    clearSourceAdapter:()=>events.push("cleared-adapters"),
    renderAll:()=>events.push("render"),
    renderSettings:()=>events.push("settings"),
    navigateTo:destination=>events.push("navigate:"+destination)
  });
  vm.runInContext(production,context);
  const reset=(args={})=>context.__moondogFreshInstallation.resetSelectedFreshInstallation({
    selectedRoot:storeB,expectedRoot:storeB,verifiedInstall:VERIFIED_INSTALL,...args});
  return {storeA,storeB,wsB,context,reset,events,confirmationPrompts,
    setConfirmResponses:values=>{responses=[...values];}};
}
test("Fresh deletes every synthetic store-B Workspace item, restores clean setup, preserves store A and runtime",async()=>{
  const h=await harness();
  const storeABefore=await get(h.storeA,prefix+"data/settings.json");
  const appBefore=await get(h.storeB,"System Files/index.html");
  const launcherBefore=await get(h.storeB,"00 - OPEN DASHBOARD.html");
  const steps=[];
  const result=await h.reset({onProgress:p=>steps.push(p)});
  assert.equal(result.status,"fresh");
  assert.equal(await get(h.storeA,prefix+"data/settings.json"),storeABefore);
  assert.equal(await get(h.storeA,prefix+"backups/internal.zip"),"synthetic-private-backup");
  assert.equal(await get(h.storeB,"System Files/index.html"),appBefore);
  assert.equal(await get(h.storeB,"00 - OPEN DASHBOARD.html"),launcherBefore);
  assert.deepEqual([...h.wsB.children.keys()],["data"]);
  const data=await h.wsB.getDirectoryHandle("data");
  assert.equal(data.children.size,9,"only eight clean state files plus recovery");
  assert.equal(JSON.parse(await get(h.storeB,prefix+"data/settings.json")).store.name,"");
  assert.deepEqual(JSON.parse(await get(h.storeB,prefix+"data/current-state.json")).records,[]);
  assert.equal(h.events.includes("navigate:setup"),true);
  assert.equal(steps.at(-1).percent,100);
  assert.equal(h.confirmationPrompts.length,2);
  assert.match(h.confirmationPrompts[0],/Are you sure\?/);
  assert.match(h.confirmationPrompts[1],/Are you really sure\?/);
  // Simulated browser reopen must see only the clean selected Workspace.
  const system=await h.storeB.getDirectoryHandle("System Files");
  await assert.rejects(system.getFileHandle("MOONDOG_FRESH_RESET_PENDING.json"),
    error=>error.name==="NotFoundError");
  const begin=app.indexOf("  async function operationalRoot(handle) {");
  const stop=app.indexOf("  function wrapOperationalRoot",begin);
  assert.ok(begin>0&&stop>begin);
  const reopened=vm.createContext({WORKSPACE_PREFIX:["System Files","Workspace"],
    FRESH_RESET_MARKER:"MOONDOG_FRESH_RESET_PENDING.json"});
  vm.runInContext(app.slice(begin,stop)+"\nglobalThis.open=operationalRoot;",reopened);
  assert.equal(await reopened.open(h.storeB),h.wsB);
  const freshSettings=JSON.parse(await get(h.storeB,prefix+"data/settings.json"));
  assert.equal(freshSettings.setup.newStorePrepared,true);
  assert.equal(JSON.parse(await get(h.storeB,prefix+"data/current-state.json")).appVersion,
    VERIFIED_INSTALL.version);
});
test("identical folder name does not authorize deletion of a different store",async()=>{
  const h=await harness();
  await assert.rejects(h.reset({selectedRoot:h.storeA}),/cannot verify the selected installation/);
  assert.equal(JSON.parse(await get(h.storeB,prefix+"data/settings.json")).store.name,"SYNTHETIC-B");
  assert.equal(JSON.parse(await get(h.storeA,prefix+"data/settings.json")).store.name,"SYNTHETIC-A");
});
test("missing write authority blocks Fresh before a single removal",async()=>{
  const h=await harness();
  h.context.writeAuthority.canWrite=false;
  await assert.rejects(h.reset(),/requires current write access/);
  assert.equal(await get(h.storeB,prefix+"backups/internal.zip"),"synthetic-private-backup");
});
test("nested MoonDog installation is rejected before removing data",async()=>{
  const h=await harness();
  await put(h.storeB,prefix+"copies/00 - OPEN DASHBOARD.html","second-launcher");
  await assert.rejects(h.reset(),/Another MoonDog launcher/);
  assert.equal(await get(h.storeB,prefix+"backups/internal.zip"),"synthetic-private-backup");
});
test("interrupted removal is not reported as a clean installation, and the other store survives",async()=>{
  const h=await harness();
  const normal=h.wsB.removeEntry;
  h.wsB.removeEntry=async(name,options)=>{if(name==="backups")throw Error("synthetic deletion lock");return normal(name,options);};
  await assert.rejects(h.reset(),/durable recovery hold/);
  assert.equal(await get(h.storeA,prefix+"backups/internal.zip"),"synthetic-private-backup");
  assert.equal(h.events.includes("navigate:setup"),false);
});

test("declining the first warning leaves both installations entirely untouched",async()=>{
  const h=await harness();
  h.setConfirmResponses([false,true]);
  const result=await h.reset();
  assert.equal(result.status,"cancelled");
  assert.equal(h.confirmationPrompts.length,1);
  assert.equal(await get(h.storeB,prefix+"backups/internal.zip"),"synthetic-private-backup");
  assert.equal(await get(h.storeA,prefix+"backups/internal.zip"),"synthetic-private-backup");
  assert.equal(h.events.includes("navigate:setup"),false);
});
test("declining the second warning leaves both installations entirely untouched",async()=>{
  const h=await harness();
  h.setConfirmResponses([true,false]);
  const result=await h.reset();
  assert.equal(result.status,"cancelled");
  assert.equal(h.confirmationPrompts.length,2);
  assert.equal(await get(h.storeB,prefix+"backups/internal.zip"),"synthetic-private-backup");
  assert.equal(await get(h.storeA,prefix+"backups/internal.zip"),"synthetic-private-backup");
  assert.equal(h.events.includes("navigate:setup"),false);
});

test("missing verified installer receipt rejects Fresh without deleting data",async()=>{
  const h=await harness();
  await assert.rejects(h.reset({verifiedInstall:null}),/verified Beta package receipt/);
  assert.equal(await get(h.storeB,prefix+"backups/internal.zip"),"synthetic-private-backup");
});
test("mismatched package SHA rejects Fresh before deletion",async()=>{
  const h=await harness();
  await assert.rejects(h.reset({verifiedInstall:{...VERIFIED_INSTALL,sha256:"a".repeat(64)}}),
    /matching verified Beta journal/);
  assert.equal(await get(h.storeB,prefix+"backups/internal.zip"),"synthetic-private-backup");
});
test("interrupted Fresh creates persistent hold and reconnect refuses partial copy",async()=>{
  const h=await harness(),normal=h.wsB.removeEntry;
  h.wsB.removeEntry=async(name,opts)=>{if(name==="backups")throw Error("synthetic interruption");return normal(name,opts);};
  await assert.rejects(h.reset(),/durable recovery hold/);
  assert.match(await get(h.storeB,"System Files/MOONDOG_FRESH_RESET_PENDING.json"),/"status":"incomplete"/);
  const start=app.indexOf("  async function operationalRoot(handle) {");
  const end=app.indexOf("  function wrapOperationalRoot",start);
  assert.ok(start>=0&&end>start);
  const ctx=vm.createContext({WORKSPACE_PREFIX:["System Files","Workspace"],
    FRESH_RESET_MARKER:"MOONDOG_FRESH_RESET_PENDING.json"});
  vm.runInContext(app.slice(start,end)+"\nglobalThis.reconnect=operationalRoot;",ctx);
  await assert.rejects(ctx.reconnect(h.storeB),/cleanup is incomplete/);
  assert.equal(await get(h.storeA,prefix+"backups/internal.zip"),"synthetic-private-backup");
});

test("a pre-existing interrupted-reset marker refuses a second deletion before warnings",async()=>{
  const h=await harness();
  await put(h.storeB,"System Files/MOONDOG_FRESH_RESET_PENDING.json",
    JSON.stringify({schemaVersion:1,status:"incomplete"}));
  await assert.rejects(h.reset(),/interrupted Fresh Installation hold already exists/);
  assert.equal(h.confirmationPrompts.length,0);
  assert.equal(await get(h.storeB,prefix+"backups/internal.zip"),"synthetic-private-backup");
  assert.equal(await get(h.storeA,prefix+"backups/internal.zip"),"synthetic-private-backup");
});

test("a concurrent OneDrive-like source reappearance leaves the durable hold and never claims Fresh",async()=>{
  const h=await harness();
  const original=h.wsB.getDirectoryHandle;
  let injected=false;
  h.wsB.getDirectoryHandle=async(name,opts)=>{
    const handle=await original(name,opts);
    if(name==="data" && opts?.create && !injected){
      injected=true;
      await put(h.wsB,"01 - DROP REPORTS HERE/synthetic-late-source.csv","synthetic-source");
    }
    return handle;
  };
  await assert.rejects(h.reset(),/durable recovery hold/);
  assert.equal(injected,true);
  assert.match(await get(h.storeB,"System Files/MOONDOG_FRESH_RESET_PENDING.json"),/"status":"incomplete"/);
  assert.equal(await get(h.storeA,prefix+"backups/internal.zip"),"synthetic-private-backup");
  assert.equal(h.events.includes("navigate:setup"),false);
});
test("write authority revoked mid-delete leaves the selected copy locked and other copy intact",async()=>{
  const h=await harness(),original=h.wsB.removeEntry;
  let deleted=0;
  h.wsB.removeEntry=async(name,opts)=>{
    await original(name,opts);
    deleted++;
    h.context.writeAuthority.canWrite=false;
  };
  await assert.rejects(h.reset(),/durable recovery hold/);
  assert.equal(deleted,1);
  assert.match(await get(h.storeB,"System Files/MOONDOG_FRESH_RESET_PENDING.json"),/"status":"incomplete"/);
  assert.equal(await get(h.storeA,prefix+"backups/internal.zip"),"synthetic-private-backup");
  assert.equal(h.events.includes("navigate:setup"),false);
});

function reopenForInterruptedFresh(h,answers=[true,true]){
  const prompts=[];
  const context=vm.createContext({
    WORKSPACE_PREFIX:["System Files","Workspace"],
    model:{root:null,applicationRoot:null,pendingRoot:h.storeB,freshResetRecoveryRoot:h.storeB},
    connectedNativeRoot:null,FRESH_RESET_MARKER:"MOONDOG_FRESH_RESET_PENDING.json",
    newStoreBusy:false,workspaceConnectionBusy:false,workspaceRecoveryBusy:false,
    workspaceConnectionBlockReason:()=>"",stopFolderWatch:()=>{},freshProductState:defaults,
    confirm:message=>{prompts.push(message);return answers.shift()===true;}
  });
  const start=app.indexOf("  async function operationalRoot(handle) {");
  const stop=app.indexOf("  function wrapOperationalRoot",start);
  assert.ok(start>=0&&stop>start);
  vm.runInContext(app.slice(start,stop)+
    "\nglobalThis.resume=resumeInterruptedFreshInstallation;globalThis.reopen=operationalRoot;",context);
  return {context,prompts,resume:()=>context.resume()};
}
async function interruptedCopy(){
  const h=await harness(),original=h.wsB.removeEntry;
  h.wsB.removeEntry=async(name,options)=>{
    if(name==="backups")throw Error("synthetic deletion interruption");
    return original(name,options);
  };
  await assert.rejects(h.reset(),/durable recovery hold/);
  h.wsB.removeEntry=original;
  return h;
}
test("new browser context resumes only interrupted copy B, reopens clean; copy A and runtime unchanged",async()=>{
  const h=await interruptedCopy(),before=await get(h.storeA,prefix+"data/settings.json");
  const runtime=await get(h.storeB,"System Files/index.html");
  const r=reopenForInterruptedFresh(h),result=await r.resume();
  assert.equal(result.status,"fresh");
  assert.equal(r.prompts.length,2);
  assert.equal(await get(h.storeA,prefix+"data/settings.json"),before);
  assert.equal(await get(h.storeB,"System Files/index.html"),runtime);
  assert.equal(JSON.parse(await get(h.storeB,prefix+"data/settings.json")).store.name,"");
  assert.deepEqual(JSON.parse(await get(h.storeB,prefix+"data/current-state.json")).records,[]);
  await assert.rejects(get(h.storeB,"System Files/MOONDOG_FRESH_RESET_PENDING.json"));
  assert.equal(await r.context.reopen(h.storeB),h.wsB);
  assert.equal(r.context.model.freshResetRecoveryRoot,null);
});
test("same-name wrong store is refused without any warning or writes",async()=>{
  const h=await interruptedCopy(),r=reopenForInterruptedFresh(h);
  r.context.model.pendingRoot=h.storeA;
  await assert.rejects(r.resume(),/Finish other Workspace operations/);
  assert.equal(r.prompts.length,0);
  assert.equal(await get(h.storeA,prefix+"backups/internal.zip"),"synthetic-private-backup");
  assert.match(await get(h.storeB,"System Files/MOONDOG_FRESH_RESET_PENDING.json"),/"incomplete"/);
});
test("declining either of two recovery confirmations retains hold after browser restart",async()=>{
  for(const first of [false,true]){
    const h=await interruptedCopy(),r=reopenForInterruptedFresh(h,first?[true,false]:[false,true]);
    const result=await r.resume();
    assert.equal(result.status,"cancelled");
    assert.equal(r.prompts.length,first?2:1);
    assert.match(await get(h.storeB,"System Files/MOONDOG_FRESH_RESET_PENDING.json"),/"incomplete"/);
  }
});
test("corrupted durable marker cannot authorize resumed deletion",async()=>{
  const h=await interruptedCopy();
  await put(h.storeB,"System Files/MOONDOG_FRESH_RESET_PENDING.json",
    JSON.stringify({schemaVersion:1,status:"incomplete",sha256:"invalid"}));
  const r=reopenForInterruptedFresh(h);
  await assert.rejects(r.resume(),/Invalid interrupted Fresh marker/);
  assert.equal(r.prompts.length,0);
});
test("concurrent report resurrection during resumed reset retains the marker",async()=>{
  const h=await interruptedCopy(),original=h.wsB.getDirectoryHandle;
  let injected=false;
  h.wsB.getDirectoryHandle=async(name,opts)=>{
    const directory=await original(name,opts);
    if(name==="data"&&opts?.create&&!injected){
      injected=true;
      await put(h.wsB,"01 - DROP REPORTS HERE/late.csv","synthetic");
    }
    return directory;
  };
  const r=reopenForInterruptedFresh(h);
  await assert.rejects(r.resume(),/incomplete/);
  assert.equal(injected,true);
  assert.match(await get(h.storeB,"System Files/MOONDOG_FRESH_RESET_PENDING.json"),/"incomplete"/);
  assert.equal(await get(h.storeA,prefix+"backups/internal.zip"),"synthetic-private-backup");
});
test("permission loss during resumed deletion retains hold and protects other store",async()=>{
  const h=await interruptedCopy(),original=h.wsB.removeEntry;
  h.wsB.removeEntry=async(name,opts)=>{
    await original(name,opts);
    h.storeB.queryPermission=async()=> "denied";
  };
  const r=reopenForInterruptedFresh(h);
  await assert.rejects(r.resume(),/incomplete/);
  assert.match(await get(h.storeB,"System Files/MOONDOG_FRESH_RESET_PENDING.json"),/"incomplete"/);
  assert.equal(await get(h.storeA,prefix+"backups/internal.zip"),"synthetic-private-backup");
});
