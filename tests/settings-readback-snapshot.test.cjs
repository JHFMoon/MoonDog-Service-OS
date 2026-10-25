"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");

function slice(first,last){
  const from=app.indexOf(first),to=app.indexOf(last,from+first.length);
  assert.ok(from!==-1&&to>from,"Production boundary "+first);
  return app.slice(from,to);
}
const writeSource=slice("  async function writeJson(","  async function backupState(");
const saveSource=slice("  let settingsAutosaveTimer=null","  async function updateAdvisorLifecycle(");
function deferred(){
  let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});
  return {promise,resolve,reject};
}
function writeHarness({differentReadback=false,gate=null}={}){
  let contents="",saves=0;const diagnostics=[];
  const ctx=vm.createContext({
    writeAuthority:{requireWrite:()=>{}},TextEncoder,
    writeBytes:async (_,bytes)=>{
      contents=new TextDecoder().decode(bytes);
      saves++;
      if(gate)await gate.promise;
    },
    readJson:async()=>differentReadback?{saved:"other"}:JSON.parse(contents),
    recordDiagnostic:(kind,details)=>diagnostics.push({kind,details})
  });
  vm.runInContext(writeSource+"\nthis.writeJson=writeJson;",ctx);
  return {ctx,diagnostics,get saves(){return saves;},get contents(){return contents;}};
}

test("data/settings.json verifies the serialized bytes, not a mutable advisor model",async()=>{
  const gate=deferred(),h=writeHarness({gate});
  const settings={advisors:{"101":{participation:{advisorMeeting:false}}}};
  const pending=h.ctx.writeJson(["data","settings.json"],settings);
  settings.advisors["101"].participation.advisorMeeting=true;
  gate.resolve();
  await pending;
  assert.equal(JSON.parse(h.contents).advisors["101"].participation.advisorMeeting,false);
  assert.equal(settings.advisors["101"].participation.advisorMeeting,true);
  assert.equal(h.diagnostics.at(-1).kind,"DURABLE WRITE");
});

test("genuine disk readback mismatch still fails closed",async()=>{
  const h=writeHarness({differentReadback:true});
  await assert.rejects(h.ctx.writeJson(["data","settings.json"],{saved:"expected"}),/Read-back verification failed for data\/settings\.json/);
  assert.equal(h.diagnostics.at(-1).kind,"DURABLE WRITE FAILED");
});

test("rapid advisor toggles during an in-flight save cannot show false Saved or lose latest value",async()=>{
  const first=deferred(),entered=deferred();
  const tasks=[],writes=[];
  const status={dataset:{},textContent:""};
  let stamp=0;
  const settings={schemaVersion:1,advisors:{"101":{participation:{advisorMeeting:false}}}};
  const model={root:{name:"Synthetic"},settings};
  const ctx=vm.createContext({
    model,ui:{settingsSaveStatus:status},
    SETTINGS_PATH:["data","settings.json"],
    writeAuthority:{canWrite:true},
    readSettingsInputs:()=>{},
    now:()=>`2026-10-22T09:03:${String(stamp++).padStart(2,"0")}Z`,
    writeJson:async(_,data)=>{
      writes.push(JSON.parse(JSON.stringify(data)));
      if(writes.length===1){entered.resolve();await first.promise;}
    },
    addHistory:async()=>{},
    renderAll:()=>{},
    Date,
    setTimeout:fn=>{const task={fn,cancelled:false};tasks.push(task);return task;},
    clearTimeout:task=>{if(task)task.cancelled=true;},
    run:fn=>fn()
  });
  vm.runInContext(saveSource+"\nthis.queueSettingsAutosave=queueSettingsAutosave;",ctx);
  ctx.queueSettingsAutosave();
  assert.equal(status.dataset.saveState,"saving");
  const firstSave=tasks[0].fn();
  await entered.promise;
  settings.advisors["101"].participation.advisorMeeting=true;
  ctx.queueSettingsAutosave();
  assert.equal(tasks.length,2);
  first.resolve();await firstSave;
  assert.equal(status.dataset.saveState,"saving","Older completion cannot claim latest setting saved");
  const active=tasks.filter(t=>!t.cancelled).at(-1);
  assert.ok(active,"Newer changed settings must remain queued");
  await active.fn();
  assert.equal(writes.length,2);
  assert.equal(writes[0].advisors["101"].participation.advisorMeeting,false);
  assert.equal(writes[1].advisors["101"].participation.advisorMeeting,true);
  assert.equal(status.dataset.saveState,"saved");
});

