"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),
  fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),
  crypto=require("node:crypto");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function section(start,end){
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"Missing production boundary: "+start);
  return app.slice(a,b);
}
const sha256=async input=>crypto.createHash("sha256").update(Buffer.from(input)).digest("hex");
const equal=(a,b)=>Buffer.from(a).equals(Buffer.from(b));
const bytes=new Uint8Array([41,42,43]).buffer;

test("unattended full RO verification requires exact bytes, unique ROs and forward source time, but not a dialog",async()=>{
  const code=section("  async function verifyCompleteRoImport(","  async function importCdkRepairOrdersDocxUnlocked(");
  const current={bytes,modified:Date.now()},model={state:{records:[],source:{}}};
  const context={text:x=>String(x??""),model,sha256,Date,Set,
    sourceFileHandle:async()=>({getFile:async()=>({arrayBuffer:async()=>current.bytes})}),
    window:{confirm:()=>{throw Error("Automatic import cannot ask for confirmation");}}};
  vm.runInNewContext(code,context);
  const good=await context.verifyCompleteRoImport("synthetic-openro.xlsx",
    {lastModified:current.modified},bytes,[{ro:"900001"}],true);
  assert.equal(good.sha256,await sha256(bytes));
  assert.match(good.verification,/reconciled-grouped-inbox-auto/);
  await assert.rejects(context.verifyCompleteRoImport("synthetic-openro.xlsx",
    {lastModified:current.modified},bytes,[{ro:"900001"},{ro:"900001"}],true),/duplicate/);
  model.state.source={sha256:good.sha256};
  await assert.rejects(context.verifyCompleteRoImport("synthetic-openro.xlsx",
    {lastModified:current.modified},bytes,[{ro:"900001"}],true),/already imported/);
  model.state.source={};current.bytes=new Uint8Array([99]).buffer;
  await assert.rejects(context.verifyCompleteRoImport("synthetic-openro.xlsx",
    {lastModified:current.modified},bytes,[{ro:"900001"}],true),/changed/);
});

test("watch dispatches verified full XLSX automatically and blocks non-inbox Open RO",async()=>{
  const code=section("  async function processClassifiedCandidate(","  async function reconcileLearnedFiles(");
  const params=[],candidate={name:"synthetic-openro.xlsx",location:"inbox",signature:"synthetic",
    relativePath:"01 - DROP REPORTS HERE/synthetic-openro.xlsx"};
  const ctx={sourceLocations:new Map(),xlsxSourceDeleteGuards:new Map(),autoSourceDeleteContext:new Map(),
    sameByteContent:equal,sourceFileHandle:async()=>({getFile:async()=>({arrayBuffer:async()=>bytes})}),
    importSource:async(...args)=>params.push(args),
    ensurePreviousMonthSummary:async()=>{},renderAll:()=>{},Map,Boolean};
  vm.runInNewContext(code,ctx);
  await ctx.processClassifiedCandidate(candidate,"open-ro",bytes,true);
  assert.equal(params.length,1);
  assert.deepEqual(params[0],["synthetic-openro.xlsx",true,bytes,true]);
  assert.equal(ctx.autoSourceDeleteContext.size,0);
  await assert.rejects(ctx.processClassifiedCandidate({...candidate,location:"root"},"open-ro",bytes,true),
    /only the dedicated Inbox/);
  await assert.rejects(ctx.processClassifiedCandidate(candidate,"open-ro-docx",bytes,true),
    /DOCX source is not yet authorized/);
});

