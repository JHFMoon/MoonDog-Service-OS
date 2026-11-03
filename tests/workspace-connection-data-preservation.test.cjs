"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

// Extract the shipped preflight and reuse expression. No real folder, data, or permission changes.
const runtimePath="assets/app.js";
const runtime=fs.readFileSync(path.join(__dirname,"..",...runtimePath.split("/")),"utf8");
const begin=runtime.indexOf("    let pendingSettings,pendingAdapter;");
const finish=runtime.indexOf("    connectedNativeRoot = handle;",begin);
assert.ok(begin>0&&finish>begin,"protected production adapter preflight exists");
const preflight=runtime.slice(begin,finish);
const expression=runtime.match(/const bootstrapAdapter = rawSettings\.sourceAdapters \? null : pendingAdapter;/);
assert.ok(expression,"verified production bootstrap adapter reuse exists");

async function inspect(sourceSettings,sourceBootstrap,observeFailure=()=>{}) {
  const before=JSON.parse(JSON.stringify({sourceSettings,sourceBootstrap}));
  const reads=[],writes=[];
  const adapterPath="source-adapter-bootstrap.json",settingsPath="settings.json";
  const oldRoot={id:"old synthetic root"};
  const model={root:{id:"new synthetic root"},applicationRoot:{id:"new root"},pendingRoot:null};
  const ctx={
    model,previousRoot:oldRoot,previousNativeRoot:oldRoot,connectedNativeRoot:oldRoot,
    SETTINGS_PATH:settingsPath,SOURCE_ADAPTER_BOOTSTRAP_PATH:adapterPath,
    readJson:async(key,fallback)=>{
      reads.push(key);
      return JSON.parse(JSON.stringify(key===settingsPath?sourceSettings:
        key===adapterPath?sourceBootstrap:fallback));
    },
    writeJson:async(...args)=>writes.push(args),Error,Object
  };
  const script="(async()=>{"+preflight+"\n"+
    "const rawSettings=pendingSettings;"+expression[0]+
    "return {pendingSettings,pendingAdapter,bootstrapAdapter};})()";
  let after;
  try{after=await vm.runInNewContext(script,ctx);}
  catch(error){observeFailure({before,reads,writes,model,oldRoot});throw error;}
  return {before,after,reads,writes,model};
}
test("reconnect reuses validated bootstrap adapter without another source read or mutation",async()=>{
  const settings={schemaVersion:5,advisors:{},setup:{completedAt:"synthetic"}};
  const adapter={schemaVersion:1,sourceId:"synthetic-verified-adapter"};
  const output=await inspect(settings,adapter);
  assert.deepEqual(output.reads,["settings.json","source-adapter-bootstrap.json"]);
  assert.equal(output.after.bootstrapAdapter.sourceId,adapter.sourceId);
  assert.deepEqual(JSON.parse(JSON.stringify(output.after.pendingSettings)),settings);
  assert.deepEqual(JSON.parse(JSON.stringify(output.after.pendingAdapter)),adapter);
  assert.deepEqual(output.writes,[],"preflight may not write before authority and migration gates");
  assert.deepEqual(output.before,{sourceSettings:settings,sourceBootstrap:adapter},
    "original source and before/after evidence must remain unchanged");
});
test("stored adapter remains authoritative and missing bootstrap is never consulted",async()=>{
  const adapter={schemaVersion:1,sourceId:"settings-authority"};
  const settings={schemaVersion:5,advisors:{},sourceAdapters:adapter};
  const output=await inspect(settings,{schemaVersion:1,sourceId:"ignored-bootstrap"});
  assert.deepEqual(output.reads,["settings.json"]);
  assert.equal(output.after.bootstrapAdapter,null);
  assert.equal(output.after.pendingAdapter.sourceId,"settings-authority");
  assert.deepEqual(output.writes,[]);
});
test("invalid bootstrap adapter fails before hydration and restores previous Workspace root",async()=>{
  const invalid={schemaVersion:99,sourceId:"synthetic-invalid"};
  const before={schemaVersion:5,advisors:{"110":{}},setup:{completedAt:"synthetic"}};
  let failure;
  await assert.rejects(inspect(before,invalid,state=>{failure=state;}),/protected local source adapter is invalid/);
  assert.ok(failure,"invalid adapter rejection must expose the synthetic recovery snapshot");
  assert.equal(failure.model.root,failure.oldRoot,"root restored after invalid preflight");
  assert.equal(failure.model.applicationRoot,failure.oldRoot,"application root restored");
  assert.deepEqual(failure.reads,["settings.json","source-adapter-bootstrap.json"]);
  assert.deepEqual(failure.writes,[],"invalid adapter must fail before writing any source or notes");
  assert.deepEqual(before,{schemaVersion:5,advisors:{"110":{}},setup:{completedAt:"synthetic"}},
    "failed adapter preflight must preserve before state, not silently alter source data");
});

test("invalid settings adapter takes precedence and fails closed without bootstrap reads",async()=>{
  const bad={schemaVersion:2,sourceId:"synthetic-invalid-settings"};
  const original={schemaVersion:5,advisors:{"110":{}},sourceAdapters:bad};
  let failure;
  await assert.rejects(inspect(original,{schemaVersion:1,sourceId:"must-not-override"},
    state=>{failure=state;}),/protected local source adapter is invalid/);
  assert.ok(failure);
  assert.deepEqual(failure.reads,["settings.json"],"protected settings are the authoritative source");
  assert.equal(failure.model.root,failure.oldRoot);
  assert.equal(failure.model.applicationRoot,failure.oldRoot);
  assert.deepEqual(failure.writes,[],"invalid authoritative settings must never be silently repaired");
  assert.equal(original.sourceAdapters.sourceId,"synthetic-invalid-settings");
});
