"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const source=fs.readFileSync(path.join(__dirname,"..","assets","moondog-update-settings.js"),"utf8");
const offered={status:"newer-version",channel:"beta",version:"0.10.18-beta.68",
  sha256:"a".repeat(64),packageUrl:"https://example.test/moondog-beta.json"};

async function runCase({result={status:"installed",version:offered.version},
  confirms=true,canReload=true,verifyFails=false,recoveryFails=false,failOnInstallPreflight=false}={}){
  const fields=new Map(),listeners=new Map(),scheduled=[],storageWrites=[],reloads=[];
  const field=id=>{
    if(!fields.has(id))fields.set(id,{textContent:"",value:"",disabled:false,hidden:false,
      style:{},className:"",setAttribute:()=>{},addEventListener:(event,fn)=>listeners.set(id+":"+event,fn)});
    return fields.get(id);
  };
  const card={innerHTML:"",id:"",className:"",querySelector:q=>field(q.slice(1))};
  const root={name:"Workspace",getDirectoryHandle:async name=>{
    assert.equal(name,"System Files");return {getDirectoryHandle:async()=>{throw Error("Legacy beta marker unavailable");}};
  }};
  let applied=0, recoveryReads=0;
  const globals={
    document:{
      getElementById:id=>id==="view-settings"?{querySelector:q=>q===".settings-sections"?{append:()=>{}}:null}:null,
      createElement:()=>card,querySelector:()=>null,
      addEventListener:(name,fn)=>listeners.set("document:"+name,fn),hidden:false
    },
    MoonDogInstalledVersion:"0.10.18-beta.67",
    __moondogSettingsModel:{applicationRoot:root},
    __moondogMaintenance:{runtimePaths:["index.html","assets/app.js"]},
    localStorage:{
      getItem:()=>JSON.stringify({channel:"beta"}),
      setItem:(key,value)=>storageWrites.push({key,value})
    },
    MoonDogUpdateCheck:{check:async()=>offered},
    MoonDogPackageVerification:{verify:async()=>{if(verifyFails)throw Error("Unverified");return {
      status:"verified",version:offered.version,channel:"beta",sha256:offered.sha256,
      migrationRequired:false,minimumCompatibleVersion:"0.10.17"
    };}},
    MoonDogPackagePlan:{dryRun:async()=>({add:[],replace:[],delete:[],unchanged:[],rejected:[]})},
    MoonDogUpdateInstall:{listBackups:async()=>{
      recoveryReads++;
      if(recoveryFails||(failOnInstallPreflight&&recoveryReads>1))
        throw Object.assign(new Error("synthetic OneDrive lock"),{name:"NotReadableError"});
      return [];
    },apply:async()=>{applied++;return result;}},
    confirm:()=>confirms,
    location:canReload?{reload:()=>reloads.push("reloaded")}:{},
    setTimeout:(fn,delay)=>{if(delay===20)fn();else scheduled.push({fn,delay});return {unref:()=>{}};},
    addEventListener:()=>{},
    Date
  };
  vm.runInNewContext(source,globals);
  await new Promise(resolve=>setImmediate(resolve));
  if(recoveryFails){
    listeners.get("document:moondog-data")();
    await new Promise(resolve=>setImmediate(resolve));
  }
  await listeners.get("checkMoonDogUpdate:click")();
  await listeners.get("installMoonDogUpdate:click")();
  return {fields,scheduled,reloads,storageWrites,applied};
}

test("verified installation schedules one automatic reload after completion",async()=>{
  const result=await runCase();
  assert.equal(result.applied,1);
  const reloadTimers=result.scheduled.filter(item=>item.delay===900);
  assert.equal(reloadTimers.length,1,"one reload after installation proof");
  assert.match(result.fields.get("updateStatus").textContent,/Reloading Service Operations Dashboard automatically/);
  assert.equal(result.fields.get("updateProgressPercent").textContent,"100%");
  assert.equal(result.fields.get("updateProgressDetail").textContent,"Installation verified. Reloading the dashboard automatically...");
  assert.equal(result.reloads.length,0,"reload is deferred until the result has rendered");
  assert.ok(result.storageWrites.some(x=>x.key==="moondog-verified-update-followup-v1"),
    "existing post-update receipt is preserved");
  reloadTimers[0].fn();
  assert.deepEqual(result.reloads,["reloaded"]);
});

test("cancelled, failed, rolled-back and recovery-required installs never reload",async()=>{
  for(const [scenario,options] of [
    ["cancelled",{confirms:false}],
    ["verification failed",{verifyFails:true}],
    ["rejected",{result:{status:"rejected",reason:"Wrong package"}}],
    ["stopped",{result:{status:"stopped",reason:"Write failed"}}],
    ["rolled-back",{result:{status:"rolled-back",reason:"Restored"}}],
    ["recovery-required",{result:{status:"recovery-required",reason:"Verify restoration"}}]
  ]){
    const result=await runCase(options);
    assert.equal(result.scheduled.filter(x=>x.delay===900).length,0,scenario);
    assert.equal(result.reloads.length,0,scenario);
  }
});

test("if browser reload is unavailable, verified update offers manual refresh",async()=>{
  const result=await runCase({canReload:false});
  assert.equal(result.applied,1);
  assert.equal(result.scheduled.filter(x=>x.delay===900).length,0);
  assert.match(result.fields.get("updateStatus").textContent,/refresh this tab/i);
  assert.match(result.fields.get("updateProgressDetail").textContent,/Ctrl\+R/);
});

test("only a confirmed installed result enters the reload gate",()=>{
  assert.match(source,/if \(outcome\.status === "installed"\) \{/);
  assert.match(source,/verifiedReloadVersion = outcome\.version;/);
  assert.match(source,/if \(verifiedReloadVersion\) reloadVerifiedUpdate\(verifiedReloadVersion\);/);
  assert.match(source,/global\.location\.reload\(\)/);
  assert.doesNotMatch(source,/reloadVerifiedUpdate\(outcome\.version\)/);
});

test("unreadable recovery inventory blocks an offered update before package installation",async()=>{
  const result=await runCase({recoveryFails:true});
  assert.equal(result.applied,0,"the updater must not apply when incomplete backups cannot be checked");
  assert.equal(result.fields.get("installMoonDogUpdate").disabled,true,
    "a failed OneDrive recovery scan must not enable the install button");
  assert.match(result.fields.get("updateChannelNote").textContent,/recovery backups could not be checked/i);
  assert.equal(result.reloads.length,0);
});

test("installation rechecks recovery before writing even when startup scan has not run",async()=>{
  const result=await runCase({failOnInstallPreflight:true});
  assert.equal(result.applied,0,"the installer must reject a late OneDrive backup read failure");
  assert.equal(result.fields.get("installMoonDogUpdate").disabled,true,
    "the failed preflight must hold the install button disabled");
  assert.match(result.fields.get("updateStatus").textContent,/recovery backups are unresolved or cannot be verified/i);
  assert.equal(result.reloads.length,0);
});
