"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

// #59-03: exercise actual production automatic intake against connection and
// manual-import authority changes during awaited bytes/classification.
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const first=app.indexOf("  async function autoSurveyFolder(");
const last=app.indexOf("  async function importReturnedWorkbook(",first);
assert.ok(first>=0&&last>first,"production Report Inbox intake must exist");
const source=app.slice(first,last);

function harness({pauseAt="classification",classification=null}={}){
  const oldRoot={name:"Synthetic old Workspace"},newRoot={name:"Synthetic new Workspace"};
  const state={canWrite:true,manualBusy:false};
  const calls={classified:0,moved:0,processed:0,writes:0};
  const locations=new Map();
  let signal,release;
  const entered=new Promise(resolve=>{signal=resolve;});
  const blocked=new Promise(resolve=>{release=resolve;});
  const pause=async stage=>{if(stage===pauseAt){signal();await blocked;}};
  const candidate={name:"synthetic-unrecognized.bin",location:"inbox",
    relativePath:"Report Inbox/synthetic-unrecognized.bin",
    signature:"Report Inbox/synthetic-unrecognized.bin|3|123",
    file:{lastModified:123,async arrayBuffer(){await pause("bytes");return new Uint8Array([1,2,3]).buffer;}}};
  const model={root:oldRoot,autoImport:{seen:{}}};
  const context=vm.createContext({
    model,Map,Set,Promise,Uint8Array,JSON,Object,Boolean,Error,
    sourceLocations:locations,AUTO_IMPORT_PATH:["data","auto-import.json"],
    watchCandidates:async()=>[candidate],candidateNeedsImport:()=>true,
    classifyImportFile:async()=>{calls.classified++;await pause("classification");return classification;},
    moveToLearn:async()=>{calls.moved++;return "synthetic-learned.bin";},
    processClassifiedCandidate:async()=>{calls.processed++;return{saved:true,deleted:true};},
    referenceOnlyHint:()=>false,recognizedFamilyHint:()=>false,
    recordDiagnostic(){},status(){},now:()=>"2026-11-01T20:30:00Z",
    writeJson:async()=>{calls.writes++;},scanFiles:async()=>{},addHistory:async()=>{},
    sha256:async()=> "synthetic-digest",console
  });
  vm.runInContext(source+"\nthis.scan=autoSurveyFolder;",context);
  return{model,oldRoot,newRoot,state,calls,locations,entered,
    release:()=>release(),scan:()=>context.scan(null,()=>model.root===oldRoot&&state.canWrite&&!state.manualBusy)};
}

for(const paused of ["bytes","classification"]){
  test("reconnect during awaited "+paused+" never starts stale source handling",async()=>{
    const h=harness({pauseAt:paused,classification:null});
    const ongoing=h.scan();
    await h.entered;
    h.model.root=h.newRoot;
    h.release();
    assert.equal(await ongoing,null,"stale scan returns no completion");
    assert.equal(h.calls.moved,0,"old file must not move in the replacement Workspace");
    assert.equal(h.calls.processed,0);
    assert.equal(h.calls.writes,0);
    assert.equal(h.locations.size,0,"stale scan may not contaminate new-root source map");
    assert.deepEqual(Object.keys(h.model.autoImport.seen),[]);
    assert.equal(h.calls.classified,paused==="bytes"?0:1);
  });
}

test("manual import entering during classification prevents a competing automatic import",async()=>{
  const h=harness({pauseAt:"classification",classification:"appointments"});
  const ongoing=h.scan();
  await h.entered;
  h.state.manualBusy=true;
  h.release();
  assert.equal(await ongoing,null);
  assert.equal(h.calls.processed,0);
  assert.equal(h.calls.writes,0);
  assert.equal(h.locations.size,0);
});

test("write authority revoked during classification blocks rejected-source relocation",async()=>{
  const h=harness({pauseAt:"classification",classification:null});
  const ongoing=h.scan();
  await h.entered;
  h.state.canWrite=false;
  h.release();
  assert.equal(await ongoing,null);
  assert.equal(h.calls.moved,0);
  assert.equal(h.calls.writes,0);
  assert.equal(h.locations.size,0);
});

test("unchanged eligible source still classifies and imports once",async()=>{
  const h=harness({pauseAt:"none",classification:"appointments"});
  const result=await h.scan();
  assert.equal(h.calls.classified,1);
  assert.equal(h.calls.processed,1);
  assert.equal(h.calls.moved,0);
  assert.equal(h.calls.writes,1);
  assert.equal(result.imported.length,1);
  assert.equal(h.locations.get("synthetic-unrecognized.bin"),"inbox");
});