test("real Open RO importer saves verified grouped snapshot, preserves commitments, then deletes source",async()=>{
  const code=section("  async function importSourceUnlocked(","  const timeMinutes =");
  const priorManagement={nextAction:"Call customer",reviewDate:"2026-10-30",owner:"SYNTHETIC"};
  const incoming=[{id:"synthetic-1",ro:"900001",advisorCode:"101",management:undefined}];
  const prior={id:"synthetic-1",ro:"900001",advisorCode:"101",management:priorManagement};
  const state={records:[prior],closedRecords:[],source:{sha256:"prior"},updatedAt:"before"};
  const model={state},events=[];
  const file={lastModified:Date.now(),size:3,arrayBuffer:async()=>bytes};
  const workbook={SheetNames:["Synthetic"],Sheets:{Synthetic:{rows:[]}}};
  const ctx={model,ui:{sourceSelect:{value:"synthetic-openro.xlsx"}},
    sourceLocations:new Map([["synthetic-openro.xlsx","inbox"]]),
    status:()=>{},sourceFileHandle:async()=>({getFile:async()=>file}),
    prepareXlsxWorkbook:async()=>workbook,workbookIsHandoff:()=>false,
    workbookHasReturnSchema:()=>false,workbookHasReturnIdentity:()=>false,
    legacyReport:()=>({records:incoming,sheetName:"Synthetic",
      verification:"group totals and global rows returned reconciled",format:"Open ROs by advisor - reconciled",advisorSections:1}),
    verifyCompleteRoImport:async(_name,_file,_bytes,_rows,auto)=>{
      assert.equal(auto,true);events.push("verified");return{sha256:await sha256(bytes),verification:"reconciled-grouped-inbox-auto"};},
    reconcileRecordSourceIdentity:()=>{},now:()=> "2026-10-29T15:00:00.000Z",
    mergeCompleteOpenRoRecords:()=>({records:[{...incoming[0],management:priorManagement}],closedRecords:[],closedCount:0,reopenedCount:0}),
    markSupervisorWorkbookStale:async()=>{events.push("stale");},backupState:async()=>{events.push("backup");},
    XLSX:{utils:{sheet_to_json:()=>[]}},internalObservationDate:()=> "2026-10-29",
    writeJson:async(_path,value)=>{events.push("durable-state");model.state=value;},
    STATE_PATH:["data","state.json"],retainDailyReport:async()=>{events.push("report-history");},
    coverageTimestamp:()=> "2026-10-29",saveOpenRoWorkload:async()=>{events.push("workload");},
    openRoWorkloadSnapshot:()=>({}),ensureDailyFocus:async()=>{},
    addHistory:async()=>{events.push("import-history");},
    markOpenRoManualReviewComplete:async()=>{throw Error("Auto import must not add manual marker");},
    renderAll:()=>{},dailyPickedSources:new Map(),
    removeSourceEntryWithByteGuard:async(name,current)=>{
      assert.equal(name,"synthetic-openro.xlsx");assert.ok(equal(current,bytes));
      events.push("delete");
    },scanFiles:async()=>{},Date,Map};
  vm.runInNewContext(code,ctx);
  await ctx.importSourceUnlocked("synthetic-openro.xlsx",true,bytes,true);
  assert.equal(model.state.records[0].management.nextAction,"Call customer");
  assert.match(model.state.source.verification,/reconciled-grouped-inbox-auto/);
  assert.ok(events.indexOf("durable-state")>=0);
  assert.ok(events.indexOf("delete")>events.indexOf("import-history"));
  assert.ok(events.indexOf("backup")<events.indexOf("durable-state"));
});

test("automatic Open RO rejects generic/unverified workbook before any write",async()=>{
  const code=section("  async function importSourceUnlocked(","  const timeMinutes =");
  let writes=0;
  const ctx={model:{state:{records:[{ro:"before"}]}},ui:{sourceSelect:{value:"synthetic.xlsx"}},
    status:()=>{},sourceFileHandle:async()=>({getFile:async()=>({lastModified:Date.now(),arrayBuffer:async()=>bytes})}),
    prepareXlsxWorkbook:async()=>({SheetNames:["Detail"],Sheets:{Detail:{rows:[]}}}),
    workbookIsHandoff:()=>false,workbookHasReturnSchema:()=>false,workbookHasReturnIdentity:()=>false,
    legacyReport:()=>null,findTable:()=>({sheetName:"Detail",rows:[{ro:"900001"}]}),
    sourceLocations:new Map([["synthetic.xlsx","inbox"]]),writeJson:async()=>{writes++;}};
  vm.runInNewContext(code,ctx);
  await assert.rejects(ctx.importSourceUnlocked("synthetic.xlsx",true,bytes,true),/count-reconciled grouped/);
  assert.equal(writes,0);
});

