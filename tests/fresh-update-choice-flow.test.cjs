"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source=fs.readFileSync(path.join(__dirname,"..","assets","moondog-update-settings.js"),"utf8");

function harness(installerResult={status:"installed",version:"0.10.18-beta.382",backupName:"MoonDog-Update-Backup-synthetic"},options={}) {
  const listeners=new Map(),fields=new Map(),events=[],storageWrites=[];
  let record=options.journal??null,reads=0;
  const missing=()=>Object.assign(new Error("Missing synthetic directory"),{name:"NotFoundError"});
  const journalFolder={kind:"directory",getFileHandle:async name=>{
    assert.equal(name,"journal.json");reads++;
    return {getFile:async()=>({text:async()=>JSON.stringify(record)})};
  }};
  const updateFolder={entries:async function*(){
    if(record)yield ["MoonDog-Update-Backup-synthetic",journalFolder];
  }};
  const backupFolder={getDirectoryHandle:async name=>{
    if(name!=="system-updates")throw missing();return updateFolder;
  }};
  const workspace={getDirectoryHandle:async name=>{
    if(name!=="backups")throw missing();return backupFolder;
  }};
  const system={getDirectoryHandle:async name=>{
    if(name!=="Workspace")throw missing();return workspace;
  }};
  const root={name:"Synthetic-Installation",isSameEntry:async other=>other===root,
    resolve:async()=>["System Files","Workspace"],getDirectoryHandle:async name=>{
      if(name!=="System Files")throw missing();return system;
    }};
  function field(name) {
    if(!fields.has(name))fields.set(name,{name,textContent:"",disabled:false,hidden:false,value:"",
      style:{},className:"",setAttribute(){},removeAttribute(){},
      addEventListener(type,callback){listeners.set(name+":"+type,callback);}});
    return fields.get(name);
  }
  const card={innerHTML:"",querySelector:selector=>field(selector.slice(1))};
  const context=vm.createContext({
    MoonDogInstalledVersion:options.installedVersion||"0.10.18-beta.381",
    location:options.location||{},
    __moondogSettingsModel:{applicationRoot:root},
    showDirectoryPicker:async()=>root,
    __moondogMaintenance:{runtimePaths:["assets/app.js"]},
    __moondogFreshInstallation:{resetSelectedFreshInstallation:async options=>{
      events.push(["fresh",options.selectedRoot,options.verifiedInstall.version]);return {status:"fresh"};
    }},
    MoonDogUpdateCheck:{check:async()=>options.checkResult||({status:"newer-version",version:"0.10.18-beta.382",
      channel:"beta",packageUrl:"https://example.test/beta.json",sha256:"b".repeat(64)})},
    MoonDogPackageVerification:{verify:async()=>{events.push(["verify"]);return {status:"verified",
      version:"0.10.18-beta.382",channel:"beta",sha256:"b".repeat(64),
      minimumCompatibleVersion:"0.10.9",migrationRequired:false};}},
    MoonDogPackagePlan:{dryRun:async()=>{events.push(["plan"]);return {add:[],replace:[],
      delete:[],unchanged:[],rejected:[]};}},
    MoonDogUpdateInstall:{listBackups:async()=>options.backups||[],apply:async()=>{events.push(["apply"]);return installerResult;}},
    document:{getElementById:name=>name==="view-settings"?{querySelector:()=>({append(){}})}:null,
      createElement:()=>card,querySelector:()=>null,addEventListener(){}},
    localStorage:options.storage||{getItem:()=>JSON.stringify({channel:"beta",lastCheck:"2099-01-01T00:00:00.000Z"}),setItem:key=>storageWrites.push(key)},
    confirm:()=>true,Date,setTimeout(){},requestAnimationFrame:fn=>fn()
  });
  vm.runInContext(source,context);
  return {root,events,storageWrites,field,listeners,context,
    setJournal:next=>{record=next;},journalReads:()=>reads,
    async settle(){for(let n=0;n<40;n++)await Promise.resolve();},
    async check(){await listeners.get("checkMoonDogUpdate:click")();},
    async fresh(){await listeners.get("freshMoonDogUpdate:click")();},
    async preserve(){await listeners.get("installMoonDogUpdate:click")();}};
}

