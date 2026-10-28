"use strict";
// #58: a connected Workspace should build Setup once per first render,
// not rebuild the Setup checklist immediately after renderAll() already did it.
// Synthetic, DOM-free instrumentation; not a real-device latency benchmark.
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const begin=app.indexOf("  function renderAll() {");
const end=app.indexOf("  const renderAllWithCanonicalSourceLabels=renderAll;",begin);
assert.ok(begin>=0&&end>begin,"Full-render source boundary must be reviewed if changed");
const renderSource=app.slice(begin,end);
const connectionBegin=app.indexOf("  async function completeWorkspaceConnection(");
const connectionEnd=app.indexOf("  async function postConnectReconciliation(",connectionBegin);
assert.ok(connectionBegin>=0&&connectionEnd>connectionBegin);
const connection=app.slice(connectionBegin,connectionEnd);
const firstRenderLine=connection.split("\n").find(line=>/^\s*renderAll\(\); renderRecovery\(\); openSetupIfRequired\(\); startFolderWatch\(\);\s*$/.test(line));
assert.ok(firstRenderLine,"First-frame work must run recovery and folder watch after one full draw");
function runSyntheticFirstRender(schedule){
  const counts={setup:0,overview:0,daily:0,overviewDispatch:0,dailyDispatch:0,filters:0,recovery:0,setupGate:0,watch:0,activeReports:0};
  const field=()=>({textContent:""});
  const ui={metricOpen:field(),metricDue:field(),metricMissing:field(),
    metricUpdated:field(),lastImport:field(),lastExport:field(),exportButton:{disabled:false}};
  const ctx={ui,model:{state:{records:[],updatedAt:null},recovery:{supervisorWorkbook:null},root:null},
    localDateKey:()=> "2026-10-20",isClosedManagement:()=>false,
    renderOverviewIntelligence:()=>{counts.overview++;},
    renderDailyFocus:()=>{counts.daily++;},
    renderOverviewPanelsIfNeeded:active=>{counts.overviewDispatch++;if(active)counts.overview++;},
    renderDailyFocusIfNeeded:active=>{counts.dailyDispatch++;if(active)counts.daily++;},
    renderFilters:()=>{counts.filters++;},
    renderTable:()=>{counts.activeReports++;},
    renderArrivals:()=>{counts.activeReports++;},
    renderPerformance:()=>{counts.activeReports++;},
    renderMeeting:()=>{counts.activeReports++;},
    renderAssignNext:()=>{counts.activeReports++;},
    renderSetup:()=>{counts.setup++;},
    renderRecovery:()=>{counts.recovery++;},
    openSetupIfRequired:()=>{counts.setupGate++;},
    startFolderWatch:()=>{counts.watch++;}
  };
  vm.runInNewContext(renderSource+"\n"+schedule,ctx);
  return counts;
}
test("connected Home first frame rebuilds Setup once and preserves recovery/watch ordering",()=>{
  const counts=runSyntheticFirstRender(firstRenderLine);
  assert.deepEqual(counts,{setup:1,overview:0,daily:0,overviewDispatch:1,dailyDispatch:1,filters:1,
    recovery:1,setupGate:1,watch:1,activeReports:0},
    "the first frame dispatches both deferred panels but does not render hidden panel contents");
});
test("eliminating redundant render avoids one of two Setup DOM builds in synthetic call-count baseline",()=>{
  const baseline=runSyntheticFirstRender("renderAll(); renderSetup(); renderRecovery(); openSetupIfRequired(); startFolderWatch();");
  const optimized=runSyntheticFirstRender(firstRenderLine);
  assert.equal(baseline.setup,2);
  assert.equal(optimized.setup,1);
  assert.equal(baseline.recovery,optimized.recovery);
  assert.equal(baseline.watch,optimized.watch);
  assert.equal(baseline.setupGate,optimized.setupGate);
  assert.equal(optimized.overviewDispatch,1);
  assert.equal(optimized.dailyDispatch,1);
  assert.equal(optimized.overview,0);
  assert.equal(optimized.daily,0);
  // This proves an invocation reduction, not a real-world millisecond saving.
});
