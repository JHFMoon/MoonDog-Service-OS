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
async function installation(name,code){
  const root=folder(name);
  await put(root,"00 - OPEN DASHBOARD.html","synthetic-launcher");
  await put(root,"System Files/index.html","synthetic-runtime");
  await put(root,prefix+"data/settings.json",JSON.stringify({store:{name:code}}));
  await put(root,prefix+"data/current-state.json",JSON.stringify({records:[{ro:"12345",advisor:"7"}]}));
  await put(root,prefix+"backups/internal.zip","synthetic-private-backup");
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
    selectedRoot:storeB,expectedRoot:storeB,...args});
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
  await assert.rejects(h.reset(),/partially cleared/);
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
