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

test("standalone Appointments Created supplemental CSV cannot bypass store review",async()=>{
  let approved=false,confirms=0,supplementalImports=0;
  const context=vm.createContext({
    model:{settings:{store:{name:"Synthetic Store",code:"9002"}}},
    window:{confirm:()=>{confirms++;return approved;}},
    sourceLocations:new Map(),
    importSupplementalSource:async()=>{supplementalImports++;},
    ensurePreviousMonthSummary:async()=>{},renderAll:()=>{}
  });
  vm.runInContext(dispatch+"\nthis.dispatch=processClassifiedCandidate;",context);
  const candidate={name:"synthetic-created-summary.csv",location:"inbox"};
  await assert.rejects(context.dispatch(candidate,"supplemental-csv",new ArrayBuffer(1),false),/cannot be imported unattended/);
  await assert.rejects(context.dispatch({...candidate,location:"learn"},"supplemental-csv",new ArrayBuffer(1),false),/cannot be imported unattended/);
  await assert.rejects(context.dispatch({...candidate,location:"picked"},"supplemental-csv",new ArrayBuffer(1),false),/date range were not confirmed/);
  assert.equal(supplementalImports,0);
  approved=true;
  await context.dispatch({...candidate,location:"picked"},"supplemental-csv",new ArrayBuffer(1),false);
  assert.equal(supplementalImports,1);
  assert.equal(confirms,2);
});

test("standalone Appointments Created Inbox watcher retains original and review marker",async()=>{
  const name="synthetic-created-summary.csv",signature="01 - DROP REPORTS HERE/"+name+"|4|123";
  let promoted=0,moved=0;
  const candidate={name,signature,location:"inbox",relativePath:"01 - DROP REPORTS HERE/"+name,
    file:{size:4,lastModified:123,slice:()=>({text:async()=>"Summary of Appointments Created"}),
      arrayBuffer:async()=>new Uint8Array([1,2,3,4]).buffer}};
  const model={autoImport:{seen:{}}};
  const context=vm.createContext({
    model,sourceLocations:new Map(),Map,Set,JSON,Uint8Array,
    AUTO_IMPORT_PATH:["data","auto-import.json"],watchCandidates:async()=>[candidate],
    candidateNeedsImport:()=>true,classifyImportFile:async()=>"supplemental-csv",
    processClassifiedCandidate:async()=>{promoted++;},
    addHistory:async(kind,_,details)=>{
      assert.equal(kind,"supplemental-csv-review-required");
      assert.equal(details.sourceStoreConfidence,"configured-destination-only");
    },
    moveToLearn:async()=>{moved++;},
    writeJson:async()=>{},now:()=>"2026-11-04T12:00:00Z",
    recordDiagnostic:()=>{},status:()=>{},scanFiles:async()=>{},console
  });
  vm.runInContext(scan+"\nthis.scan=autoSurveyFolder;",context);
  const result=await context.scan();
  assert.equal(result.imported.length,0);
  assert.equal(result.reviewRequired.length,1);
  assert.equal(promoted,0);
  assert.equal(moved,0);
  assert.equal(model.autoImport.seen[signature].manualImportRequired,true);
});

test("reviewed standalone Appointments Created retains its destination-only confidence after readback",async()=>{
  const importer=production("  async function importSupplementalSource(","  async function processClassifiedCandidate(");
  let durable=null,observed=null;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const model={settings:{store:{code:"9002"}},operationalMetrics:{
    supplementalReports:{snapshots:{}},updatedAt:"before"
  }};
  const context=vm.createContext({
    model,sourceLocations:new Map(),TextDecoder,Uint8Array,Date,
    parseAppointmentsCreatedSummaryCsv:()=>({
      family:"appointments-created-summary",sourceFile:"synthetic-created-summary.csv",
      periodStart:"2026-11-01",periodEnd:"2026-11-04",variant:"service-department",
      importedAt:"2026-11-04T12:00:00Z",metrics:{appointments:3}
    }),
    supplementalSnapshotKey:()=> "created-2026-11-04",
    sourceFileHandle:async()=>({getFile:async()=>({lastModified:Date.UTC(2026,10,4,12)})}),
    pruneSupplementalSnapshots:value=>value,structuredClone:clone,
    OPERATIONAL_METRICS_PATH:["data","operational-metrics.json"],now:()=>"2026-11-04T12:00:00Z",
    writeJson:async(_path,value)=>{durable=clone(value);},
    readJson:async()=>clone(durable),
    addHistory:async()=>{observed=clone(durable);},
    removeSourceEntry:async()=>{throw Error("Original must remain");}
  });
  vm.runInContext(importer+"\nthis.importer=importSupplementalSource;",context);
  await context.importer({name:"synthetic-created-summary.csv",location:"picked"},"supplemental-csv",new Uint8Array([1,2,3]),false);
  assert.equal(durable.supplementalReports.snapshots["created-2026-11-04"].sourceStoreConfidence,"configured-destination-only");
  assert.equal(observed.supplementalReports.snapshots["created-2026-11-04"].sourceStoreConfidence,"configured-destination-only");
});