test("Fresh choice is available for new Beta offer and occurs only after verified install",async()=>{
  const h=harness();await h.check();
  assert.equal(h.field("freshMoonDogUpdate").disabled,false);
  await h.fresh();
  assert.deepEqual(h.events.map(e=>e[0]),["verify","plan","apply","fresh"]);
  assert.equal(h.events.at(-1)[1],h.root);
  assert.equal(h.events.at(-1)[2],"0.10.18-beta.382");
  assert.equal(h.storageWrites.includes("moondog-verified-update-followup-v1"),false,
    "Fresh must not add a shared-origin follow-up receipt for another installation");
});
test("rolled-back update never proceeds to Fresh deletion",async()=>{
  const h=harness({status:"rolled-back",reason:"synthetic rollback"});
  await h.check();await h.fresh();
  assert.deepEqual(h.events.map(e=>e[0]),["verify","plan","apply"]);
});
test("root change after install blocks Fresh without a reset call",async()=>{
  const h=harness();await h.check();
  h.context.MoonDogUpdateInstall.apply=async()=>{
    h.events.push(["apply"]);
    h.context.__moondogSettingsModel.applicationRoot={name:"Other-Synthetic-Store"};
    return {status:"installed",version:"0.10.18-beta.382"};
  };
  await h.fresh();
  assert.deepEqual(h.events.map(e=>e[0]),["verify","plan","apply"]);
  assert.match(h.field("updateStatus").textContent,/selected installation changed/);
});

test("failed Fresh cleanup after verified install blocks further updates in this tab",async()=>{
  const h=harness();await h.check();
  h.context.__moondogFreshInstallation.resetSelectedFreshInstallation=async()=>{
    h.events.push(["fresh-failed"]);
    throw new Error("synthetic interrupted cleanup");
  };
  await h.fresh();
  assert.deepEqual(h.events.map(e=>e[0]),["verify","plan","apply","fresh-failed"]);
  assert.equal(h.field("installMoonDogUpdate").disabled,true);
  assert.equal(h.field("freshMoonDogUpdate").disabled,true);
  assert.match(h.field("updateStatus").textContent,/Fresh Installation incomplete/);
  assert.match(h.field("updateChoiceNote").textContent,/durable recovery hold/);
});

test("preserving an installation retains ordinary verified-update follow-up",async()=>{
  const h=harness();await h.check();await h.preserve();
  assert.deepEqual(h.events.map(e=>e[0]),["verify","plan","apply"]);
  assert.equal(h.storageWrites.includes("moondog-verified-update-followup-v1"),true);
});

test("wrong-folder picker selection rejects Fresh before verifying or installing",async()=>{
  const h=harness();await h.check();
  h.context.showDirectoryPicker=async()=>({name:"Unrelated-Synthetic-Copy",
    isSameEntry:async()=>false});
  await h.fresh();
  assert.deepEqual(h.events.map(e=>e[0]),[]);
  assert.match(h.field("updateStatus").textContent,/does not match the connected installation/);
});
test("Fresh picker unavailability refuses safely without running installer",async()=>{
  const h=harness();await h.check();
  h.context.showDirectoryPicker=undefined;
  await h.fresh();
  assert.deepEqual(h.events.map(e=>e[0]),[]);
  assert.match(h.field("updateStatus").textContent,/requires an Edge folder picker/);
});

test("changing the connected root during preview never mixes two installation handles",async()=>{
  const h=harness();await h.check();
  h.context.MoonDogPackagePlan.dryRun=async()=>{
    h.events.push(["plan"]);
    h.context.__moondogSettingsModel.applicationRoot={name:"Unrelated-Synthetic-Store",
      getDirectoryHandle:async()=>({})};
    return {add:[],replace:[],delete:[],unchanged:[],rejected:[]};
  };
  await h.fresh();
  assert.deepEqual(h.events.map(e=>e[0]),["verify","plan"]);
  assert.match(h.field("updateStatus").textContent,/Selected installation changed during update preview/);
});
test("preview and install always use the same selected root and runtime handle",async()=>{
  const h=harness();await h.check();
  const runtime={name:"Selected-Synthetic-System"};
  h.root.getDirectoryHandle=async(name,opts)=>{
    assert.equal(name,"System Files");
    assert.equal(opts.create,false);
    return runtime;
  };
  const previous=h.context.MoonDogPackagePlan.dryRun;
  h.context.MoonDogPackagePlan.dryRun=async options=>{
    assert.equal(options.appDirectoryHandle,runtime);
    return previous(options);
  };
  h.context.MoonDogUpdateInstall.apply=async options=>{
    assert.equal(options.appDirectoryHandle,runtime);
    assert.equal(options.workspaceDirectoryHandle,h.root);
    h.events.push(["apply"]);
    return {status:"installed",version:"0.10.18-beta.382",backupName:"MoonDog-Update-Backup-synthetic"};
  };
  await h.fresh();
  assert.deepEqual(h.events.map(e=>e[0]),["verify","plan","apply","fresh"]);
});