test("a matching current durable Open RO duplicate is deleted without replaying or rewriting the roster",async()=>{
  const code=section("  async function autoSurveyFolder(","  async function importReturnedWorkbook(");
  const digest=await sha256(bytes),name="OPENRO1029.xlsx";
  const entry={name,location:"inbox",relativePath:"01 - DROP REPORTS HERE/"+name,
    signature:"01 - DROP REPORTS HERE/"+name+"|3|100",file:{lastModified:100,arrayBuffer:async()=>bytes}};
  const state={records:[{ro:"900001"}],source:{sha256:digest,importedAt:"2026-10-29"}};
  const model={state,autoImport:{seen:{}}};
  let replay=0,removed=0,ledger=0;
  const dependencies=[];
  const ctx={model,sourceLocations:new Map(),sha256,
    watchCandidates:async()=>[entry],candidateNeedsImport:()=>true,
    classifyImportFile:async()=> "open-ro",
    processClassifiedCandidate:async()=>{replay++;throw Error("Duplicate must never replay");},
    readJson:async()=>JSON.parse(JSON.stringify(state)),STATE_PATH:["data","state.json"],
    prepareXlsxWorkbook:async()=>({SheetNames:["Synthetic"],Sheets:{Synthetic:{}}}),
    legacyReport:()=>({verification:"group totals and global rows returned reconciled",workloadRecords:[{ro:"900001",advisorCode:"101"}]}),
    retainDailyReport:async()=>{dependencies.push("daily");},
    saveOpenRoWorkload:async()=>{dependencies.push("assign");},
    openRoWorkloadSnapshot:()=>({sourceType:"open-ro",records:[]}),
    ensureDailyFocus:async()=>{dependencies.push("focus");},
    coverageTimestamp:()=> "2026-10-29",
    writeJson:async()=>{ledger++;},AUTO_IMPORT_PATH:["data","auto-import.json"],
    removeSourceEntryWithByteGuard:async(_name,current)=>{assert.ok(equal(current,bytes));removed++;},
    now:()=> "2026-10-29",recordDiagnostic:()=>{},status:()=>{},scanFiles:async()=>{},
    TextDecoder,Uint8Array,Map,Set,JSON};
  vm.runInNewContext(code,ctx);
  const outcome=await ctx.autoSurveyFolder();
  assert.equal(replay,0);assert.equal(removed,1);assert.ok(ledger>=2);
  assert.deepEqual(dependencies,["daily","assign","focus"]);
  assert.equal(outcome.cleaned.length,1);
  assert.equal(model.autoImport.seen[entry.signature].cleanupPending,false);
});

test("an unverified current RO duplicate cannot be deleted when durable state differs",async()=>{
  const code=section("  async function autoSurveyFolder(","  async function importReturnedWorkbook(");
  const digest=await sha256(bytes),name="OPENRO1029.xlsx";
  const entry={name,location:"inbox",relativePath:"01 - DROP REPORTS HERE/"+name,
    signature:"inbox|3|100",file:{lastModified:100,arrayBuffer:async()=>bytes}};
  const model={state:{records:[{ro:"900001"}],source:{sha256:digest}},autoImport:{seen:{}}};
  let removed=0,moveCalls=0;
  const ctx={model,sourceLocations:new Map(),sha256,now:()=> "2026-10-29",
    watchCandidates:async()=>[entry],candidateNeedsImport:()=>true,
    classifyImportFile:async()=> "open-ro",
    processClassifiedCandidate:async()=>{throw Error("Must not import duplicate");},
    readJson:async()=>({source:{sha256:"different"},records:model.state.records}),
    STATE_PATH:["data","state.json"],AUTO_IMPORT_PATH:["data","auto-import.json"],
    transientIntakeError:e=>/read-back/.test(e.message),moveToLearn:async()=>{moveCalls++;},
    removeSourceEntryWithByteGuard:async()=>{removed++;},
    writeJson:async()=>{},recordDiagnostic:()=>{},status:()=>{},scanFiles:async()=>{},
    TextDecoder,Uint8Array,Map,Set,JSON};
  vm.runInNewContext(code,ctx);
  const result=await ctx.autoSurveyFolder();
  assert.equal(removed,0);assert.equal(moveCalls,0);
  assert.equal(result.retained.length,1);
});

