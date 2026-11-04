"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function production(start,end){
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"Real production SAPR intake boundary exists: "+start);
  return app.slice(a,b);
}
const scanSource=production("  async function autoSurveyFolder(","  async function importReturnedWorkbook(");
const dispatcher=production("  async function processClassifiedCandidate(","  async function reconcileLearnedFiles(");

test("unsigned SAPR in Report Inbox is held for explicit manager source-store review",async()=>{
  const name="synthetic-sapr.xlsx",signature="01 - DROP REPORTS HERE/"+name+"|3|123";
  const candidate={name,signature,location:"inbox",relativePath:"01 - DROP REPORTS HERE/"+name,
    file:{lastModified:123,async arrayBuffer(){return new Uint8Array([1,2,3]).buffer;}}};
  const events=[],model={autoImport:{seen:{}}};
  const ctx=vm.createContext({
    model,sourceLocations:new Map(),Map,Set,JSON,Uint8Array,
    AUTO_IMPORT_PATH:["data","auto-import.json"],
    watchCandidates:async()=>[candidate],candidateNeedsImport:()=>true,
    classifyImportFile:async()=> "performance",
    processClassifiedCandidate:async()=>events.push("UNSAFE IMPORT"),
    addHistory:async()=>events.push("review-history"),
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
  assert.equal(model.autoImport.seen[signature].kind,"performance");
});

test("unattended dispatcher cannot directly bypass SAPR source review",async()=>{
  const ctx=vm.createContext({});
  vm.runInContext(dispatcher+"\nthis.dispatch=processClassifiedCandidate;",ctx);
  await assert.rejects(ctx.dispatch({name:"synthetic-sapr.xlsx",location:"inbox"},
    "performance",new ArrayBuffer(1),true),/SAPR source dealership is not verified/);
  await assert.rejects(ctx.dispatch({name:"synthetic-sapr.xlsx",location:"root"},
    "performance",new ArrayBuffer(1),true),/SAPR source dealership is not verified/);
});

test("review-pending and reviewed SAPR files never reimport on the next watcher poll",()=>{
  const source=production("  function candidateNeedsImport(","  function transientWorkspaceState(");
  const signature="01 - DROP REPORTS HERE/synthetic-sapr.xlsx|3|123",model={autoImport:{seen:{
    [signature]:{kind:"performance",manualImportRequired:true}
  }}};
  const ctx=vm.createContext({model});
  vm.runInContext(source,ctx);
  const candidate={signature,location:"inbox"};
  assert.equal(ctx.candidateNeedsImport(candidate),false);
  model.autoImport.seen[signature]={kind:"performance",manualImportRequired:false,importedAt:"2026-11-04T12:00:00Z"};
  assert.equal(ctx.candidateNeedsImport(candidate),false);
  assert.equal(ctx.candidateNeedsImport({...candidate,signature:signature+"-changed"}),true,
    "changed source bytes must return for manual review");
  model.autoImport.seen[signature].cleanupPending=true;
  assert.equal(ctx.candidateNeedsImport(candidate),true,
    "separate previously verified cleanup retry remains eligible");
});

test("the full dashboard source remains syntax-valid",()=>{
  new vm.Script(app);
});
