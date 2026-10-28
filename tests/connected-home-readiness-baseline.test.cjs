"use strict";
// #58-01 partial component baseline: measure durable connection reconciliation
// through the production render dispatch with synthetic in-memory state only.
// Render helpers are stubs, so this does not measure Home calculations or DOM work.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {performance}=require("node:perf_hooks");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function extract(text,first,last){
  const start=text.indexOf(first);
  assert.ok(start>=0,"Missing production entry: "+first);
  const end=text.indexOf(last,start+first.length);
  assert.ok(end>start,"Missing production boundary: "+last);
  return text.slice(start,end);
}
const reconcile=extract(app,"  async function postConnectReconciliation(","  async function connect() {");
const renderBegin=app.indexOf("  function renderAll() {");
const renderEnd=app.indexOf("  const renderAllWithCanonicalSourceLabels=renderAll;",renderBegin);
assert.ok(renderBegin>=0&&renderEnd>renderBegin,"Full Home render boundary must be reviewed if changed");
const renderHome=app.slice(renderBegin,renderEnd);
const connection=extract(app,"  async function completeWorkspaceConnection(","  async function postConnectReconciliation(");
const firstRender=connection.split("\n").find(line=>/^\s*renderAll\(\); renderRecovery\(\); openSetupIfRequired\(\); startFolderWatch\(\);\s*$/.test(line));
assert.ok(firstRender,"Verified connection must dispatch render before background work");
const reconciliationAwait=connection.indexOf("await postConnectReconciliation(permissionWasPending);");
assert.ok(reconciliationAwait>=0&&connection.indexOf(firstRender)>reconciliationAwait,
  "durable post-connect reconciliation must complete before the first render dispatch");

function percentile(samples,q){
  const sorted=[...samples].sort((a,b)=>a-b);
  return sorted[Math.max(0,Math.ceil(sorted.length*q)-1)];
}
function harness(root){
  const model={root,recovery:{},state:{records:[],closedRecords:[],updatedAt:null,source:null},workspaceConnectionCommittedRoot:null};
  const signals=[];
  let durableRecovery=null;
  let renderDispatchAt=null;
  const field=()=>({textContent:""});
  const ui={metricOpen:field(),metricDue:field(),metricMissing:field(),metricUpdated:field(),lastImport:field(),lastExport:field(),exportButton:{disabled:false}};
  const context=vm.createContext({
    model,ui,RECOVERY_PATH:["data","recovery.json"],performance,setImmediate,
    now:()=>"2026-10-22T00:00:00.000Z",
    writeJson:async(_path,value)=>{await new Promise(resolve=>setImmediate(resolve));durableRecovery=structuredClone(value);},
    setConnectionState:(state)=>signals.push({state,at:performance.now()}),
    recordDiagnostic:()=>{},
    localDateKey:()=>"2026-10-22",isClosedManagement:()=>false,
    renderOverviewIntelligence:()=>{},renderDailyFocus:()=>{},renderFilters:()=>{},
    renderTable:()=>{},renderArrivals:()=>{},renderPerformance:()=>{},renderMeeting:()=>{},renderAssignNext:()=>{},
    renderSetup:()=>{},renderRecovery:()=>{},openSetupIfRequired:()=>{},startFolderWatch:()=>{}
  });
  vm.runInContext(renderHome+"\n"+reconcile+"\nthis.paintHome=renderAll;this.publishConnected=postConnectReconciliation;",context);
  return {context,model,signals,ui,get durableRecovery(){return durableRecovery;},markRenderDispatched(){renderDispatchAt=performance.now();},get renderDispatchAt(){return renderDispatchAt;}};
}

test("synthetic connection reconciliation precedes stubbed render dispatch",async()=>{
  const samples=[];
  for(let i=0;i<9;i++){
    const root={name:"Synthetic Workspace "+i};
    const h=harness(root);
    const started=performance.now();
    const pending=h.context.publishConnected(false,root);
    assert.equal(h.model.workspaceConnectionCommittedRoot,null,"Home cannot be verified before recovery state is durable");
    await pending;
    assert.equal(h.model.workspaceConnectionCommittedRoot,root);
    assert.equal(h.signals.at(-1).state,"CONNECTED");
    assert.equal(h.durableRecovery.status,"Ready");
    vm.runInContext(firstRender,h.context);
    h.markRenderDispatched();
    assert.equal(h.ui.metricOpen.textContent,0);
    assert.equal(h.ui.exportButton.disabled,true);
    samples.push(h.renderDispatchAt-started);
  }
  const report={scope:"hydrated-to-verified-connection-render-dispatch; render helpers stubbed; excludes Home calculations/DOM, launcher, and pre-hydration reads",
    count:samples.length,p50Ms:percentile(samples,0.5),p95Ms:percentile(samples,0.95),maxMs:Math.max(...samples)};
  assert.equal(report.count,9);
  assert.ok(Number.isFinite(report.p50Ms)&&Number.isFinite(report.p95Ms)&&report.p50Ms>=0&&report.p95Ms>=report.p50Ms);
  console.log("Synthetic connected Home readiness baseline",JSON.stringify(report));
});