test("invalid grouped RO layout fails classification instead of becoming supplemental data",async()=>{
  const code=section("  async function classifyImportFile(","  async function moveToLearn(");
  const book={SheetNames:["Synthetic"],Sheets:{Synthetic:{rows:[
    ["SVCADV : 101 (2 items)"],[null,"REPORT OF OPEN ROS BY ADVISOR - 3 Rows Returned"]]}}};
  let supplemental=0;
  const ctx={XLSX:{utils:{sheet_to_json:sheet=>sheet.rows}},prepareXlsxWorkbook:async()=>book,
    workbookIsHandoff:()=>false,workbookHasReturnSchema:()=>false,workbookHasReturnIdentity:()=>false,
    parseCsiWorkbook:()=>{throw Error("Other type");},parseMenuSalesWorkbook:()=>{throw Error("Other type");},
    parsePerformanceWorkbook:()=>{throw Error("Other type");},parseSorWorkbook:()=>{throw Error("Other type");},
    parseAppointmentActivityWorkbook:()=>{throw Error("Other type");},
    parseEfficiencyWorkbook:()=>{throw Error("Other type");},
    parseMediaAsrWorkbook:()=>{throw Error("Other type");},
    parseOpenRoSummaryWorkbook:()=>{throw Error("Other type");},
    matchingTradeArReportLayout:()=>false,
    legacyReport:()=>{throw Error("Needs Review: grouped source count mismatch");},
    parseSupplementalWorkbook:()=>{supplemental++;return {};},
    norm:x=>String(x??"").toLowerCase(),text:x=>String(x??"")};
  vm.runInNewContext(code,ctx);
  await assert.rejects(ctx.classifyImportFile("synthetic.xlsx",{},bytes),/grouped source count mismatch/);
  assert.equal(supplemental,0);
});

test("Files To Learn requires byte-verified staging before original deletion",async()=>{
  const code=section("  async function moveToLearn(","  const PDF_READ_TIMEOUT_MS=");
  for(const corrupted of [false,true]){
    const name="synthetic-invalid.xlsx",stored=new Map(),events=[],original=new Uint8Array([1,2,3]);
    const folder={
      async getFileHandle(target){
        if(!stored.has(target))throw Object.assign(Error("missing"),{name:"NotFoundError"});
        return{getFile:async()=>({arrayBuffer:async()=>stored.get(target).buffer})};
      }
    };
    const item={name,location:"inbox",relativePath:"01 - DROP REPORTS HERE/"+name,
      signature:"01 - DROP REPORTS HERE/"+name+"|3|100"};
    const sourceFile={size:3,lastModified:100,arrayBuffer:async()=>original.buffer};
    const ctx={sourceLocations:new Map(),sourceFileHandle:async()=>({getFile:async()=>sourceFile}),
      directory:async()=>folder,
      writeBytes:async(parts,current)=>{stored.set(parts[1],corrupted?new Uint8Array([7,8,9]):new Uint8Array(current));events.push("copy");},
      sameByteContent:equal,
      removeSourceEntryWithByteGuard:async()=>{events.push("remove");},
      addHistory:async()=>{events.push("history");},
      Map,Uint8Array};
    vm.runInNewContext(code,ctx);
    if(corrupted){
      await assert.rejects(ctx.moveToLearn(item,"Invalid counts"),/did not verify/);
      assert.deepEqual(events,["copy"]);
    }else{
      const moved=await ctx.moveToLearn(item,"Invalid counts");
      assert.equal(moved,name);assert.deepEqual(events,["copy","remove","history"]);
    }
  }
});

test("matching RO duplicate never deletes if Assign Next repair fails after current-state commit",async()=>{
  const code=section("  async function autoSurveyFolder(","  async function importReturnedWorkbook(");
  const digest=await sha256(bytes),name="synthetic-recovery.xlsx";
  const entry={name,location:"inbox",relativePath:"01 - DROP REPORTS HERE/"+name,
    signature:"synthetic|3|100",file:{lastModified:100,arrayBuffer:async()=>bytes}};
  const state={records:[{ro:"900001",advisorCode:"101"}],source:{sha256:digest,importedAt:"2026-10-29"}};
  const model={state,autoImport:{seen:{}}};let removed=0,moved=0;
  const ctx={model,sourceLocations:new Map(),sha256,
    watchCandidates:async()=>[entry],candidateNeedsImport:()=>true,
    classifyImportFile:async()=> "open-ro",
    processClassifiedCandidate:async()=>{throw Error("Must not replay");},
    readJson:async()=>JSON.parse(JSON.stringify(state)),STATE_PATH:["data","state.json"],
    prepareXlsxWorkbook:async()=>({SheetNames:["Synthetic"],Sheets:{Synthetic:{}}}),
    legacyReport:()=>({verification:"group totals and global rows returned reconciled",workloadRecords:state.records}),
    retainDailyReport:async()=>{},saveOpenRoWorkload:async()=>{throw Object.assign(Error("OneDrive unavailable"),{name:"NotReadableError"});},
    openRoWorkloadSnapshot:()=>({}),coverageTimestamp:()=> "2026-10-29",
    removeSourceEntryWithByteGuard:async()=>{removed++;},
    transientIntakeError:e=>e.name==="NotReadableError",moveToLearn:async()=>{moved++;},
    now:()=> "2026-10-29",recordDiagnostic:()=>{},status:()=>{},scanFiles:async()=>{},
    writeJson:async()=>{},AUTO_IMPORT_PATH:["data","auto-import.json"],TextDecoder,Uint8Array,Map,Set,JSON};
  vm.runInNewContext(code,ctx);
  const result=await ctx.autoSurveyFolder();
  assert.equal(removed,0);assert.equal(moved,0);assert.equal(result.retained.length,1);
});

