"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");

function production(start,end){
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"Real production VIR origin boundary exists: "+start);
  return app.slice(a,b);
}
const scan=production("  async function autoSurveyFolder(","  async function importReturnedWorkbook(");
const dispatch=production("  async function processClassifiedCandidate(","  async function reconcileLearnedFiles(");

test("unattended unsigned VIR is retained for source-store review, never promoted or relocated",async()=>{
  const name="synthetic-vir.csv",signature="01 - DROP REPORTS HERE/"+name+"|4|123";
  const candidate={name,signature,location:"inbox",relativePath:"01 - DROP REPORTS HERE/"+name,
    file:{size:4,lastModified:123,slice:()=>({text:async()=>"advisor name,total ros,vir printed/emailed,vir use %"}),
      arrayBuffer:async()=>new Uint8Array([1,2,3,4]).buffer}};
  const model={autoImport:{seen:{}}},events=[];
  const ctx=vm.createContext({
    model,sourceLocations:new Map(),Map,Set,JSON,Uint8Array,
    AUTO_IMPORT_PATH:["data","auto-import.json"],
    watchCandidates:async()=>[candidate],candidateNeedsImport:()=>true,
    classifyImportFile:async()=> "vir",
    processClassifiedCandidate:async()=>events.push("UNSAFE IMPORT"),
    addHistory:async(kind,_summary,details)=>{
      assert.equal(kind,"vir-review-required");
      assert.equal(details.sourceStoreConfidence,"configured-destination-only");
      events.push("review-history");
    },
    moveToLearn:async()=>events.push("UNSAFE MOVE"),
    writeJson:async()=>events.push("ledger-write"),
    now:()=>"2026-11-04T12:00:00Z",
    recordDiagnostic:()=>{},status:()=>{},scanFiles:async()=>events.push("rescan"),console
  });
  vm.runInContext(scan+"\nthis.scan=autoSurveyFolder;",ctx);
  const result=await ctx.scan();
  assert.equal(result.imported.length,0);
  assert.equal(result.learned.length,0);
  assert.equal(result.reviewRequired.length,1);
  assert.deepEqual(events,["review-history","ledger-write","rescan"]);
  assert.equal(model.autoImport.seen[signature].manualImportRequired,true);
  assert.equal(model.autoImport.seen[signature].sourceStoreConfidence,"configured-destination-only");
});

test("VIR dispatcher cannot bypass review and only deliberate pick asks for approval",async()=>{
  const model={settings:{store:{name:"Synthetic Service Store",code:"9002"}}};
  let imported=0,prompts=0;
  const ctx=vm.createContext({
    model,sourceLocations:new Map(),
    window:{confirm:()=>{prompts++;return false;}},
    importVirFile:async()=>{imported++;},
    ensurePreviousMonthSummary:async()=>{},renderAll:()=>{}
  });
  vm.runInContext(dispatch+"\nthis.dispatch=processClassifiedCandidate;",ctx);
  const candidate={name:"synthetic-vir.csv",location:"inbox"};
  await assert.rejects(ctx.dispatch(candidate,"vir",new ArrayBuffer(1),false),/unsigned VIR cannot be imported unattended/);
  await assert.rejects(ctx.dispatch({...candidate,location:"learn"},"vir",new ArrayBuffer(1),false),/unsigned VIR cannot be imported unattended/);
  assert.equal(prompts,0);
  await assert.rejects(ctx.dispatch({...candidate,location:"picked"},"vir",new ArrayBuffer(1),false),/VIR dealership and source observation were not confirmed/);
  assert.equal(imported,0);
  ctx.window.confirm=()=>{prompts++;return true;};
  await ctx.dispatch({...candidate,location:"picked"},"vir",new ArrayBuffer(1),false);
  assert.equal(imported,1);
  assert.equal(prompts,2);
});

test("manual VIR importer persists only destination-reviewed source ownership",async()=>{
  const source=production("  async function importVirFile(","  function normalizeOperationalCoverage(");
  let recorded=null;
  const ctx=vm.createContext({
    sourceFileHandle:async()=>({getFile:async()=>({
      lastModified:Date.UTC(2026,10,4,12),
      text:async()=>"synthetic"
    })}),
    parseVirCsv:()=>({sourceFile:"synthetic-vir.csv",importedAt:"2026-11-04T12:00:00Z",
      reportDate:"2026-11-04",store:{totalROs:3,used:2,utilization:66.67},advisors:{}}),
    sourceLocations:new Map([["synthetic-vir.csv","picked"]]),
    saveVirSnapshot:async snapshot=>{recorded=structuredClone(snapshot);return{resolved:true};},
    removeSourceEntry:async()=>{throw Error("source must stay");},
    addHistory:async()=>{},
    Date
  });
  vm.runInContext(source+"\nthis.importer=importVirFile;",ctx);
  assert.equal(await ctx.importer("synthetic-vir.csv",false),true);
  assert.equal(recorded.sourceStoreConfidence,"configured-destination-only");
  assert.equal(recorded.sourceLocation,"picked");
  assert.equal(recorded.reportDate,"2026-11-04");
});

test("VIR manual hold cannot replay and dashboard remains syntax-valid",()=>{
  const marker=production("  function candidateNeedsImport(","  function transientWorkspaceState(");
  const signature="01 - DROP REPORTS HERE/synthetic-vir.csv|4|123";
  const model={autoImport:{seen:{[signature]:{kind:"vir",manualImportRequired:true}}}};
  const ctx=vm.createContext({model});
  vm.runInContext(marker,ctx);
  assert.equal(ctx.candidateNeedsImport({signature,location:"inbox"}),false);
  assert.equal(ctx.candidateNeedsImport({signature:signature+"-changed",location:"inbox"}),true);
  new vm.Script(app);
});