// #58-01: isolate the production essential snapshot hydration block. This
// measures only the bounded read/atomic publication stage on synthetic handles.
// It does NOT include browser/OneDrive latency, full connection, or real DOM.
const hydrateSnapshots=extract(app,
  "    const connectionReadSpecs = [",
  "    model.state.closedRecords=pruneClosedRecords");
async function syntheticSnapshotHydration(recordCount,options={}){
  const names=["state","appointments","performance","operationalMetrics",
    "meetingCycle","assignNext","autoImport","recovery","settings"];
  const paths=names.map((name,index)=>["synthetic",String(index)+"-"+name+".json"]);
  const initial=Object.fromEntries(names.map(name=>[name,{unchanged:name}]));
  const model={...initial};
  const payload=Object.fromEntries(names.map(name=>[name,{source:"synthetic",rows:[]}]));
  payload.state={records:Array.from({length:recordCount},(_,i)=>({
    id:"SYNTHETIC-"+i,management:{reviewDate:"2026-10-25",nextAction:"Follow up"}
  })),closedRecords:[]};
  const serialized=Object.fromEntries(names.map(name=>[name,JSON.stringify(payload[name])]));
  let inflight=0,maximumInflight=0,reads=0;
  const readJson=async(filePath)=>{
    const index=paths.indexOf(filePath);
    assert.ok(index>=0,"Unexpected hydration path");
    reads++;
    inflight++;
    maximumInflight=Math.max(maximumInflight,inflight);
    try{
      // Deterministic async wait plus real JSON parsing, not a OneDrive timing surrogate.
      await new Promise(resolve=>setTimeout(resolve,options.latencyMs??2));
      if(options.failAt===index)throw Error("Synthetic unavailable snapshot");
      return JSON.parse(serialized[names[index]]);
    }finally{inflight--;}
  };
  const context=vm.createContext({
    model,readJson,
    STATE_PATH:paths[0],APPOINTMENTS_PATH:paths[1],PERFORMANCE_PATH:paths[2],
    OPERATIONAL_METRICS_PATH:paths[3],MEETING_CYCLE_PATH:paths[4],
    ASSIGN_NEXT_PATH:paths[5],AUTO_IMPORT_PATH:paths[6],RECOVERY_PATH:paths[7],
    SETTINGS_PATH:paths[8]
  });
  const started=performance.now();
  const hydration=vm.runInContext("(async()=>{\n"+hydrateSnapshots+"\nthis.hydratedSettings=rawSettings;\n})()",context);
  await Promise.resolve();
  for(const name of names)assert.equal(model[name],initial[name],
    "No partial snapshot may publish while reads are unfinished: "+name);
  try{await hydration;}
  catch(error){
    assert.match(String(error),/Synthetic unavailable snapshot/);
    for(const name of names)assert.equal(model[name],initial[name],
      "A failed hydration must retain every original snapshot: "+name);
    return {failed:true,maximumInflight,reads};
  }
  const elapsedMs=performance.now()-started;
  for(const name of names.filter(name=>name!=="settings"))assert.deepEqual(model[name],payload[name],
    "Commit the verified model group once all nine reads succeed: "+name);
  assert.deepEqual(context.hydratedSettings,payload.settings,
    "The settings snapshot must be available from the same atomic hydration batch.");
  assert.equal(model.state.records.length,recordCount);
  return {failed:false,elapsedMs,maximumInflight,reads};
}
test("nine production snapshot reads, including settings, are bounded and atomically published for empty/large synthetic Workspaces",async()=>{
  for(const count of [0,2100]){
    const samples=[];
    for(let trial=0;trial<9;trial++){
      const result=await syntheticSnapshotHydration(count);
      assert.equal(result.reads,9);
      assert.equal(result.maximumInflight,3,
        "The original connection path must limit independent reads to three");
      samples.push(result.elapsedMs);
    }
    const report={scope:"synthetic essential snapshot reads through atomic model commit; excludes real folder permissions, browser rendering, file bytes and OneDrive",
      records:count,samples:9,p50Ms:percentile(samples,0.5),
      p95Ms:percentile(samples,0.95),maxMs:Math.max(...samples)};
    assert.ok(Number.isFinite(report.p95Ms)&&report.p95Ms>=report.p50Ms);
    console.log("Synthetic connection snapshot hydration baseline",JSON.stringify(report));
  }
});
test("late essential snapshot failure cannot commit a partial connection",async()=>{
  const failed=await syntheticSnapshotHydration(2100,{failAt:8,latencyMs:2});
  assert.equal(failed.failed,true);
  assert.equal(failed.reads,9);
  assert.ok(failed.maximumInflight<=3);
});
