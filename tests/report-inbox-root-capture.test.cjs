"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const first=app.indexOf("  function watchedInboxFile(name)");
const last=app.indexOf("  function candidateNeedsImport(candidate)",first);
assert.ok(first>=0&&last>first,"actual production Report Inbox enumerator is present");
const production=app.slice(first,last);

function harness(pauseAt=""){
  let entered,release;
  const paused=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const pause=async point=>{if(pauseAt===point){entered();await gate;}};
  const observations={rootAEntries:0,rootBEntries:0,inboxEntries:0,fileReads:0};
  const file=(size,modified)=>({size,lastModified:modified});
  function fileHandle(data){
    return {kind:"file",async getFile(){
      observations.fileReads++;
      await pause("file");
      return data;
    }};
  }
  const aFile=fileHandle(file(20,5));
  const bFile=fileHandle(file(21,6));
  const iFile=fileHandle(file(10,4));
  const rootA={name:"Workspace A",async *entries(){
    observations.rootAEntries++;
    await pause("root");
    yield ["MoonDog workbook.xlsx",aFile];
  }};
  const rootB={name:"Workspace B",async *entries(){
    observations.rootBEntries++;
    yield ["MoonDog another.xlsx",bFile];
  }};
  const inbox={async *entries(){
    observations.inboxEntries++;
    await pause("inbox");
    yield ["synthetic-report.xlsx",iFile];
  }};
  const model={root:rootA};
  const context=vm.createContext({
    model,REPORT_INBOX:"Report Inbox",
    reportInbox:async()=>{
      await pause("reportInbox");
      return inbox;
    },
    Math,Set,Array,Promise,Map,Boolean,String,RegExp
  });
  vm.runInContext(production+"\nthis.scan=watchCandidates;",context);
  return{model,rootA,rootB,observations,paused,release:()=>release(),
    scan:()=>context.scan()};
}

test("reconnect during awaited Report Inbox directory lookup cannot mix old Inbox with new root",async()=>{
  const h=harness("reportInbox");
  const pending=h.scan();
  await h.paused;h.model.root=h.rootB;h.release();
  const actual=await pending;
  assert.equal(actual.length,0);
  assert.equal(h.observations.inboxEntries,0);
  assert.equal(h.observations.rootAEntries,0);
  assert.equal(h.observations.rootBEntries,0);
  assert.equal(h.observations.fileReads,0);
});

test("reconnect while enumerating Inbox files aborts without listing a different root",async()=>{
  const h=harness("inbox");
  const pending=h.scan();
  await h.paused;h.model.root=h.rootB;h.release();
  const actual=await pending;
  assert.equal(actual.length,0);
  assert.equal(h.observations.rootAEntries,0);
  assert.equal(h.observations.rootBEntries,0);
  assert.equal(h.observations.fileReads,0);
});

test("reconnect while enumerating captured root discards all old-root candidates",async()=>{
  const h=harness("root");
  const pending=h.scan();
  await h.paused;h.model.root=h.rootB;h.release();
  const actual=await pending;
  assert.equal(actual.length,0);
  assert.equal(h.observations.rootAEntries,1);
  assert.equal(h.observations.rootBEntries,0);
  assert.equal(h.observations.fileReads,0);
});

test("reconnect during parallel file metadata reads never publishes old-root signatures",async()=>{
  const h=harness("file");
  const pending=h.scan();
  await h.paused;h.model.root=h.rootB;h.release();
  const actual=await pending;
  assert.equal(actual.length,0);
  assert.equal(h.observations.rootBEntries,0);
  assert.ok(h.observations.fileReads>0,"the original scan reached a real getFile await");
});

test("unchanged Workspace preserves both source families, order, and signatures",async()=>{
  const h=harness();
  const actual=Array.from(await h.scan());
  assert.deepEqual(actual.map(item=>item.location),["inbox","root"]);
  assert.deepEqual(actual.map(item=>item.name),["synthetic-report.xlsx","MoonDog workbook.xlsx"]);
  assert.deepEqual(actual.map(item=>item.signature),[
    "Report Inbox/synthetic-report.xlsx|10|4",
    "MoonDog workbook.xlsx|20|5"
  ]);
  assert.equal(h.observations.rootAEntries,1);
  assert.equal(h.observations.rootBEntries,0);
  assert.equal(h.observations.fileReads,2);
});

test("no connected Workspace yields an empty list without touching folders",async()=>{
  const h=harness();h.model.root=null;
  assert.equal((await h.scan()).length,0);
  assert.equal(h.observations.inboxEntries,0);
  assert.equal(h.observations.fileReads,0);
});
