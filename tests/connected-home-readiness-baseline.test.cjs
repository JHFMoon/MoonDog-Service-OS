"use strict";
// #58-01 component baseline: measure durable verified-root publication through
// the production first Home render with synthetic in-memory state only. This
// does not include launcher, browser-cache, or pre-hydration file-read time.
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
assert.ok(firstRender,"Verified connection must render Home before starting background work");

function percentile(samples,q){
  const sorted=[...samples].sort((a,b)=>a-b);
  return sorted[Math.max(0,Math.ceil(sorted.length*q)-1)];
}
function harness(root){
  const model={root,recovery:{},state:{records:[],closedRecords:[],updatedAt:null,source:null},workspaceConnectionCommittedRoot:null};
  const signals=[];
  let durableRecovery=null;
  let renderedHomeAt=null;
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
  return {context,model,signals,ui,get durableRecovery(){return durableRecovery;},markRendered(){renderedHomeAt=performance.now();},get renderedHomeAt(){return renderedHomeAt;}};
}

test("synthetic connected Home readiness reports repeated p50/p95 after durable verification",async()=>{
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
    h.markRendered();
    assert.equal(h.ui.metricOpen.textContent,0);
    assert.equal(h.ui.exportButton.disabled,true);
    samples.push(h.renderedHomeAt-started);
  }
  const report={scope:"hydrated-to-verified-home-render; synthetic Node harness; excludes launcher and pre-hydration reads",
    count:samples.length,p50Ms:percentile(samples,0.5),p95Ms:percentile(samples,0.95),maxMs:Math.max(...samples)};
  assert.equal(report.count,9);
  assert.ok(Number.isFinite(report.p50Ms)&&Number.isFinite(report.p95Ms)&&report.p50Ms>=0&&report.p95Ms>=report.p50Ms);
  console.log("Synthetic connected Home readiness baseline",JSON.stringify(report));
});