test("a roster committed before a dependent write failure is retained, not moved to Files To Learn",async()=>{
  const code=section("  async function autoSurveyFolder(","  async function importReturnedWorkbook(");
  const digest=await sha256(bytes),name="synthetic-projection-repair.xlsx";
  const item={name,location:"inbox",relativePath:"01 - DROP REPORTS HERE/"+name,
    signature:"inbox|3|100",file:{lastModified:100,arrayBuffer:async()=>bytes}};
  const model={state:{source:{sha256:"old"},records:[{ro:"prior"}]},autoImport:{seen:{}}};
  let moved=0;
  const ctx={model,sourceLocations:new Map(),watchCandidates:async()=>[item],
    candidateNeedsImport:()=>true,classifyImportFile:async()=> "open-ro",
    readJson:async()=>({source:{sha256:"old"},records:[{ro:"prior"}]}),
    processClassifiedCandidate:async()=>{
      model.state.source.sha256=digest; // production importer completed STATE_PATH write
      throw new Error("Synthetic post-state projection write failed");
    },
    moveToLearn:async()=>{moved++;},
    transientIntakeError:()=>false,sha256,now:()=> "2026-10-29",
    recordDiagnostic:()=>{},status:()=>{},writeJson:async()=>{},
    AUTO_IMPORT_PATH:["data","auto-import.json"],STATE_PATH:["data","state.json"],
    scanFiles:async()=>{},TextDecoder,Uint8Array,Map,Set,JSON};
  vm.runInNewContext(code,ctx);
  const outcome=await ctx.autoSurveyFolder();
  assert.equal(moved,0);
  assert.equal(outcome.retained.length,1);
  assert.equal(outcome.learned.length,0);
});

test("a committed Open RO write with a lost read-back is recovered from disk without reimport",async()=>{
  const code=section("  async function autoSurveyFolder(","  async function importReturnedWorkbook(");
  const digest=await sha256(bytes),name="synthetic-recovery.xlsx";
  const item={name,location:"inbox",relativePath:"01 - DROP REPORTS HERE/"+name,
    signature:"inbox|3|100",file:{lastModified:100,arrayBuffer:async()=>bytes}};
  const persisted={updatedAt:"2026-10-29T15:30:00Z",
    records:[{id:"synthetic-record-900001",ro:"900001",advisorCode:"101"}],
    source:{sha256:digest,importedAt:"2026-10-29T15:30:00Z",sourceModifiedAt:"2026-10-29T15:29:00Z"}};
  const model={state:{updatedAt:"old",records:[],source:{sha256:"old"}},
    autoImport:{seen:{}}};
  let imports=0,removed=0,repairs=0;
  const ctx={model,sourceLocations:new Map(),watchCandidates:async()=>[item],
    candidateNeedsImport:()=>true,classifyImportFile:async()=> "open-ro",
    processClassifiedCandidate:async()=>{imports++;throw Error("Would duplicate committed import");},
    readJson:async()=>JSON.parse(JSON.stringify(persisted)),
    STATE_PATH:["data","state.json"],AUTO_IMPORT_PATH:["data","auto-import.json"],
    prepareXlsxWorkbook:async()=>({SheetNames:["synthetic"],Sheets:{synthetic:{}}}),
    legacyReport:()=>({verification:"group totals and global rows returned reconciled",
      workloadRecords:[{ro:"900001",advisorCode:"101"}]}),
    retainDailyReport:async()=>{repairs++;},saveOpenRoWorkload:async()=>{repairs++;},
    openRoWorkloadSnapshot:()=>({sourceType:"open-ro"}),
    ensureDailyFocus:async()=>{repairs++;},
    writeJson:async()=>{},removeSourceEntryWithByteGuard:async()=>{removed++;},
    coverageTimestamp:()=> "2026-10-29",now:()=> "2026-10-29",sha256,
    recordDiagnostic:()=>{},status:()=>{},scanFiles:async()=>{},
    TextDecoder,Uint8Array,Map,Set,JSON,Date};
  vm.runInNewContext(code,ctx);
  const result=await ctx.autoSurveyFolder();
  assert.equal(imports,0,"must never retry the already durably committed import");
  assert.equal(model.state.source.sha256,digest);
  assert.equal(model.state.records[0].ro,"900001");
  assert.equal(repairs,3,"complete all dependent projections before cleanup");
  assert.equal(removed,1);
  assert.equal(result.cleaned.length,1);
});