const VERIFIED_RELOAD_JOURNAL={status:"verified",verifiedUpdate:{
  version:"0.10.18-beta.382",channel:"beta",sha256:"b".repeat(64),
  verifiedAt:"2026-11-06T23:00:00.000Z"}};

test("legacy Beta can preserve-update, reload, then deliberately finish Fresh without another Beta",async()=>{
  // The legacy runtime cannot offer Fresh itself; it can only update normally.
  const legacy=harness(undefined,{installedVersion:"0.10.18-beta.374"});
  await legacy.check();await legacy.preserve();
  assert.deepEqual(legacy.events.map(e=>e[0]),["verify","plan","apply"]);
  // Simulate the new runtime after reload, with the installer's durable
  // exact-version receipt on this same synthetic installation.
  const reopened=harness(undefined,{installedVersion:"0.10.18-beta.382",
    checkResult:{status:"up-to-date",version:"0.10.18-beta.382",channel:"beta"},
    journal:VERIFIED_RELOAD_JOURNAL});
  await reopened.check();await reopened.settle();
  assert.equal(reopened.field("freshMoonDogUpdate").disabled,false);
  assert.match(reopened.field("freshMoonDogUpdate").textContent,/Finish Fresh After Verified Update/);
  await reopened.fresh();
  assert.deepEqual(reopened.events.map(e=>e[0]),["fresh"],
    "the second stage must not download/reapply the update");
  assert.ok(reopened.journalReads()>=2,"the exact local journal must be re-read before reset");
  assert.equal(reopened.storageWrites.includes("moondog-verified-update-followup-v1"),false);
});

test("post-reload Fresh rejects a stale version journal without reapplying or deleting",async()=>{
  const mismatched={status:"verified",verifiedUpdate:{...VERIFIED_RELOAD_JOURNAL.verifiedUpdate,
    version:"0.10.18-beta.381"}};
  const h=harness(undefined,{installedVersion:"0.10.18-beta.382",
    checkResult:{status:"up-to-date"},journal:mismatched});
  await h.check();await h.settle();
  assert.equal(h.field("freshMoonDogUpdate").disabled,true);
  await h.fresh();
  assert.deepEqual(h.events,[]);
});

test("post-reload Fresh checks journal again and blocks a changed receipt",async()=>{
  const h=harness(undefined,{installedVersion:"0.10.18-beta.382",
    checkResult:{status:"up-to-date"},journal:VERIFIED_RELOAD_JOURNAL});
  await h.check();await h.settle();
  assert.equal(h.field("freshMoonDogUpdate").disabled,false);
  h.setJournal({status:"verified",verifiedUpdate:{...VERIFIED_RELOAD_JOURNAL.verifiedUpdate,
    sha256:"a".repeat(64)}});
  await h.fresh();
  assert.deepEqual(h.events,[]);
  assert.match(h.field("updateStatus").textContent,/receipt changed/);
});

test("post-reload Fresh rejects wrong-store picker even with a matching journal",async()=>{
  const h=harness(undefined,{installedVersion:"0.10.18-beta.382",
    checkResult:{status:"up-to-date"},journal:VERIFIED_RELOAD_JOURNAL});
  await h.check();await h.settle();
  h.context.showDirectoryPicker=async()=>({name:"Other-Store",isSameEntry:async()=>false});
  await h.fresh();
  assert.deepEqual(h.events,[]);
  assert.match(h.field("updateStatus").textContent,/does not match the connected installation/);
});

