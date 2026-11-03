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

// Exercise the shipped pre-hydration race guard, not a mock implementation.
const guardBegin=runtime.indexOf("    if (!pendingSettings.sourceAdapters && pendingAdapter) {");
const guardEnd=runtime.indexOf("    validateConnectedWorkbookSnapshot(connectionReadResults[0]);",guardBegin);
assert.ok(guardBegin>0&&guardEnd>guardBegin,"production adapter race guard runs before any model hydration");
const preHydrationGuard=runtime.slice(guardBegin,guardEnd);
async function adapterRaceCheck(preflight,actual,{settingsAdapter=false,readFailure=false}={}){
  const calls={reads:0,writes:0};
  const original={...preflight};
  const previousRoot={id:"existing-safe-root"},pendingRoot={id:"uncommitted-root"};
  const model={root:pendingRoot,applicationRoot:pendingRoot,state:{id:"existing-safe-state"}};
  const ctx={model,previousRoot,previousNativeRoot:previousRoot,connectedNativeRoot:pendingRoot,
    pendingSettings:settingsAdapter?{sourceAdapters:preflight}:{sourceAdapters:null},
    pendingAdapter:{...preflight},
    SOURCE_ADAPTER_BOOTSTRAP_PATH:"source-adapter-bootstrap.json",
    readJson:async()=>{calls.reads++;if(readFailure)throw Error("Synthetic adapter read failure");
      return actual==null?null:{...actual};},
    writeJson:async()=>{calls.writes++;},JSON,Error};
  try{
    const accepted=await vm.runInNewContext("(async()=>{"+preHydrationGuard+"return true;})()",ctx);
    return{accepted,calls,model,ctx,previousRoot,original};
  }catch(error){
    error.raceEvidence={calls,model,ctx,previousRoot,original};
    throw error;
  }
}
test("bootstrap source race stops before hydration, restores prior root and never writes",async()=>{
  const original={schemaVersion:1,sourceId:"original-adapter"};
  const same=await adapterRaceCheck(original,{...original});
  assert.equal(same.accepted,true);
  assert.deepEqual(same.calls,{reads:1,writes:0});
  assert.equal(same.model.root.id,"uncommitted-root","valid adapter may continue through hydration");
  for(const current of [{schemaVersion:1,sourceId:"newer-adapter"},null,
    {schemaVersion:2,sourceId:"invalid"}]){
    await assert.rejects(async()=>{
      try{await adapterRaceCheck(original,current);}
      catch(error){
        const proof=error.raceEvidence;
        assert.deepEqual(proof.calls,{reads:1,writes:0},"no operational write after adapter mismatch");
        assert.equal(proof.model.root,proof.previousRoot,"restore old Workspace root");
        assert.equal(proof.model.applicationRoot,proof.previousRoot,"restore application root");
        assert.equal(proof.ctx.connectedNativeRoot,proof.previousRoot,"restore native root");
        assert.deepEqual(proof.model.state,{id:"existing-safe-state"},
          "failed pre-hydration migration cannot replace previous operational state");
        assert.deepEqual(proof.original,original,"source before and after remain unchanged");
        throw error;
      }
    },/Protected local source adapter changed during connection/);
  }
});
test("adapter read failure restores the previous root without replacing saved state",async()=>{
  const original={schemaVersion:1,sourceId:"previous"};
  await assert.rejects(async()=>{
    try{await adapterRaceCheck(original,null,{readFailure:true});}
    catch(error){
      assert.equal(error.raceEvidence.model.root,error.raceEvidence.previousRoot);
      assert.equal(error.raceEvidence.calls.writes,0);
      throw error;
    }
  },/Synthetic adapter read failure/);
  const settingsWins=await adapterRaceCheck(original,{sourceId:"ignored"},{settingsAdapter:true});
  assert.deepEqual(settingsWins.calls,{reads:0,writes:0},
    "verified adapter already in settings must not re-read legacy bootstrap");
});

test("missing protected adapter stays unknown without a fabricated configured source",async()=>{
  const before={schemaVersion:5,advisors:{},setup:{completedAt:"synthetic"}};
  const output=await inspect(before,null);
  assert.deepEqual(output.reads,["settings.json","source-adapter-bootstrap.json"]);
  assert.equal(output.after.pendingAdapter,null);
  assert.equal(output.after.bootstrapAdapter,null);
  assert.deepEqual(output.writes,[]);
  assert.deepEqual(output.before.sourceSettings,before);
});
test("advisors configured without a source adapter fail before hydration or writes",async()=>{
  const before={schemaVersion:5,advisors:{"110":{}},setup:{completedAt:"synthetic"}};
  let failure;
  await assert.rejects(inspect(before,null,evidence=>{failure=evidence;}),
    /protected local source adapter is missing/);
  assert.ok(failure);
  assert.equal(failure.model.root,failure.oldRoot);
  assert.equal(failure.model.applicationRoot,failure.oldRoot);
  assert.deepEqual(failure.writes,[]);
  assert.deepEqual(failure.before.sourceSettings,before);
});
