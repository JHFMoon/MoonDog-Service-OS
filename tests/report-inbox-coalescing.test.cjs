"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function extract(source,start,end){
  const begin=source.indexOf(start),finish=source.indexOf(end,begin+start.length);
  assert.ok(begin>=0&&finish>begin,"production scheduler function boundary exists");
  return source.slice(begin,finish);
}
const reportWatch=extract(app,"  async function folderWatchScan(","  async function autoSurveyFolder(");
const learnedReconcile=extract(app,"  async function reconcileLearnedFiles(","  // Read-only catalog-to-disk check");

function harness(){
  let releaseRead,markReadStarted;
  const readGate=new Promise(resolve=>{releaseRead=resolve;});
  const readStarted=new Promise(resolve=>{markReadStarted=resolve;});
  const calls={watchCandidates:0,writes:0};
  const folderWatch={timer:null,busy:false,pending:new Map(),lastChecked:"",state:"OFF",message:""};
  const model={root:{name:"synthetic-root"},autoImport:{}};
  const context=vm.createContext({
    model,folderWatch,writeAuthority:{canWrite:true},dailyImportBusy:false,appointmentImportBusy:false,
    REPORT_INBOX:"Report Inbox",AUTO_IMPORT_PATH:["data","auto-import.json"],
    folderWatchEnabled:()=>true,permission:async()=> "granted",watchStatus:()=>{},
    watchCandidates:async()=>{calls.watchCandidates++;markReadStarted();return readGate;},
    writeJson:async()=>{calls.writes++;},recordDiagnostic:()=>{},now:()=>"2026-10-23T12:00:00.000Z",
    Promise,Map,Set,Object,Array,String,Boolean,JSON,Error,console
  });
  vm.runInContext(reportWatch+"\n"+learnedReconcile+"\nthis.folderWatchScan=folderWatchScan;this.reconcileLearnedFiles=reconcileLearnedFiles;",context);
  return {context,folderWatch,calls,readStarted,releaseRead};
}

test("Report Inbox watch coalesces an overlapping scan and defers learned-file reconciliation",async()=>{
  const h=harness();
  const first=h.context.folderWatchScan("poll");
  await h.readStarted;
  assert.equal(h.folderWatch.busy,true,"the first delayed synthetic inbox scan holds the shared intake slot");
  assert.equal(h.calls.watchCandidates,1);

  const overlapping=await h.context.folderWatchScan("poll");
  assert.equal(overlapping,undefined,"a second watch tick must not start duplicate enumeration");
  assert.deepEqual(await h.context.reconcileLearnedFiles("synthetic-revision"),{deferred:true},
    "Files To Learn reconciliation must defer while the inbox owns the shared intake slot");
  assert.equal(h.calls.watchCandidates,1,"no competing inbox read should start while the first is delayed");

  h.releaseRead([]);
  await first;
  assert.equal(h.folderWatch.busy,false,"the intake slot must be released after the delayed scan completes");
  assert.equal(h.calls.watchCandidates,1);
  assert.equal(h.calls.writes,2,"empty synthetic first-run inventory metadata should be persisted once per required ledger");
});