test("post-reload Fresh cancellation never deletes or writes a shared follow-up",async()=>{
  const h=harness(undefined,{installedVersion:"0.10.18-beta.382",
    checkResult:{status:"up-to-date"},journal:VERIFIED_RELOAD_JOURNAL});
  await h.check();await h.settle();
  h.context.__moondogFreshInstallation.resetSelectedFreshInstallation=async()=>{
    h.events.push(["fresh-cancelled"]);return {status:"cancelled"};
  };
  await h.fresh();
  assert.deepEqual(h.events.map(e=>e[0]),["fresh-cancelled"]);
  assert.match(h.field("updateStatus").textContent,/cancelled/);
  assert.equal(h.storageWrites.includes("moondog-verified-update-followup-v1"),false);
});

test("rollback recovery refuses an async root change rather than mixing application and Workspace",async()=>{
  const h=harness(undefined,{backups:["MoonDog-Update-Backup-synthetic"]});
  await h.settle();
  const other={name:"Unrelated-Synthetic-Store",getDirectoryHandle:async()=>({})};
  h.root.getDirectoryHandle=async()=>{
    h.context.__moondogSettingsModel.applicationRoot=other;
    return {name:"System Files from original store"};
  };
  h.context.MoonDogUpdateInstall.recover=async opts=>{
    h.events.push(["recover",opts.appDirectoryHandle,opts.workspaceDirectoryHandle]);
    return {status:"restored"};
  };
  await h.listeners.get("recoverMoonDogUpdate:click")();
  assert.deepEqual(h.events.filter(e=>e[0]==="recover"),[]);
  assert.match(h.field("updateStatus").textContent,/Selected installation changed while opening recovery files/);
});

test("rollback recovery pins both handles to the same selected installation",async()=>{
  const h=harness(undefined,{backups:["MoonDog-Update-Backup-synthetic"]});
  await h.settle();
  const system={name:"System Files selected"};
  h.root.getDirectoryHandle=async()=>system;
  h.context.MoonDogUpdateInstall.recover=async opts=>{
    h.events.push(["recover",opts.appDirectoryHandle,opts.workspaceDirectoryHandle,opts.backupName]);
    return {status:"restored"};
  };
  await h.listeners.get("recoverMoonDogUpdate:click")();
  const [event]=h.events.filter(e=>e[0]==="recover");
  assert.ok(event,"the synthetic selected-store recovery should proceed");
  assert.equal(event[1],system);
  assert.equal(event[2],h.root);
  assert.equal(event[3],"MoonDog-Update-Backup-synthetic");
});

test("rollback recovery refuses a root swap during backup inventory scan",async()=>{
  const h=harness(undefined,{backups:["MoonDog-Update-Backup-synthetic"]});
  await h.settle();
  const other={name:"Unrelated-Synthetic-Store"};
  h.context.MoonDogUpdateInstall.listBackups=async()=>{
    h.context.__moondogSettingsModel.applicationRoot=other;
    return ["MoonDog-Update-Backup-synthetic"];
  };
  h.context.MoonDogUpdateInstall.recover=async()=>{h.events.push(["recover"]);return {status:"restored"};};
  await h.listeners.get("recoverMoonDogUpdate:click")();
  assert.deepEqual(h.events.filter(e=>e[0]==="recover"),[]);
  assert.match(h.field("updateStatus").textContent,/Selected installation changed while checking recovery backups/);
});

test("separate file launchers do not inherit another store's update preferences or recovery hold",async()=>{
  const shared=new Map([["moondog-public-update-preferences-v1",
    JSON.stringify({channel:"beta",recoveryRequired:true})]]);
  const storage={getItem:key=>shared.get(key)||null,setItem:(key,value)=>shared.set(key,value)};
  const first={location:{protocol:"file:",pathname:"/C:/Synthetic/A/index.html"},storage};
  const second={location:{protocol:"file:",pathname:"/C:/Synthetic/B/index.html"},storage};
  const a=harness(undefined,first);await a.settle();
  a.field("updateChannel").value="stable";
  a.listeners.get("updateChannel:change")();
  const b=harness(undefined,second);await b.settle();await b.check();
  assert.equal(b.field("updateChannel").value,"beta",
    "store B must not inherit store A's saved channel");
  assert.equal(b.field("installMoonDogUpdate").disabled,false,
    "legacy shared recovery hold must not block store B");
  const reopened=harness(undefined,first);
  assert.equal(reopened.field("updateChannel").value,"stable");
  assert.ok([...shared.keys()].some(key=>key.includes("/C:/Synthetic/A/index.html")));
});