test("rebuilding duplicate Assign Next excludes ROs manually closed after original import, preserving untracked advisors",async()=>{
  const code=section("  async function autoSurveyFolder(","  async function importReturnedWorkbook(");
  const digest=await sha256(bytes),name="synthetic-closed.xlsx";
  const importedAt="2026-10-29T12:00:00Z";
  const entry={name,location:"inbox",relativePath:"01 - DROP REPORTS HERE/"+name,
    signature:"inbox|3|100",file:{lastModified:100,arrayBuffer:async()=>bytes}};
  const state={updatedAt:"2026-10-29T13:00:00Z",source:{sha256:digest,importedAt},
    records:[{id:"synthetic-record-900001",ro:"900001",advisorCode:"101"}],
    closedRecords:[{id:"synthetic-record-900002",ro:"900002",advisorCode:"101",closedReason:"manual-manager-close",closedAt:"2026-10-29T12:30:00Z"}]};
  const model={state,autoImport:{seen:{}}};
  let workRows=null,deleted=false;
  const ctx={model,sourceLocations:new Map(),watchCandidates:async()=>[entry],
    candidateNeedsImport:()=>true,classifyImportFile:async()=> "open-ro",
    processClassifiedCandidate:async()=>{throw Error("No reimport");},
    readJson:async()=>JSON.parse(JSON.stringify(state)),STATE_PATH:["data","state.json"],
    AUTO_IMPORT_PATH:["data","auto-import.json"],sha256,
    prepareXlsxWorkbook:async()=>({SheetNames:["Synthetic"],Sheets:{Synthetic:{}}}),
    legacyReport:()=>({verification:"group totals and global rows returned reconciled",
      workloadRecords:[{ro:"900001",advisorCode:"101"},
        {ro:"900002",advisorCode:"101"},
        {ro:"900003",advisorCode:"202"}]}),
    retainDailyReport:async()=>{},
    openRoWorkloadSnapshot:rows=>{workRows=rows;return {sourceType:"open-ro"};},
    saveOpenRoWorkload:async()=>{},ensureDailyFocus:async()=>{},
    removeSourceEntryWithByteGuard:async()=>{deleted=true;},
    coverageTimestamp:()=> "2026-10-29",writeJson:async()=>{},
    now:()=> "2026-10-29",recordDiagnostic:()=>{},status:()=>{},scanFiles:async()=>{},
    TextDecoder,Uint8Array,Map,Set,JSON,Date};
  vm.runInNewContext(code,ctx);
  await ctx.autoSurveyFolder();
  assert.equal(deleted,true);
  assert.deepEqual(workRows.map(row=>row.ro),["900001","900003"],
    "manual close must be retained; legitimate untracked-advisor source workload must survive");
  assert.equal(model.state.closedRecords[0].closedReason,"manual-manager-close");
});

test("an unsaved manager draft defers durable roster reconciliation and preserves source",async()=>{
  const code=section("  async function autoSurveyFolder(","  async function importReturnedWorkbook(");
  const digest=await sha256(bytes),name="synthetic-draft.xlsx";
  const item={name,location:"inbox",relativePath:"01 - DROP REPORTS HERE/"+name,
    signature:"inbox|3|100",file:{lastModified:100,arrayBuffer:async()=>bytes}};
  const stale={updatedAt:"before",records:[{ro:"old"}],source:{sha256:"old"}};
  const durable={updatedAt:"after",records:[{ro:"new"}],source:{sha256:digest}};
  const model={state:stale,autoImport:{seen:{}}};let deleted=0,moved=0;
  const ctx={model,editDraftDirty:true,sourceLocations:new Map(),
    watchCandidates:async()=>[item],candidateNeedsImport:()=>true,
    classifyImportFile:async()=> "open-ro",sha256,
    readJson:async()=>JSON.parse(JSON.stringify(durable)),STATE_PATH:["data","state.json"],
    transientIntakeError:e=>e.name==="InvalidStateError",
    moveToLearn:async()=>{moved++;},removeSourceEntryWithByteGuard:async()=>{deleted++;},
    now:()=> "2026-10-29",recordDiagnostic:()=>{},status:()=>{},
    TextDecoder,Uint8Array,Map,Set,JSON,Date,DOMException};
  vm.runInNewContext(code,ctx);
  const result=await ctx.autoSurveyFolder();
  assert.equal(moved,0);assert.equal(deleted,0);
  assert.equal(model.state,stale,"unsaved manager edit remains in memory");
  assert.equal(result.retained.length,1);
});

