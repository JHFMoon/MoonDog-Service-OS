"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

// #59-03: exercise production cleanup retry on an already durably imported
// source without real files, customer records, or a connected Workspace.
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const first=app.indexOf("  async function autoSurveyFolder(");
const end=app.indexOf("  async function importReturnedWorkbook(",first);
assert.ok(first>=0&&end>first,"production automatic import function exists");
const source=app.slice(first,end);

function harness({pauseAt="none"}={}){
  const initial={name:"Synthetic first root"},next={name:"Synthetic second root"};
  const state={write:true,manualBusy:false};
  const signature="Report Inbox/synthetic.xlsx|3|123";
  const relativePath="Report Inbox/synthetic.xlsx";
  const model={root:initial,autoImport:{seen:{
    [signature]:{fileName:"synthetic.xlsx",relativePath,kind:"appointments",
      cleanupPending:true,cleanupSha256:"synthetic-digest",importedAt:"2026-11-01T08:00:00Z"}
  }}};
  const events=[],locations=new Map();
  let signal,release;
  const entered=new Promise(resolve=>{signal=resolve;});
  const latch=new Promise(resolve=>{release=resolve;});
  const pause=async phase=>{if(pauseAt===phase){signal();await latch;}};
  const candidate={
    name:"synthetic.xlsx",relativePath,signature,location:"inbox",
    file:{lastModified:123,async arrayBuffer(){await pause("bytes");return new Uint8Array([1,2,3]).buffer;}}
  };
  const context=vm.createContext({
    model,Map,Set,Object,JSON,Uint8Array,Promise,console,
    sourceLocations:locations,AUTO_IMPORT_PATH:["data","auto-import.json"],
    watchCandidates:async()=>[candidate],candidateNeedsImport:()=>true,
    sha256:async()=>{await pause("digest");return "synthetic-digest";},
    now:()=>"2026-11-01T20:40:00Z",
    writeJson:async()=>{events.push("ledger");await pause("ledger");},
    removeSourceEntryWithByteGuard:async()=>{events.push("delete");},
    recordDiagnostic(){},status(){},scanFiles:async()=>{},addHistory:async()=>{}
  });
  vm.runInContext(source+"\nthis.scan=autoSurveyFolder;",context);
  const eligible=()=>model.root===initial&&state.write&&!state.manualBusy;
  return{model,state,next,events,locations,entered,release:()=>release(),
    scan:()=>context.scan(null,eligible),signature};
}

for(const stage of ["bytes","digest","ledger"]){
  test("revoked Workspace during cleanup "+stage+" keeps durable retry intent",async()=>{
    const h=harness({pauseAt:stage});
    const pending=h.scan();
    await h.entered;
    h.model.root=h.next;
    h.release();
    assert.equal(await pending,null,"stale completion must not be published");
    assert.equal(h.events.includes("delete"),false,"source remains when cleanup authority changed");
    assert.equal(h.model.autoImport.seen[h.signature].cleanupPending,true);
    assert.equal(h.model.autoImport.seen[h.signature].cleanupSha256,"synthetic-digest");
    if(stage!=="ledger"){
      assert.equal(h.events.includes("ledger"),false,"old scan must not write new-root ledger");
      assert.equal(h.locations.size,0,"old source path must not be recorded on new root");
    }
  });
}

test("manual import beginning during pending cleanup digest blocks later source deletion",async()=>{
  const h=harness({pauseAt:"digest"});
  const pending=h.scan();
  await h.entered;h.state.manualBusy=true;h.release();
  assert.equal(await pending,null);
  assert.equal(h.events.includes("delete"),false);
  assert.equal(h.model.autoImport.seen[h.signature].cleanupPending,true);
});

test("healthy verified cleanup persists intent, removes source and records completion",async()=>{
  const h=harness();
  const result=await h.scan();
  assert.deepEqual(h.events,["ledger","delete","ledger"]);
  assert.equal(result.cleaned.length,1);
  assert.equal(h.model.autoImport.seen[h.signature].cleanupPending,false);
  assert.equal(h.model.autoImport.seen[h.signature].cleanupSha256,undefined);
  assert.equal(h.locations.get("synthetic.xlsx"),"inbox");
});
