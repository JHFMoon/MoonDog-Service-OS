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


test("manual Performance picker retains Inbox ownership for exact reviewed-source marker",async()=>{
  const code=production("  async function scanPerformanceFiles(","  async function scanAppointmentAndPerformanceFiles(");
  const name="synthetic-sapr.xlsx",locations=new Map(),optionRows=[];
  const makeSelect=()=>({
    replaceChildren(...rows){optionRows.splice(0,optionRows.length,...rows);},
    add(row){optionRows.push(row);},disabled:true
  });
  const ui={performanceSourceSelect:makeSelect(),importPerformance:{disabled:true}};
  const ctx=vm.createContext({
    sourceLocations:locations,ui,
    Option:function Option(label,value){this.label=label;this.value=value;},
    reportInboxEntries:async()=>[[name,{kind:"file"}],["Notes.pdf",{kind:"file"}]]
  });
  vm.runInContext(code+"\nthis.scanPerformanceFiles=scanPerformanceFiles;",ctx);
  await ctx.scanPerformanceFiles();
  assert.equal(locations.get(name),"inbox");
  assert.equal(ui.performanceSourceSelect.disabled,false);
  assert.ok(optionRows.some(row=>row.value===name));
  assert.ok(!locations.has("Notes.pdf"));
});

test("confirmed SAPR writes exact Inbox review completion only after full readback",async()=>{
  const source=production("  async function importPerformanceFile(","  function performanceFormat(");
  const name="synthetic-sapr.xlsx",modified=123,size=3,events=[];
  const signature="01 - DROP REPORTS HERE/"+name+"|"+size+"|"+modified;
  const performance={snapshots:{},updatedAt:"before"};
  const model={
    settings:{store:{name:"Synthetic Store",code:"9001"}},
    performance:structuredClone(performance),
    autoImport:{seen:{[signature]:{kind:"performance",manualImportRequired:true,queuedAt:"prior"}}}
  };
  let written=null,ledger=null;
  const ctx=vm.createContext({
    model,structuredClone,Map,Set,Date,
    ui:{performanceSourceSelect:{value:name}},sourceLocations:new Map([[name,"inbox"]]),
    REPORT_INBOX:"01 - DROP REPORTS HERE",
    PERFORMANCE_PATH:["data","performance.json"],AUTO_IMPORT_PATH:["data","auto-import.json"],
    status:()=>{},
    sourceFileHandle:async()=>({getFile:async()=>({
      size,lastModified:modified,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer
    })}),
    parsePerformanceWorkbook:()=>({
      date:"2026-11-04",periodStart:"2026-11-01",periodEnd:"2026-11-04",
      advisors:{"101":{cpGross:10}},store:{},validation:{source:"synthetic"}
    }),
    prunePerformanceSnapshots:x=>x,now:()=>"2026-11-04T21:00:00Z",
    window:{confirm:()=>{events.push("manager-review");return true;}},
    writeJson:async(path,value)=>{
      if(path[1]==="performance.json"){written=structuredClone(value);events.push("save-performance");}
      else {ledger=structuredClone(value);events.push("save-review-marker");}
    },
    readJson:async()=>structuredClone(written),
    addHistory:async()=>events.push("history"),
    renderPerformance:()=>events.push("render"),
    dailyPickedSources:new Set([name]),scanFiles:async()=>{},
    scanAppointmentFiles:async()=>{},scanPerformanceFiles:async()=>{}
  });
  vm.runInContext(source+"\nthis.importer=importPerformanceFile;",ctx);
  await ctx.importer(name,false);
  assert.equal(written.snapshots["2026-11-04"].sourceStoreConfidence,"configured-destination-only");
  assert.equal(ledger.seen[signature].manualImportRequired,false);
  assert.equal(ledger.seen[signature].sourceStoreConfidence,"configured-destination-only");
  assert.deepEqual(events,["manager-review","save-performance","save-review-marker","history","render"]);
  assert.equal(model.autoImport.seen[signature].manualImportRequired,false);
});

test("the full dashboard source remains syntax-valid",()=>{
  new vm.Script(app);
});