test("advisor-grouped workbook missing global totals is rejected rather than silently treated as supplemental",async()=>{
  const code=section("  async function classifyImportFile(","  async function moveToLearn(");
  const book={SheetNames:["Synthetic"],Sheets:{Synthetic:{rows:[
    ["SVCADV : 101 (2 items)"],[null,"RO","TAG-NO","OPEN-DATE","DAYS","CUSTOMERNAME","STATUS"]]}}};
  let parserCalled=0,supplementalCalled=0;
  const ctx={XLSX:{utils:{sheet_to_json:sheet=>sheet.rows}},
    prepareXlsxWorkbook:async()=>book,
    workbookIsHandoff:()=>false,workbookHasReturnSchema:()=>false,workbookHasReturnIdentity:()=>false,
    parseCsiWorkbook:()=>{throw Error("other");},parseMenuSalesWorkbook:()=>{throw Error("other");},
    parsePerformanceWorkbook:()=>{throw Error("other");},parseSorWorkbook:()=>{throw Error("other");},
    parseAppointmentActivityWorkbook:()=>{throw Error("other");},
    parseEfficiencyWorkbook:()=>{throw Error("other");},
    parseMediaAsrWorkbook:()=>{throw Error("other");},
    parseOpenRoSummaryWorkbook:()=>{throw Error("other");},
    matchingTradeArReportLayout:()=>false,
    legacyReport:()=>{parserCalled++;throw Error("Needs Review: missing global Rows Returned totals");},
    parseSupplementalWorkbook:()=>{supplementalCalled++;return{};}};
  vm.runInNewContext(code,ctx);
  await assert.rejects(ctx.classifyImportFile("synthetic-malformed.xlsx",{},bytes),/missing global Rows Returned totals/);
  assert.equal(parserCalled,1,"must invoke the strict grouped parser");
  assert.equal(supplementalCalled,0,"must not bypass failed authority checks");
});

test("automatic cleanup records its digest hold before discovering changed Inbox bytes",async()=>{
  const source=section("  async function removeSourceEntry(name) {","  async function finishReadOnlyConnection(");
  const name="synthetic.xlsx",original=new Uint8Array([1,2,3]).buffer,replaced=new Uint8Array([4,5,6]).buffer;
  const signature="01 - DROP REPORTS HERE/synthetic.xlsx|3|100";
  const model={autoImport:{seen:{}},root:{removeEntry:async()=>{throw Error("root must not be touched");}}};
  let persisted=0,deleted=0;
  const ctx={model,sourceLocations:new Map([[name,"inbox"]]),
    dailyPickedSources:new Map(),xlsxSourceDeleteGuards:new Map([[name,original]]),
    autoSourceDeleteContext:new Map([[name,{signature,relativePath:"01 - DROP REPORTS HERE/"+name,
      bytes:original,kind:"open-ro"}]]),
    now:()=> "2026-10-29T15:00:00Z",sha256,
    writeJson:async()=>{persisted++;},AUTO_IMPORT_PATH:["data","auto-import.json"],
    sameByteContent:equal,sourceFileHandle:async()=>({getFile:async()=>({arrayBuffer:async()=>replaced})}),
    reportInbox:async()=>({removeEntry:async()=>{deleted++;}}),
    Map,Uint8Array};
  vm.runInNewContext(source,ctx);
  await assert.rejects(ctx.removeSourceEntry(name),/changed while/);
  assert.equal(persisted,1,"durable intent must precede checking for changes");
  assert.equal(deleted,0,"never delete a replaced, unverified report");
  assert.equal(model.autoImport.seen[signature].cleanupPending,true);
  assert.equal(model.autoImport.seen[signature].cleanupSha256,await sha256(original));
});