test("overlapping autosaves do not requeue for newer save timestamps",async()=>{
  const first=deferred(),second=deferred(),enteredFirst=deferred(),enteredSecond=deferred();
  const tasks=[],writes=[];
  const status={dataset:{},textContent:""};
  let stamp=0;
  const settings={schemaVersion:1,advisors:{"101":{participation:{advisorMeeting:false}}}};
  const model={root:{name:"Synthetic"},settings};
  const ctx=vm.createContext({
    model,ui:{settingsSaveStatus:status},SETTINGS_PATH:["data","settings.json"],writeAuthority:{canWrite:true},
    readSettingsInputs:()=>{},now:()=>`2026-10-22T09:03:${String(stamp++).padStart(2,"0")}Z`,
    writeJson:async(_,data)=>{
      const index=writes.length;
      writes.push(JSON.parse(JSON.stringify(data)));
      if(index===0){enteredFirst.resolve();await first.promise;}
      if(index===1){enteredSecond.resolve();await second.promise;}
    },
    addHistory:async()=>{},renderAll:()=>{},Date,
    setTimeout:fn=>{const task={fn,cancelled:false};tasks.push(task);return task;},
    clearTimeout:task=>{if(task)task.cancelled=true;},run:fn=>fn()
  });
  vm.runInContext(saveSource+"\nthis.queueSettingsAutosave=queueSettingsAutosave;",ctx);
  ctx.queueSettingsAutosave();
  const firstSave=tasks[0].fn();
  await enteredFirst.promise;
  settings.advisors["101"].participation.advisorMeeting=true;
  ctx.queueSettingsAutosave();
  const secondSave=tasks[1].fn();
  await enteredSecond.promise;
  first.resolve();await firstSave;
  assert.equal(tasks.length,2,"The older completion must not queue another save for updatedAt alone");
  assert.equal(status.dataset.saveState,"saving","The newer overlapping save still owns the indicator");
  second.resolve();await secondSave;
  assert.equal(writes.length,2);
  assert.equal(writes[0].advisors["101"].participation.advisorMeeting,false);
  assert.equal(writes[1].advisors["101"].participation.advisorMeeting,true);
  assert.equal(status.dataset.saveState,"saved");
});

test("older failing save does not overwrite newer Saving indicator",async()=>{
  const gate=deferred(),entered=deferred(),tasks=[],errors=[];
  const status={dataset:{},textContent:""};
  const model={root:{name:"Synthetic"},settings:{schemaVersion:1,advisors:{"101":{participation:{advisorMeeting:false}}}}};
  let count=0;
  const ctx=vm.createContext({
    model,ui:{settingsSaveStatus:status},SETTINGS_PATH:["data","settings.json"],writeAuthority:{canWrite:true},
    readSettingsInputs:()=>{},now:()=>`2026-10-22T09:03:${String(count++).padStart(2,"0")}Z`,
    writeJson:async()=>{if(++count===2){entered.resolve();await gate.promise;throw Error("Synthetic OneDrive readback failure");}},
    addHistory:async()=>{},renderAll:()=>{},Date,
    setTimeout:fn=>{const task={fn,cancelled:false};tasks.push(task);return task;},
    clearTimeout:task=>{if(task)task.cancelled=true;},
    run:async fn=>{try{await fn();}catch(e){errors.push(e.message);}}
  });
  vm.runInContext(saveSource+"\nthis.queueSettingsAutosave=queueSettingsAutosave;",ctx);
  ctx.queueSettingsAutosave();const first=tasks[0].fn();await entered.promise;
  model.settings.advisors["101"].participation.advisorMeeting=true;ctx.queueSettingsAutosave();
  gate.resolve();await first;
  assert.equal(status.dataset.saveState,"saving");
  assert.equal(errors.length,1);
  const latest=tasks.filter(t=>!t.cancelled).at(-1);
  await latest.fn();
  assert.equal(status.dataset.saveState,"saved");
});
