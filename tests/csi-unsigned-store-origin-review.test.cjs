"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function production(start,end){
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"Production CSI origin boundary remains testable: "+start);
  return app.slice(a,b);
}
const scanSource=production("  async function autoSurveyFolder(","  async function importReturnedWorkbook(");
const dispatcher=production("  async function processClassifiedCandidate(","  async function reconcileLearnedFiles(");

test("an unsigned CSI Inbox report cannot auto-promote operational metrics",async()=>{
  const name="synthetic-csi.csv",signature="01 - DROP REPORTS HERE/"+name+"|3|123";
  const candidate={name,signature,location:"inbox",relativePath:"01 - DROP REPORTS HERE/"+name,
    file:{size:3,lastModified:123,slice:()=>({text:async()=>""}),
      arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}};
  const events=[],model={autoImport:{seen:{}}};
  const ctx=vm.createContext({
    model,sourceLocations:new Map(),Map,Set,JSON,Uint8Array,
    AUTO_IMPORT_PATH:["data","auto-import.json"],
    watchCandidates:async()=>[candidate],candidateNeedsImport:()=>true,
    classifyImportFile:async()=> "csi",
    processClassifiedCandidate:async()=>events.push("UNSAFE IMPORT"),
    addHistory:async(kind,summary,details)=>{
      assert.equal(kind,"csi-review-required");
      assert.equal(details.sourceStoreConfidence,"configured-destination-only");
      events.push("review-history");
    },
    moveToLearn:async()=>events.push("UNSAFE MOVE"),
    writeJson:async()=>events.push("ledger-write"),
    now:()=>"2026-11-04T12:00:00Z",
    recordDiagnostic:()=>{},status:()=>{},scanFiles:async()=>events.push("rescan"),
    console
  });
  vm.runInContext(scanSource+"\nthis.scan=autoSurveyFolder;",ctx);
  const outcome=await ctx.scan();
  assert.equal(outcome.imported.length,0);
  assert.equal(outcome.learned.length,0);
  assert.equal(outcome.reviewRequired.length,1);
  assert.deepEqual(events,["review-history","ledger-write","rescan"]);
  assert.equal(model.autoImport.seen[signature].manualImportRequired,true);
  assert.equal(model.autoImport.seen[signature].sourceStoreConfidence,"configured-destination-only");
  assert.equal(model.autoImport.seen[signature].kind,"csi");
});

test("CSI dispatcher rejects unattended sources and requires explicit manager origin review",async()=>{
  let imported=0,confirmationCount=0;
  const model={settings:{store:{name:"Synthetic Dealership",code:"9001"}}};
  const ctx=vm.createContext({
    model,sourceLocations:new Map(),window:{confirm:()=>{confirmationCount++;return false;}},
    importCsiFile:async()=>{imported++;},
    ensurePreviousMonthSummary:async()=>{},renderAll:()=>{}
  });
  vm.runInContext(dispatcher+"\nthis.dispatch=processClassifiedCandidate;",ctx);
  const candidate={name:"synthetic-csi.csv",location:"inbox"};
  await assert.rejects(ctx.dispatch(candidate,"csi",new ArrayBuffer(1),false),/unsigned CSI cannot be imported unattended/);
  await assert.rejects(ctx.dispatch({...candidate,location:"learn"},"csi",new ArrayBuffer(1),false),/unsigned CSI cannot be imported unattended/);
  assert.equal(confirmationCount,0,"unattended files never trigger approval prompts");
  await assert.rejects(ctx.dispatch({...candidate,location:"picked"},"csi",new ArrayBuffer(1),false),/CSI dealership and source period were not confirmed/);
  assert.equal(imported,0);
  ctx.window.confirm=()=>{confirmationCount++;return true;};
  await ctx.dispatch({...candidate,location:"picked"},"csi",new ArrayBuffer(1),false);
  assert.equal(imported,1);
  assert.equal(confirmationCount,2);
});

test("an unsigned CSI review marker blocks subsequent unattended replay",()=>{
  const code=production("  function candidateNeedsImport(","  function transientWorkspaceState(");
  const signature="01 - DROP REPORTS HERE/synthetic-csi.csv|3|123";
  const model={autoImport:{seen:{[signature]:{kind:"csi",manualImportRequired:true}}}};
  const ctx=vm.createContext({model});
  vm.runInContext(code,ctx);
  assert.equal(ctx.candidateNeedsImport({signature,location:"inbox"}),false);
  assert.equal(ctx.candidateNeedsImport({signature:signature+"-new",location:"inbox"}),true,
    "a changed file needs a fresh explicit source review");
});

test("CSI source-family origin change preserves JavaScript syntax and durable confidence provenance",()=>{
  new vm.Script(app);
  assert.match(app,/candidate\.csi\.imports\.push\(\{ sourceFile: name, sourceStoreConfidence:"configured-destination-only"/);
});
