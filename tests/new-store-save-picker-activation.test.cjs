"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf("async function prepareForNewStore(){");
const end=app.indexOf("  let newStoreBusy=",start);
assert.ok(start>0&&end>start,"production new-store reset entrypoint must be present");
const implementation=app.slice(start,end);

function harness(options={}){
  const calls=[];
  const root={name:"COPIED-SYNTHETIC-WORKSPACE"};
  const source={name:"copied-installation",resolve:async()=>{calls.push("resolve");return options.inside?["inside"]:null;}};
  let archive=new Uint8Array(0);
  const save={
    createWritable:async()=>({write:async value=>{calls.push("write");archive=value;},
      close:async()=>{calls.push("close");}}),
    getFile:async()=>({arrayBuffer:async()=>{calls.push("readback");return archive;}})
  };
  const cancel=Object.assign(new Error("User canceled"),{name:"AbortError"});
  const ctx=vm.createContext({
    model:{root},connectedNativeRoot:source,
    ui:{handoffCopyConfirm:{checked:true},handoffEraseConfirm:{checked:true},
      handoffPhrase:{value:"PREPARE NEW STORE"}},
    newStoreRecoveryLocked:()=>false,
    writeAuthority:{canWrite:true,requireWrite:()=>calls.push("requireWrite")},
    window:{showSaveFilePicker:()=>{calls.push("picker");if(options.cancel)throw cancel;
      if(options.changeRoot)ctx.model.root={name:"OTHER"};
      return Promise.resolve(save);}},
    stamp:()=>"synthetic",
    runtimeIntegrity:async()=>{calls.push("runtimeIntegrity");return {"index.html":"synthetic"};},
    handoffTargets:async()=>{calls.push("handoffTargets");return [];},
    createExternalHandoffBackup:async()=>{calls.push("createArchive");return new Uint8Array([1,2,3]);},
    validateExternalHandoffBackup:async()=>{calls.push("validateArchive");return true;},
    confirm:()=>{calls.push("confirm");return false;},
    console
  });
  vm.runInContext(implementation+";globalThis.prepareForNewStore=prepareForNewStore;",ctx);
  return {ctx,calls};
}

test("external backup picker is invoked before async preflight can lose click activation",async()=>{
  const h=harness();
  const run=h.ctx.prepareForNewStore();
  // Browser event gesture is still active until the first async suspension.
  assert.deepEqual(h.calls,["requireWrite","picker"]);
  await run;
  assert.deepEqual(h.calls,["requireWrite","picker","runtimeIntegrity","handoffTargets",
    "createArchive","resolve","write","close","readback","validateArchive","confirm"]);
});

test("canceling backup dialog never starts preflight or destructive reset",async()=>{
  const h=harness({cancel:true});
  await assert.rejects(h.ctx.prepareForNewStore(),error=>error.name==="AbortError");
  assert.deepEqual(h.calls,["requireWrite","picker"]);
});

test("destination within copied installation is rejected before any backup write",async()=>{
  const h=harness({inside:true});
  await assert.rejects(h.ctx.prepareForNewStore(),/outside the Service Operations Dashboard copy/);
  assert.ok(h.calls.includes("resolve"));
  assert.ok(!h.calls.includes("write"));
  assert.ok(!h.calls.includes("confirm"));
});

test("Workspace switch while picker is open stops preparation",async()=>{
  const h=harness({changeRoot:true});
  await assert.rejects(h.ctx.prepareForNewStore(),/changed or lost edit access/);
  assert.deepEqual(h.calls,["requireWrite","picker"]);
});
