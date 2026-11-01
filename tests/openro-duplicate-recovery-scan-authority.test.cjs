"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

// Execute the real Report Inbox recovery branch, not a reimplemented
// state machine. All names, records, bytes and permissions are synthetic.
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const first=app.indexOf("  async function autoSurveyFolder(");
const end=app.indexOf("  async function importReturnedWorkbook(",first);
assert.ok(first>=0&&end>first,"production Report Inbox intake exists");
const production=app.slice(first,end);

function harness(pauseAt="none"){
  const root={name:"Synthetic original Workspace"},other={name:"Synthetic replacement Workspace"};
  const auth={canWrite:true},events=[],bytes=new Uint8Array([1,2,3]).buffer;
  const digest="synthetic-openro-digest",name="synthetic-open-ro.xlsx";
  const prior={updatedAt:"before",records:[],source:{sha256:"old"}};
  const durable={
    updatedAt:"2026-11-01T10:00:00Z",
    records:[{id:"synthetic-1",ro:"900001",advisorCode:"101"}],
    closedRecords:[],
    source:{sha256:digest,importedAt:"2026-11-01T10:00:00Z",
      sourceModifiedAt:"2026-11-01T09:00:00Z"}
  };
  const model={root,state:prior,autoImport:{seen:{}}},signature="inbox|3|123";
  const candidate={name,location:"inbox",relativePath:"Report Inbox/"+name,
    signature,file:{lastModified:123,async arrayBuffer(){return bytes;}}};
  let signal,release;
  const entered=new Promise(resolve=>{signal=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const pause=async phase=>{if(phase===pauseAt){signal();await gate;}};
  let reads=0;
  const ctx=vm.createContext({
    model,sourceLocations:new Map(),AUTO_IMPORT_PATH:["data","auto-import.json"],
    STATE_PATH:["data","state.json"],Map,Set,JSON,Object,Array,Date,DOMException,
    Boolean,Number,Promise,Uint8Array,console,
    watchCandidates:async()=>[candidate],candidateNeedsImport:()=>true,
    classifyImportFile:async()=>"open-ro",
    sha256:async()=>{await pause("digest");return digest;},
    readJson:async()=>{reads++;await pause(reads===1?"readback":"final-readback");
      return JSON.parse(JSON.stringify(durable));},
    prepareXlsxWorkbook:async()=>{await pause("workbook");return {SheetNames:["Synthetic"]};},
    legacyReport:()=>({verification:"group totals and global rows returned reconciled",
      workloadRecords:durable.records}),
    retainDailyReport:async()=>{events.push("retain-daily");await pause("daily-report");},
    saveOpenRoWorkload:async()=>{events.push("save-workload");await pause("workload");},
    openRoWorkloadSnapshot:()=>({sourceType:"open-ro"}),
    ensureDailyFocus:async()=>{events.push("daily-focus");await pause("focus");},
    writeJson:async()=>{events.push("ledger-write");await pause("ledger");},
    removeSourceEntryWithByteGuard:async()=>{events.push("source-remove");await pause("remove");},
    coverageTimestamp:()=>"2026-11-01",now:()=>"2026-11-01T11:00:00Z",
    recordDiagnostic:()=>{},status:()=>events.push("status"),scanFiles:async()=>{},
    processClassifiedCandidate:async()=>{throw Error("Committed source must not reimport");},
    transientIntakeError:()=>false,moveToLearn:async()=>{events.push("unexpected-move");}
  });
  vm.runInContext(production+"\nthis.scan=autoSurveyFolder;",ctx);
  return {model,prior,other,auth,events,entered,release:()=>release(),signature,
    scan:()=>ctx.scan(null,()=>model.root===root&&auth.canWrite)};
}

for(const phase of ["digest","readback","workbook","daily-report","workload","focus","final-readback","ledger"]){
  test("stale Workspace during Open RO recovery "+phase+" does not advance source cleanup",async()=>{
    const h=harness(phase);
    const pending=h.scan();
    await h.entered;
    h.model.root=h.other;
    h.release();
    assert.equal(await pending,null,"stale scan must not claim completion");
    assert.equal(h.events.includes("source-remove"),false,
      "a new Workspace must never receive the old source removal");
    assert.equal(h.events.includes("status"),false);
    if(["digest","readback"].includes(phase))
      assert.equal(h.model.state,h.prior,"old-root readback cannot overwrite replacement state");
    if(phase==="workbook")assert.equal(h.events.includes("retain-daily"),false);
    if(phase==="daily-report")assert.equal(h.events.includes("save-workload"),false);
    if(phase==="workload")assert.equal(h.events.includes("daily-focus"),false);
    if(phase==="final-readback")assert.equal(h.events.includes("ledger-write"),false);
    if(phase==="ledger")
      assert.equal(h.model.autoImport.seen[h.signature]?.cleanupPending,true,
        "uncertain source cleanup must retain its pending intent");
  });
}

test("authority revocation while source removal awaits cannot report clean completion",async()=>{
  const h=harness("remove");
  const pending=h.scan();
  await h.entered;
  h.auth.canWrite=false;
  h.release();
  assert.equal(await pending,null);
  assert.equal(h.events.filter(e=>e==="source-remove").length,1,
    "an already-started removal is not claimed cancellable");
  assert.equal(h.model.autoImport.seen[h.signature].cleanupPending,true);
  assert.equal(h.events.includes("status"),false);
});

test("eligible committed Open RO recovery still repairs projections and removes source once",async()=>{
  const h=harness();
  const result=await h.scan();
  assert.equal(result.cleaned.length,1);
  assert.equal(h.events.filter(e=>e==="retain-daily").length,1);
  assert.equal(h.events.filter(e=>e==="save-workload").length,1);
  assert.equal(h.events.filter(e=>e==="daily-focus").length,1);
  assert.equal(h.events.filter(e=>e==="source-remove").length,1);
  assert.equal(h.model.state.records[0].ro,"900001");
  assert.equal(h.model.autoImport.seen[h.signature].cleanupPending,false);
  assert.equal(h.model.autoImport.seen[h.signature].cleanupSha256,undefined);
  assert.equal(h.events.filter(e=>e==="ledger-write").length,2);
});
