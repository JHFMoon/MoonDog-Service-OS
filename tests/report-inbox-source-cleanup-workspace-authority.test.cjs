"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets/app.js"),"utf8");
const first=app.indexOf("  async function removeSourceEntry(name)");
const last=app.indexOf("  async function finishReadOnlyConnection(",first);
assert.ok(first>=0&&last>first,"production source cleanup function is available");
const production=app.slice(first,last);

function harness({location="inbox",pauseAt="",autoCleanup=false,guardBytes=false,missingInbox=false}={}){
  let entered,release;
  const paused=new Promise(resolve=>{entered=resolve;});
  const pending=new Promise(resolve=>{release=resolve;});
  const pause=async stage=>{if(stage===pauseAt){entered();await pending;}};
  const calls={inboxRemovals:0,learnRemovals:0,oldRootRemovals:0,newRootRemovals:0,intentWrites:0,shaReads:0,fileReads:0};
  const oldRoot={name:"Synthetic old Workspace",async removeEntry(){calls.oldRootRemovals++;}};
  const newRoot={name:"Synthetic new Workspace",async removeEntry(){calls.newRootRemovals++;}};
  const inbox={async removeEntry(){calls.inboxRemovals++;}};
  const learned={async removeEntry(){calls.learnRemovals++;}};
  const model={root:oldRoot,autoImport:{seen:{}}};
  const fileBytes=new Uint8Array([1,2,3]);
  const name="synthetic-report.xlsx";
  const sourceLocations=new Map([[name,location]]);
  const xlsxSourceDeleteGuards=new Map(guardBytes?[[name,fileBytes]]:[]);
  const autoSourceDeleteContext=new Map(autoCleanup?[[name,{
    signature:"Report Inbox/synthetic-report.xlsx|3|1",
    relativePath:"Report Inbox/synthetic-report.xlsx",
    kind:"appointments",bytes:fileBytes
  }]]:[]);
  const context=vm.createContext({
    model,dailyPickedSources:new Map(),sourceLocations,xlsxSourceDeleteGuards,
    autoSourceDeleteContext,AUTO_IMPORT_PATH:["data","auto-import.json"],
    reportInbox:async()=>{await pause("inbox");if(missingInbox)throw Object.assign(new Error("No Inbox"),{name:"NotFoundError"});return inbox;},
    directory:async()=>{await pause("learn");return learned;},
    sha256:async()=>{calls.shaReads++;await pause("digest");return "synthetic-sha";},
    writeJson:async()=>{calls.intentWrites++;await pause("ledger");},
    sourceFileHandle:async()=>({getFile:async()=>{calls.fileReads++;return{
      arrayBuffer:async()=>{await pause("bytes");return fileBytes;}
    };}}),
    sameByteContent:(a,b)=>a===b,
    now:()=> "2026-10-31T13:00:00.000Z",
    DOMException,Uint8Array,Map,Object,Error,Boolean
  });
  vm.runInContext(production+"\nthis.remove=removeSourceEntry;",context);
  return{model,oldRoot,newRoot,calls,name,paused,release:()=>release(),remove:()=>context.remove(name)};
}

async function expectStaleRejection(h){
  await assert.rejects(h.remove(),e=>e.name==="InvalidStateError"&&e.sourceCleanupFailure===true);
  assert.equal(h.calls.inboxRemovals,0);
  assert.equal(h.calls.learnRemovals,0);
  assert.equal(h.calls.oldRootRemovals,0);
  assert.equal(h.calls.newRootRemovals,0);
}

test("normal Inbox cleanup still removes the verified source",async()=>{
  const h=harness();await h.remove();
  assert.equal(h.calls.inboxRemovals,1);
  assert.equal(h.calls.newRootRemovals,0);
});

test("reconnect during awaited Inbox lookup never deletes from either Workspace",async()=>{
  const h=harness({pauseAt:"inbox"});
  const run=h.remove();
  await h.paused;h.model.root=h.newRoot;h.release();
  await assert.rejects(run,e=>e.name==="InvalidStateError"&&e.sourceCleanupFailure===true);
  assert.equal(h.calls.inboxRemovals,0);
  assert.equal(h.calls.newRootRemovals,0);
  assert.equal(h.calls.oldRootRemovals,0);
});

test("reconnect during Files To Learn lookup never deletes new-folder source",async()=>{
  const h=harness({location:"learn",pauseAt:"learn"});
  const run=h.remove();
  await h.paused;h.model.root=h.newRoot;h.release();
  await assert.rejects(run,e=>e.name==="InvalidStateError");
  assert.equal(h.calls.learnRemovals,0);
  assert.equal(h.calls.newRootRemovals,0);
});

test("reconnect while cleanup digest awaits does not mutate new Workspace ledger",async()=>{
  const h=harness({autoCleanup:true,pauseAt:"digest"});
  const run=h.remove();
  await h.paused;h.model.root=h.newRoot;h.release();
  await assert.rejects(run,e=>e.name==="InvalidStateError");
  assert.deepEqual(Object.keys(h.model.autoImport.seen),[]);
  assert.equal(h.calls.intentWrites,0);
  assert.equal(h.calls.inboxRemovals,0);
});

test("reconnect while cleanup intent save awaits prevents subsequent source deletion",async()=>{
  const h=harness({autoCleanup:true,pauseAt:"ledger"});
  const run=h.remove();
  await h.paused;h.model.root=h.newRoot;h.release();
  await assert.rejects(run,e=>e.name==="InvalidStateError");
  assert.equal(h.calls.intentWrites,1);
  assert.equal(h.calls.inboxRemovals,0);
  assert.equal(h.calls.newRootRemovals,0);
});

test("reconnect during byte verification rejects even equal-byte filenames",async()=>{
  const h=harness({guardBytes:true,pauseAt:"bytes"});
  const run=h.remove();
  await h.paused;h.model.root=h.newRoot;h.release();
  await assert.rejects(run,e=>e.name==="InvalidStateError");
  assert.equal(h.calls.fileReads,1);
  assert.equal(h.calls.inboxRemovals,0);
});

test("legitimate current Workspace returned workbook cleanup uses captured root",async()=>{
  const h=harness({location:"root"});
  await h.remove();
  assert.equal(h.calls.oldRootRemovals,1);
  assert.equal(h.calls.newRootRemovals,0);
});

test("legacy fallback handles missing Inbox only on original Workspace",async()=>{
  const h=harness({location:"unknown",missingInbox:true});
  await h.remove();
  assert.equal(h.calls.oldRootRemovals,1);
  assert.equal(h.calls.newRootRemovals,0);
});

test("legacy fallback never deletes new Workspace after stale missing-Inbox failure",async()=>{
  const h=harness({location:"unknown",missingInbox:true,pauseAt:"inbox"});
  const run=h.remove();
  await h.paused;h.model.root=h.newRoot;h.release();
  await assert.rejects(run,e=>e.name==="InvalidStateError");
  assert.equal(h.calls.oldRootRemovals,0);
  assert.equal(h.calls.newRootRemovals,0);
});
