"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source=fs.readFileSync(path.join(__dirname,"..","assets","moondog-update-settings.js"),"utf8");

function harness(installerResult={status:"installed",version:"0.10.18-beta.382",backupName:"MoonDog-Update-Backup-synthetic"}) {
  const listeners=new Map(),fields=new Map(),events=[],storageWrites=[];
  const root={name:"Synthetic-Installation",isSameEntry:async other=>other===root,
    resolve:async()=>["System Files","Workspace"],getDirectoryHandle:async()=>({})};
  function field(name) {
    if(!fields.has(name))fields.set(name,{name,textContent:"",disabled:false,hidden:false,value:"",
      style:{},className:"",setAttribute(){},removeAttribute(){},
      addEventListener(type,callback){listeners.set(name+":"+type,callback);}});
    return fields.get(name);
  }
  const card={innerHTML:"",querySelector:selector=>field(selector.slice(1))};
  const context=vm.createContext({
    MoonDogInstalledVersion:"0.10.18-beta.381",
    __moondogSettingsModel:{applicationRoot:root},
    showDirectoryPicker:async()=>root,
    __moondogMaintenance:{runtimePaths:["assets/app.js"]},
    __moondogFreshInstallation:{resetSelectedFreshInstallation:async options=>{
      events.push(["fresh",options.selectedRoot,options.verifiedInstall.version]);return {status:"fresh"};
    }},
    MoonDogUpdateCheck:{check:async()=>({status:"newer-version",version:"0.10.18-beta.382",
      channel:"beta",packageUrl:"https://example.test/beta.json",sha256:"b".repeat(64)})},
    MoonDogPackageVerification:{verify:async()=>{events.push(["verify"]);return {status:"verified",
      version:"0.10.18-beta.382",channel:"beta",sha256:"b".repeat(64),
      minimumCompatibleVersion:"0.10.9",migrationRequired:false};}},
    MoonDogPackagePlan:{dryRun:async()=>{events.push(["plan"]);return {add:[],replace:[],
      delete:[],unchanged:[],rejected:[]};}},
    MoonDogUpdateInstall:{listBackups:async()=>[],apply:async()=>{events.push(["apply"]);return installerResult;}},
    document:{getElementById:name=>name==="view-settings"?{querySelector:()=>({append(){}})}:null,
      createElement:()=>card,querySelector:()=>null,addEventListener(){}},
    localStorage:{getItem:()=>JSON.stringify({channel:"beta",lastCheck:"2099-01-01T00:00:00.000Z"}),setItem:key=>storageWrites.push(key)},
    confirm:()=>true,Date,setTimeout(){},requestAnimationFrame:fn=>fn()
  });
  vm.runInContext(source,context);
  return {root,events,storageWrites,field,listeners,context,async check(){await listeners.get("checkMoonDogUpdate:click")();},
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
