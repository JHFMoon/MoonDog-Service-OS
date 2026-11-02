"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const begin=app.indexOf("  async function autoSurveyFolder(");
const end=app.indexOf("  async function importReturnedWorkbook(",begin);
assert.ok(begin>=0&&end>begin,"production Report Inbox scanner exists");
const code=app.slice(begin,end);

function harness(kind,{delayedHistory=false,delayedCatchDigest=false,failImport=false}={}){
  const root={name:"Original synthetic Workspace"},replacement={name:"Replacement synthetic Workspace"};
  const auth={write:true,manualImport:false},events=[];
  const bytes=new Uint8Array([4,7,9]).buffer,signature="synthetic/inbox/report|3|123";
  const candidate={name:kind==="open-ro-docx"?"synthetic-open-ro.docx":"synthetic-open-ro.xlsx",
    location:"inbox",relativePath:"Report Inbox/synthetic-report",signature,
    file:{lastModified:123,async arrayBuffer(){return bytes;}}};
  const model={root,autoImport:{seen:{}},
    state:{records:[],source:{sha256:"synthetic-digest"}}};
  let release,signal;
  const gate=new Promise(resolve=>{release=resolve;});
  const reached=new Promise(resolve=>{signal=resolve;});
  let digestCalls=0;
  const context=vm.createContext({
    model,sourceLocations:new Map(),AUTO_IMPORT_PATH:["data","auto-import.json"],
    STATE_PATH:["data","state.json"],Map,Set,JSON,Object,Promise,Uint8Array,console,
    watchCandidates:async()=>[candidate],candidateNeedsImport:()=>true,
    classifyImportFile:async()=>kind,
    addHistory:async()=>{events.push("history-enter");if(delayedHistory){signal();await gate;}events.push("history-return");},
    sha256:async()=>{digestCalls++;events.push("digest-"+digestCalls);
      if(delayedCatchDigest&&digestCalls===2){signal();await gate;}return"synthetic-digest";},
    readJson:async()=>null,
    processClassifiedCandidate:async()=>{events.push("import-enter");if(failImport)throw Error("Synthetic projection failure");return{saved:true,deleted:true};},
    writeJson:async()=>{events.push("ledger-write");},
    moveToLearn:async()=>{events.push("learn-move");return"synthetic-learned";},
    transientIntakeError:()=>false,
    now:()=>"2026-11-01T12:00:00Z",recordDiagnostic:()=>events.push("diagnostic"),
    status:()=>events.push("status"),scanFiles:async()=>events.push("scan-files")
  });
  vm.runInContext(code+"\nthis.scan=autoSurveyFolder;",context);
  return{model,replacement,auth,events,signature,reached,release:()=>release(),
    scan:()=>context.scan(null,()=>model.root===root&&auth.write&&!auth.manualImport)};
}

for(const mode of ["root-switch","permission-loss","manual-import"]){
  test("late DOCX history cannot publish "+mode+" manual-review ledger",async()=>{
    const h=harness("open-ro-docx",{delayedHistory:true});
    const running=h.scan();
    await h.reached;
    if(mode==="root-switch")h.model.root=h.replacement;
    if(mode==="permission-loss")h.auth.write=false;
    if(mode==="manual-import")h.auth.manualImport=true;
    h.release();
    assert.equal(await running,null);
    assert.equal(h.model.autoImport.seen[h.signature],undefined);
    assert.equal(h.events.includes("ledger-write"),false);
    assert.equal(h.events.includes("scan-files"),false);
    assert.equal(h.events.includes("status"),false);
    assert.equal(h.events.includes("learn-move"),false);
  });
}
test("eligible DOCX still requests manual source review and commits intake ledger",async()=>{
  const h=harness("open-ro-docx");
  const result=await h.scan();
  assert.equal(result.reviewRequired.length,1);
  assert.equal(h.model.autoImport.seen[h.signature].manualImportRequired,true);
  assert.equal(h.events.filter(e=>e==="ledger-write").length,1);
  assert.equal(h.events.filter(e=>e==="history-enter").length,1);
  assert.equal(h.events.includes("scan-files"),true);
  assert.equal(h.events.includes("learn-move"),false);
});
test("stale Open RO error-derived digest cannot report source retained in replacement root",async()=>{
  const h=harness("open-ro",{failImport:true,delayedCatchDigest:true});
  const running=h.scan();
  await h.reached;
  h.model.root=h.replacement;
  h.release();
  assert.equal(await running,null);
  assert.equal(h.events.includes("status"),false);
  assert.equal(h.events.includes("diagnostic"),false);
  assert.equal(h.events.includes("learn-move"),false);
});
test("eligible Open RO failed projection keeps already-committed roster source for retry",async()=>{
  const h=harness("open-ro",{failImport:true});
  const result=await h.scan();
  assert.equal(result.retained.length,1);
  assert.equal(result.learned.length,0);
  assert.equal(h.events.includes("learn-move"),false);
});
