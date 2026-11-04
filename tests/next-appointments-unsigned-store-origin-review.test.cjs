"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function production(start,end){
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"Production Next Appointments source review is testable: "+start);
  return app.slice(a,b);
}
const scan=production("  async function autoSurveyFolder(","  async function importReturnedWorkbook(");
const dispatch=production("  async function processClassifiedCandidate(","  async function reconcileLearnedFiles(");

test("unsigned Next Appointments Inbox source waits for explicit store review",async()=>{
  const name="synthetic-next-appointments.csv",signature="01 - DROP REPORTS HERE/"+name+"|4|123",events=[];
  const candidate={name,signature,location:"inbox",relativePath:"01 - DROP REPORTS HERE/"+name,
    file:{size:4,lastModified:123,slice:()=>({text:async()=>"Next Appointments Scheduled Summary"}),
      arrayBuffer:async()=>new Uint8Array([1,2,3,4]).buffer}};
  const model={autoImport:{seen:{}}};
  const ctx=vm.createContext({
    model,sourceLocations:new Map(),Map,Set,JSON,Uint8Array,
    AUTO_IMPORT_PATH:["data","auto-import.json"],
    watchCandidates:async()=>[candidate],candidateNeedsImport:()=>true,
    classifyImportFile:async()=>"next-appointments",
    processClassifiedCandidate:async()=>events.push("UNSAFE IMPORT"),
    addHistory:async(kind,_description,details)=>{
      assert.equal(kind,"next-appointments-review-required");
      assert.equal(details.sourceStoreConfidence,"configured-destination-only");
      events.push("review-history");
    },
    moveToLearn:async()=>events.push("UNSAFE MOVE"),
    writeJson:async()=>events.push("ledger-write"),
    now:()=>"2026-11-04T12:00:00Z",
    recordDiagnostic:()=>{},status:()=>{},scanFiles:async()=>events.push("rescan"),console
  });
  vm.runInContext(scan+"\nthis.scan=autoSurveyFolder;",ctx);
  const outcome=await ctx.scan();
  assert.equal(outcome.imported.length,0);
  assert.equal(outcome.learned.length,0);
  assert.equal(outcome.reviewRequired.length,1);
  assert.deepEqual(events,["review-history","ledger-write","rescan"]);
  assert.equal(model.autoImport.seen[signature].manualImportRequired,true);
  assert.equal(model.autoImport.seen[signature].sourceStoreConfidence,"configured-destination-only");
});

test("unattended dispatcher cannot bypass manager confirmation of Next Appointments source",async()=>{
  let imports=0,confirms=0,yes=false;
  const ctx=vm.createContext({
    model:{settings:{store:{name:"Synthetic BMW Store",code:"9002"}}},
    window:{confirm:()=>{confirms++;return yes;}},
    sourceLocations:new Map(),
    importNextAppointmentsFile:async()=>{imports++;},
    ensurePreviousMonthSummary:async()=>{},renderAll:()=>{}
  });
  vm.runInContext(dispatch+"\nthis.dispatch=processClassifiedCandidate;",ctx);
  const candidate={name:"synthetic-next-appointments.csv",location:"inbox"};
  await assert.rejects(ctx.dispatch(candidate,"next-appointments",new ArrayBuffer(1),false),/cannot be imported unattended/);
  await assert.rejects(ctx.dispatch({...candidate,location:"learn"},"next-appointments",new ArrayBuffer(1),false),/cannot be imported unattended/);
  assert.equal(imports,0);
  assert.equal(confirms,0);
  await assert.rejects(ctx.dispatch({...candidate,location:"picked"},"next-appointments",new ArrayBuffer(1),false),/date range were not confirmed/);
  assert.equal(imports,0);
  yes=true;
  await ctx.dispatch({...candidate,location:"picked"},"next-appointments",new ArrayBuffer(1),false);
  assert.equal(imports,1);
  assert.equal(confirms,2);
});

test("manual-review marker blocks repeat auto-intake, changed file returns to review",()=>{
  const candidateCode=production("  function candidateNeedsImport(","  function transientWorkspaceState(");
  const signature="01 - DROP REPORTS HERE/synthetic-next-appointments.csv|4|123";
  const ctx=vm.createContext({model:{autoImport:{seen:{[signature]:{
    kind:"next-appointments",manualImportRequired:true
  }}}}});
  vm.runInContext(candidateCode,ctx);
  assert.equal(ctx.candidateNeedsImport({signature,location:"inbox"}),false);
  assert.equal(ctx.candidateNeedsImport({signature:signature+"-changed",location:"inbox"}),true);
  new vm.Script(app);
});
