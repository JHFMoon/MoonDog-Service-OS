"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets/app.js"), "utf8");
const start = app.indexOf("  // Presentation-only advisor scopes.");
const end = app.indexOf("  function configuredAdvisors(", start);
assert.ok(start >= 0 && end > start, "Production visibility selector exists");
const model = {
  settings: {
    advisors: {
      "101": { number: "101", name: "Synthetic A", active: true, removed: false, participation: { openRo: false, advisorPerformance: true } },
      "102": { number: "102", name: "Synthetic B", active: true, removed: false, participation: { assignNext: true } },
      "103": { number: "103", name: "Synthetic C", active: false, removed: true, participation: { openRo: true, advisorPerformance: true } }
    }
  },
  state: {
    records: [
      { id: "synthetic-1", advisorCode: "101", advisor: "Synthetic A" },
      { id: "synthetic-2", advisorCode: "102", advisor: "Synthetic B" },
      { id: "synthetic-3", advisorCode: "103", advisor: "Synthetic C" },
      { id: "synthetic-4", advisorCode: "999", advisor: "Unconfigured source" },
      { id: "synthetic-5", advisor: "Synthetic A" }
    ]
  }
};
const norm = value => String(value ?? "").toLowerCase().trim();
const visibility = vm.runInNewContext(app.slice(start, end) +
  "\n({advisorShownInSection, openRoRecordVisible, openRoVisibleRecords})", { model, norm });

test("Open RO scope hides one advisor without removing authoritative records", () => {
  const before = JSON.stringify(model.state);
  const visible = visibility.openRoVisibleRecords();
  assert.deepEqual([...visible.map(record => record.id)], ["synthetic-2", "synthetic-4"]);
  assert.equal(JSON.stringify(model.state), before, "source state must be unchanged");
  assert.equal(visibility.advisorShownInSection("101", "advisorPerformance"), true, "performance numbers remain visible");
  assert.equal(visibility.advisorShownInSection("101", "assignNext"), false, "other scope remains independent");
});

test("older settings default to showing Open RO and Performance, including inactive source identities", () => {
  assert.equal(visibility.advisorShownInSection("102", "openRo"), true);
  assert.equal(visibility.advisorShownInSection("102", "advisorPerformance"), true);
  assert.equal(visibility.advisorShownInSection("999", "openRo"), true, "unknown source may not disappear");
  assert.equal(visibility.advisorShownInSection("103", "openRo"), false, "legacy global-hidden is honored");
});

test("records with missing advisor codes are hidden only after unique name resolution", () => {
  assert.equal(visibility.openRoRecordVisible({advisor:"Synthetic A"}), false);
  assert.equal(visibility.openRoRecordVisible({advisor:"Unknown"}), true);
  model.settings.advisors["104"] = {number:"104",name:"Synthetic A",removed:false,participation:{openRo:true}};
  assert.equal(visibility.openRoRecordVisible({advisor:"Synthetic A"}), true, "ambiguous identity must remain accessible");
  delete model.settings.advisors["104"];
});