test("post-import cleanup failure takes priority over generic saved-roster handling",async()=>{
  const code=section("  async function autoSurveyFolder(","  async function importReturnedWorkbook(");
  const digest=await sha256(bytes),name="synthetic-cleanup.xlsx";
  const entry={name,location:"inbox",relativePath:"01 - DROP REPORTS HERE/"+name,
    signature:"inbox|3|100",file:{lastModified:100,arrayBuffer:async()=>bytes}};
  const model={state:{source:{sha256:digest},records:[]},autoImport:{seen:{}}};
  let moved=0;
  const ctx={model,sourceLocations:new Map(),watchCandidates:async()=>[entry],
    candidateNeedsImport:()=>true,classifyImportFile:async()=> "open-ro",
    readJson:async()=>({source:{sha256:"older"}}),STATE_PATH:["data","state.json"],
    processClassifiedCandidate:async()=>{throw Object.assign(Error("source replaced"),{sourceCleanupFailure:true});},
    moveToLearn:async()=>{moved++;},sha256,writeJson:async()=>{},
    AUTO_IMPORT_PATH:["data","auto-import.json"],now:()=> "2026-10-29",
    recordDiagnostic:()=>{},status:()=>{},scanFiles:async()=>{},
    TextDecoder,Uint8Array,Map,Set,JSON};
  vm.runInNewContext(code,ctx);
  const result=await ctx.autoSurveyFolder();
  assert.equal(result.cleanupPending.length,1);
  assert.equal(moved,0);
  assert.equal(model.autoImport.seen[entry.signature].cleanupSha256,digest);
  assert.equal(model.autoImport.seen[entry.signature].cleanupPending,true);
});

test("a manager close during duplicate recovery prevents stale workload and source deletion",async()=>{
  const code=section("  async function autoSurveyFolder(","  async function importReturnedWorkbook(");
  const digest=await sha256(bytes),name="synthetic-concurrent-close.xlsx";
  const entry={name,location:"inbox",relativePath:"01 - DROP REPORTS HERE/"+name,
    signature:"inbox|3|100",file:{lastModified:100,arrayBuffer:async()=>bytes}};
  const state={updatedAt:"initial",records:[
    {id:"synthetic-active-1",ro:"900001",advisorCode:"101"},
    {id:"synthetic-active-2",ro:"900002",advisorCode:"101"}],
    closedRecords:[],source:{sha256:digest,importedAt:"2026-10-29T12:00:00Z"}};
  const model={state,autoImport:{seen:{}}};
  let imported=0,deletions=0,repairs=0,closed=false;
  const ctx={model,sourceLocations:new Map(),watchCandidates:async()=>[entry],
    candidateNeedsImport:()=>true,classifyImportFile:async()=> "open-ro",
    processClassifiedCandidate:async()=>{imported++;},
    readJson:async()=>JSON.parse(JSON.stringify(state)),STATE_PATH:["data","state.json"],
    prepareXlsxWorkbook:async()=>({SheetNames:["Synthetic"],Sheets:{Synthetic:{}}}),
    legacyReport:()=>({verification:"group totals and global rows returned reconciled",
      workloadRecords:[{ro:"900001",advisorCode:"101"},{ro:"900002",advisorCode:"101"}]}),
    retainDailyReport:async()=>{if(!closed){
      state.records=state.records.filter(row=>row.ro!=="900002");
      state.closedRecords=[{id:"synthetic-active-2",ro:"900002",
        closedAt:"2026-10-29T12:30:00Z",closedReason:"manual-manager-close"}];
      state.updatedAt="manual-close";closed=true;
    }},
    openRoWorkloadSnapshot:rows=>({sourceType:"open-ro",records:rows}),
    saveOpenRoWorkload:async()=>{repairs++;},
    ensureDailyFocus:async()=>{},removeSourceEntryWithByteGuard:async()=>{deletions++;},
    transientIntakeError:e=>e.name==="InvalidStateError",
    sha256,coverageTimestamp:()=> "2026-10-29",writeJson:async()=>{},
    AUTO_IMPORT_PATH:["data","auto-import.json"],now:()=> "2026-10-29",
    recordDiagnostic:()=>{},status:()=>{},scanFiles:async()=>{},
    TextDecoder,Uint8Array,Map,Set,JSON,Date,DOMException};
  vm.runInNewContext(code,ctx);
  const first=await ctx.autoSurveyFolder();
  assert.equal(first.retained.length,1,"concurrent manager close keeps original source for retry");
  assert.equal(deletions,0);
  assert.equal(imported,0);
  const second=await ctx.autoSurveyFolder();
  assert.equal(second.cleaned.length,1);
  assert.equal(deletions,1);
  assert.equal(imported,0);
  assert.ok(repairs>=2);
});
