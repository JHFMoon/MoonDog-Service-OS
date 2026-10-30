"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const slice=(start,end)=>{
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"Missing production function boundary: "+start);
  return app.slice(a,b);
};
const source=(start,end,globals)=>{
  const ctx=vm.createContext(globals);
  vm.runInContext(slice(start,end),ctx);
  return ctx;
};
const fakeEntries=names=>({
  async *entries(){for(const name of names)yield[name,{kind:"file"}];}
});

test("watch hands off a recognized complete grouped Open RO workbook without manual review",async()=>{
  const name="Synthetic grouped Open RO.xlsx",signature="inbox|synthetic";
  const entry={name,signature,location:"inbox",relativePath:"01 - DROP REPORTS HERE/"+name,
    file:{lastModified:1,arrayBuffer:async()=>new ArrayBuffer(2)}};
  const calls={imported:0,moved:0,scanned:0,saved:0};
  const ctx=source("  async function autoSurveyFolder(","  async function importReturnedWorkbook(",{
    watchCandidates:async()=>[entry],candidateNeedsImport:()=>true,
    sourceLocations:new Map(),model:{state:{source:{}},autoImport:{seen:{}}},
    classifyImportFile:async()=> "open-ro",
    processClassifiedCandidate:async()=>{calls.imported++;},
    moveToLearn:async()=>{calls.moved++;throw Error("Should not move successfully ingested report");},
    now:()=>"2026-10-29T10:00:00Z",readJson:async()=>({source:{sha256:"old"}}),
    STATE_PATH:["data","state.json"],
    writeJson:async()=>{calls.saved++;},AUTO_IMPORT_PATH:["data","auto-import.json"],
    recordDiagnostic:()=>{},addHistory:async()=>{},
    status:()=>{},scanFiles:async()=>{calls.scanned++;},
    sha256:async()=>"",TextDecoder
  });
  const result=await ctx.autoSurveyFolder();
  assert.equal(result.imported.length,1);
  assert.equal(result.learned.length,0);
  assert.equal(result.reviewRequired.length,0);
  assert.equal(calls.imported,1);
  assert.equal(calls.moved,0);
  assert.equal(calls.scanned,0);
  assert.equal(calls.saved,1);
  assert.equal(ctx.model.autoImport.seen[signature].manualImportRequired,undefined);
});

test("old manual-review markers do not block a now-eligible Open RO import",()=>{
  const signature="inbox|same";
  const ctx=source("  function candidateNeedsImport(","  function transientWorkspaceState(",{
    model:{autoImport:{seen:{[signature]:{kind:"open-ro",manualImportRequired:true}}}}
  });
  assert.equal(ctx.candidateNeedsImport({signature,location:"inbox"}),true);
  assert.equal(ctx.candidateNeedsImport({signature:"inbox|changed",location:"inbox"}),true);
  assert.equal(ctx.candidateNeedsImport({signature,location:"root"}),false);
  assert.equal(ctx.candidateNeedsImport({signature:"root|new",location:"root"}),true);
  ctx.model.autoImport.seen[signature].manualImportRequired=false;
  ctx.model.autoImport.seen[signature].importedAt="2026-10-27T12:00:00Z";
  assert.equal(ctx.candidateNeedsImport({signature,location:"inbox"}),true,
    "a still present imported Open RO must be checked for exact duplicate cleanup");
});

test("manual report picker recovers previously misrouted Open RO without surfacing unrelated learn files",async()=>{
  const seen={"old-inbox|synthetic":{storedAs:"synthetic-learned.xlsx",
    diagnostic:"Needs Review: an unsigned complete RO report requires explicit source, date and completeness review."}};
  const items=[];
  const ui={sourceSelect:{
    replaceChildren(...xs){items.splice(0,items.length,...xs);},
    add(x){items.push(x);},
    disabled:true
  },importButton:{disabled:true}};
  const locations=new Map();
  const ctx=source("  async function reportInboxEntries() {","  async function scanPerformanceFiles(inboxSnapshot=null)",{
    reportInbox:async()=>fakeEntries(["new-open-ro.xlsx"]),
    directory:async()=>fakeEntries(["synthetic-learned.xlsx","unrecognized-financial.xlsx"]),
    model:{autoImport:{seen},root:fakeEntries(["Service Operations Returned.xlsx"])},
    returnedWorkbookCandidate:name=>name.startsWith("Service Operations"),
    sourceLocations:locations,ui,
    Option:function Option(label,value){this.text=label;this.value=value;}
  });
  await ctx.scanFiles();
  const choices=items.filter(i=>i.value).map(i=>i.value);
  assert.deepEqual(choices,["new-open-ro.xlsx","Service Operations Returned.xlsx","synthetic-learned.xlsx"]);
  assert.equal(locations.get("synthetic-learned.xlsx"),"learn");
  assert.equal(ui.sourceSelect.disabled,false);
  assert.equal(ui.importButton.disabled,true);
  assert.ok(items.some(x=>x.text.includes("Files To Learn")));
  assert.ok(!choices.includes("unrecognized-financial.xlsx"));
});

test("successful explicit Open RO import clears only its matching inbox review flag",async()=>{
  const name="Synthetic grouped Open RO.xlsx",modified=55,size=1234,importedAt="2026-10-27T12:00:00Z";
  const signature="01 - DROP REPORTS HERE/"+name+"|"+size+"|"+modified;
  const prior={kind:"open-ro",manualImportRequired:true,queuedAt:"2026-10-27T11:00:00Z"};
  const model={autoImport:{seen:{[signature]:prior}}};
  const writes=[];
  const ctx=source("  async function markOpenRoManualReviewComplete(", "  async function verifyCompleteRoImport(",{
    model,sourceLocations:new Map([[name,"inbox"]]),
    REPORT_INBOX:"01 - DROP REPORTS HERE",AUTO_IMPORT_PATH:["data","auto-import.json"],
    writeJson:async(path,value)=>{writes.push({path,value});}
  });
  const done=await ctx.markOpenRoManualReviewComplete(name,{size,lastModified:modified},importedAt);
  assert.equal(done,true);
  assert.equal(writes.length,1);
  assert.equal(ctx.model.autoImport.seen[signature].manualImportRequired,false);
  assert.equal(ctx.model.autoImport.seen[signature].importedAt,importedAt);
  assert.equal(await ctx.markOpenRoManualReviewComplete(name,{size,lastModified:modified},importedAt),false);
  assert.equal(writes.length,1);
  assert.equal(prior.manualImportRequired,true,"prior object is not mutated before durable persistence");
});

test("production script remains syntactically valid",()=>{
  new vm.Script(app);
});