test("UI surfaces have independent non-destructive visibility gates", () => {
  const scopes = ["openRo","assignNext","dailyWalk","advisorPerformance","advisorMeeting","supervisorWorkbook"];
  const settings = app.slice(app.indexOf("  function renderAdvisorSettings()"),app.indexOf("  function renderSettings()"));
  for (const key of scopes) assert.ok(settings.includes('["'+key+'",'), key + " toggle");
  assert.ok(!settings.includes("Remove from Service Operations Dashboard"), "no misleading global remove control");
  assert.match(app, /function renderFilters\(\) \{ renderAdvisorHandoff\(\); const records=openRoVisibleRecords\(\)/);
  assert.match(app, /const rows=openRoVisibleRecords\(\)\.filter\(validManagerReviewDate\)/);
  assert.match(app, /all = openRoVisibleRecords\(\), exactRos=/);
  assert.match(app, /Object\.values\(latest\.advisors\)\.filter\(advisor => advisorShownInSection\(advisor\.code, "advisorPerformance"\)\)/);
  assert.match(app, /advisorShownInSection\(a\.number,'advisorPerformance'\)/);
  assert.match(app, /await writeJson\(SETTINGS_PATH,model\.settings\)/, "settings still saved to durable Workspace");
  // Evaluate the actual Home renderer: presentation-only advisor hiding may
  // reduce the Open RO table, but cannot erase storewide source totals.
  const homeStart=app.indexOf("  function renderAll() {");
  const homeEnd=app.indexOf("  const renderAllWithCanonicalSourceLabels=renderAll;",homeStart);
  assert.ok(homeStart>=0&&homeEnd>homeStart,"production Home renderer exists");
  const management=[
    {status:"Diagnosis",reviewDate:"2026-10-26",nextAction:""},
    {status:"Repair",reviewDate:"2026-10-26",nextAction:"Waiting for parts"},
    {status:"Closed",reviewDate:"2026-10-26",nextAction:""},
    {status:"Repair",reviewDate:"2026-10-27",nextAction:""},
    {status:"Diagnosis",reviewDate:"2026-10-26",nextAction:"Review"}
  ];
  const fullRecords=model.state.records.map((record,index)=>({...record,management:management[index]}));
  const allRecordsBefore=JSON.stringify(fullRecords);
  const homeModel={root:{},state:{records:fullRecords,updatedAt:null,source:null},
    recovery:{supervisorWorkbook:null}};
  const field=()=>({textContent:""});
  const homeUi={metricOpen:field(),metricDue:field(),metricMissing:field(),
    metricUpdated:field(),lastImport:field(),lastExport:field(),
    exportButton:{disabled:true}};
  const homeHelpersStart=app.indexOf('  let overviewPanelsDirty = true, overviewPanelsRenderedDate = "";');
  assert.ok(homeHelpersStart>=0&&homeStart>homeHelpersStart,
    "production per-view dirty-state helpers are extracted from a verified boundary");
  const homeHelperSource=app.slice(homeHelpersStart,homeStart);
  let overviewActive=false,openRoActive=false,todayKey="2026-10-26";
  const panelRenderCalls={overview:0,daily:0};
  homeUi["view-overview"]={classList:{contains:()=>overviewActive}};
  homeUi["view-open-ro"]={classList:{contains:()=>openRoActive}};
  const panels=vm.runInNewContext(homeHelperSource+app.slice(homeStart,homeEnd)+
    "\n({renderAll,renderOverviewPanelsIfNeeded,renderDailyFocusIfNeeded})",{
    model:homeModel,ui:homeUi,localDateKey:()=>todayKey,navigationDataRevision:0,
    isClosedManagement:management=>norm(management?.status)==="closed",
    renderOverviewIntelligence:()=>{panelRenderCalls.overview++;},
    renderDailyFocus:()=>{panelRenderCalls.daily++;},renderFilters:()=>{},
    renderTable:()=>{},renderArrivals:()=>{},renderPerformance:()=>{},
    renderMeeting:()=>{},renderAssignNext:()=>{},renderSetup:()=>{}
  });
  panels.renderAll();
  assert.equal(visibility.openRoVisibleRecords().length,2,
    "advisor-scoped Open RO list hides an opted-out advisor");
  assert.deepEqual([homeUi.metricOpen.textContent,homeUi.metricDue.textContent,
    homeUi.metricMissing.textContent],[4,3,2],
    "Home totals retain hidden advisor source rows while excluding only closed work");
  assert.equal(homeUi.exportButton.disabled,false);
  assert.deepEqual(panelRenderCalls,{overview:0,daily:0},
    "inactive overview and Open RO panels perform no hidden DOM rebuilds");
  overviewActive=true;panels.renderAll();
  assert.deepEqual(panelRenderCalls,{overview:1,daily:0},
    "Store Overview refreshes while its containing view is visible");
  overviewActive=false;openRoActive=true;panels.renderAll();
  assert.deepEqual(panelRenderCalls,{overview:1,daily:1},
    "Open RO daily walk refreshes while its containing view is visible");
  openRoActive=false;panels.renderAll();
  assert.deepEqual(panelRenderCalls,{overview:1,daily:1},
    "hidden panels stay deferred after they have been rendered once");
  todayKey="2026-10-27";
  overviewActive=true;
  assert.equal(panels.renderOverviewPanelsIfNeeded(true),true,
    "returning to Store Overview refreshes hidden and date-stale content");
  openRoActive=true;
  assert.equal(panels.renderDailyFocusIfNeeded(true),true,
    "returning to Open RO refreshes hidden and date-stale daily walk");
  assert.deepEqual(panelRenderCalls,{overview:2,daily:2});
  assert.equal(panels.renderOverviewPanelsIfNeeded(true),false,
    "unchanged same-day Store Overview panels are reused");
  assert.equal(panels.renderDailyFocusIfNeeded(true),false,
    "unchanged same-day Open RO walk is reused");
  panels.renderAll();
  assert.deepEqual(panelRenderCalls,{overview:3,daily:3},
    "visible owner views refresh on data updates");
  assert.match(app,/const navigateBeforeDeferredPanelRefresh = navigateTo;/,
    "owner-view refresh is attached outside the extracted core navigation harness");
  assert.equal(JSON.stringify(fullRecords),allRecordsBefore,
    "presentation filters and Home counting must never mutate authoritative rows");
  new vm.Script(app);
});

test("deferred production refresh wrapper follows owner-view navigation and respects cancellation",()=>{
  const start=app.indexOf("  const navigateBeforeDeferredPanelRefresh = navigateTo;");
  const end=app.indexOf("  const navigateWithLearnedFailures = navigateTo;",start);
  assert.ok(start>=0&&end>start,"production deferred navigation wrapper has explicit extraction bounds");
  const active={overview:false,openRo:false};
  let allowNavigation=true;
  const calls={overview:0,daily:0};
  const context={
    ui:{
      "view-overview":{classList:{contains:()=>active.overview}},
      "view-open-ro":{classList:{contains:()=>active.openRo}}
    },
    navigateTo(view){
      if(!allowNavigation)return false;
      active.overview=view==="overview";
      active.openRo=view==="open-ro";
      return "navigated";
    },
    renderOverviewPanelsIfNeeded(value){if(value)calls.overview++;},
    renderDailyFocusIfNeeded(value){if(value)calls.daily++;},
    renderOpenRoFiltersIfNeeded:()=>{}
  };
  const wrapper=vm.runInNewContext(app.slice(start,end)+"\n({navigateTo})",context);
  assert.equal(wrapper.navigateTo("overview"),"navigated");
  assert.deepEqual(calls,{overview:1,daily:0});
  assert.equal(wrapper.navigateTo("open-ro"),"navigated");
  assert.deepEqual(calls,{overview:1,daily:1});
  allowNavigation=false;
  assert.equal(wrapper.navigateTo("overview"),false);
  assert.deepEqual(calls,{overview:1,daily:1},
    "a cancelled navigation does not refresh a hidden destination");
});
