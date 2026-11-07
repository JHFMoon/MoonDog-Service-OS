"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source=fs.readFileSync(path.join(__dirname,"..","assets","moondog-update-settings.js"),"utf8");

function harness(installerResult={status:"installed",version:"0.10.18-beta.382",backupName:"MoonDog-Update-Backup-synthetic"}) {
  const listeners=new Map(),fields=new Map(),events=[];
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
    localStorage:{getItem:()=>JSON.stringify({channel:"beta",lastCheck:"2099-01-01T00:00:00.000Z"}),setItem(){}},
    confirm:()=>true,Date,setTimeout(){},requestAnimationFrame:fn=>fn()
  });
  vm.runInContext(source,context);
  return {root,events,field,listeners,context,async check(){await listeners.get("checkMoonDogUpdate:click")();},
    async fresh(){await listeners.get("freshMoonDogUpdate:click")();}};
}

test("Fresh choice is available for new Beta offer and occurs only after verified install",async()=>{
  const h=harness();await h.check();
  assert.equal(h.field("freshMoonDogUpdate").disabled,false);
  await h.fresh();
  assert.deepEqual(h.events.map(e=>e[0]),["verify","plan","apply","fresh"]);
  assert.equal(h.events.at(-1)[1],h.root);
  assert.equal(h.events.at(-1)[2],"0.10.18-beta.382");
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
