"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

// #59-03: real autoSurveyFolder awaits an importer that may complete after
// a different Workspace, manual import or permission state took ownership.
const source=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=source.indexOf("  async function autoSurveyFolder(");
const end=source.indexOf("  async function importReturnedWorkbook(",start);
assert.ok(start>=0&&end>start,"production automatic intake exists");
const production=source.slice(start,end);

function harness({failImport=false}={}){
  const initial={name:"Synthetic first Workspace"},newRoot={name:"Synthetic new Workspace"};
  const state={root:initial,manualImport:false,write:true},events=[];
  const item={name:"synthetic-dated-appointments.xlsx",
    relativePath:"Report Inbox/synthetic-dated-appointments.xlsx",
    signature:"Report Inbox/synthetic-dated-appointments.xlsx|3|123",
    location:"inbox",
    file:{lastModified:123,async arrayBuffer(){return new Uint8Array([1,2,3]).buffer;}}};
  const model={root:initial,autoImport:{seen:{}}};
  let entered,release;
  const reached=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const ctx=vm.createContext({
    model,Map,Set,JSON,Object,Promise,Uint8Array,console,
    sourceLocations:new Map(),AUTO_IMPORT_PATH:["data","auto-import.json"],
    watchCandidates:async()=>[item],candidateNeedsImport:()=>true,
    classifyImportFile:async()=>"appointments",
    processClassifiedCandidate:async()=>{events.push("import-entered");entered();await gate;events.push("import-returned");if(failImport)throw Error("Synthetic importer rejected");return{saved:true,deleted:true};},
    writeJson:async()=>{events.push("ledger-write");},sha256:async()=>"digest",
    status:()=>events.push("status"),recordDiagnostic(){},scanFiles:async()=>{},
    now:()=>"2026-11-01T21:00:00Z"
  });
  vm.runInContext(production+"\nthis.scan=autoSurveyFolder;",ctx);
  return{model,newRoot,state,events,reached,release:()=>release(),
    scan:()=>ctx.scan(null,()=>model.root===initial&&!state.manualImport&&state.write),
    item};
}
for(const mode of ["root-switch","manual-import","write-revoked"]){
  test("stale "+mode+" during imported report completion cannot advance new-root ledger",async()=>{
    const h=harness(),running=h.scan();
    await h.reached;
    if(mode==="root-switch")h.model.root=h.newRoot;
    if(mode==="manual-import")h.state.manualImport=true;
    if(mode==="write-revoked")h.state.write=false;
    h.release();
    assert.equal(await running,null,"invalidated scan must not claim completion");
    assert.deepEqual(h.events,["import-entered","import-returned"]);
    assert.equal(h.model.autoImport.seen[h.item.signature],undefined,
      "source completion must not be misapplied to new Workspace's ledger");
  });
}
test("import failure on stale Workspace cannot create a learned or cleanup record",async()=>{
  const h=harness({failImport:true}),running=h.scan();
  await h.reached;h.model.root=h.newRoot;h.release();
  assert.equal(await running,null);
  assert.deepEqual(h.events,["import-entered","import-returned"]);
  assert.equal(h.model.autoImport.seen[h.item.signature],undefined);
});

test("unchanged eligible import still updates its ledger once",async()=>{
  const h=harness(),running=h.scan();
  await h.reached;h.release();
  const result=await running;
  assert.equal(result.imported.length,1);
  assert.deepEqual(h.events,["import-entered","import-returned","ledger-write","status"]);
  assert.equal(h.model.autoImport.seen[h.item.signature].kind,"appointments");
});
