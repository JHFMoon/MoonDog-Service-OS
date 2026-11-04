"use strict";

// 59-01: execute shipped SAPR selectors and both Performance renderers against
// synthetic, out-of-order and finalized reports; no Workspace files are read.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");

function slice(first,last){
  const start=app.indexOf(first),end=app.indexOf(last,start+first.length);
  assert.ok(start>=0&&end>start,"production source boundary exists: "+first);
  return app.slice(start,end);
}
const selector=slice("  function saprImportRank(","  function verifiedSaprSnapshot(");
const meetingSelector=slice("  function latestVerifiedMeetingSnapshot()","  function meetingFreshness(");
const performance=slice("  function renderPerformance() {","  const renderPerformanceBase = renderPerformance;");
const wrapper=slice("  renderPerformance = function renderPerformanceVerified() {","\n\n  const TREND_SOURCES=");

function element(){
  return {
    textContent:"",innerHTML:"",className:"",value:"",children:[],
    append(...values){this.children.push(...values);},
    replaceChildren(...values){this.children=[...values];},
    add(value){this.children.push(value);},
    // The published Performance wrapper also decorates already-rendered rows;
    // selection and period evidence are verified against real rendered nodes.
    querySelectorAll(){return [];},
    before(){}
  };
}
function snapshot(date,importedAt,gross,days=10,total=22,verified=true){
  return {
    date,periodStart:date.slice(0,7)+"-01",periodEnd:date,
    sourceFile:"synthetic-sapr-"+date+".xlsx",importedAt,
    saprDaysCompleted:days,saprTotalDays:total,
    validation:{advisorDetailSheets:1,saprDaysVerified:verified,finalTotalsVerified:true},
    store:{name:"Synthetic Store",totalGross:gross,cpGross:gross/2,totalRO:9,
      open:2,aged:1,grossPerRo:gross/9,cpHours:2,cpElr:null},
    advisors:{"101":{code:"101",name:"Synthetic Advisor",totalGross:gross,
      totalRO:9,open:2,aged:1,grossPerRo:gross/9,cpHours:2,cpElr:null}}
  };
}
function harness(snapshots){
  const model={root:{name:"Synthetic Memory Only"},state:{source:null},performance:{snapshots}};
  const names=["performanceAdvisor","performanceMetric","performancePeriod","performanceSource",
    "performanceKpis","performanceTrendTitle","performanceTrendNote","performanceTrendCount",
    "performanceChanges","performanceAdvisorNote","performanceAdvisorTable"];
  const ui=Object.fromEntries(names.map(name=>[name,element()]));
  ui.performanceAdvisor.value="store";ui.performanceMetric.value="totalGross";
  const consumers=[],charts=[];
  const ctx=vm.createContext({
    Date,model,ui,document:{createElement:()=>element()},
    Option:function Option(label,value){this.label=label;this.value=value;},
    performanceEntity:(item,selection)=>selection==="store"?item.store:item.advisors?.[selection],
    performanceDelta:(current,prior,key)=>current&&prior&&
      Number.isFinite(current[key])&&Number.isFinite(prior[key])?current[key]-prior[key]:null,
    performanceFormat:value=>Number.isFinite(value)?String(Math.round(value)):"—",
    performanceMetricMeta:{totalGross:["Total gross","money"]},
    advisorShownInSection:()=>true,
    renderPerformanceChart:points=>{charts.push(...points);},
    sourceFreshness:()=>({safeForCurrent:true,reportPeriodVerified:true}),
    sourceLineageLabel:()=>"VERIFIED",
    trackerOpenCount:()=>null,
    renderPerformanceExecutive:item=>{consumers.push(["Executive",item.periodEnd]);},
    renderCurrentMonthTrend:item=>{consumers.push(["Trend",item.periodEnd]);},
    renderControllables:item=>{consumers.push(["Controllables",item.periodEnd]);}
  });
  vm.runInContext([
    selector,meetingSelector,performance,
    "const renderPerformanceBase=renderPerformance;",
    wrapper,
    "this.api={current:currentSaprSnapshot,meeting:latestVerifiedMeetingSnapshot,render:renderPerformance};"
  ].join("\n"),ctx);
  return {model,ui,consumers,charts,api:ctx.api};
}

test("59-01 corrected earlier SAPR import does not split Home/Meeting/Performance source period",()=>{
  const snapshots={
    "2026-10-19":snapshot("2026-10-19","2026-10-19T21:00:00Z",2000),
    "2026-10-20":snapshot("2026-10-20","2026-10-23T21:00:00Z",2200),
    "2026-10-21":snapshot("2026-10-21","2026-10-21T21:00:00Z",2700)
  };
  const before=JSON.stringify(snapshots),f=harness(snapshots);
  const oldDateKeyOnly=snapshots[Object.keys(snapshots).sort().at(-1)];
  assert.equal(oldDateKeyOnly.periodEnd,"2026-10-21",
    "prechange Performance selected the later date regardless of verified import authority");
  assert.equal(f.api.current(true).periodEnd,"2026-10-20");
  assert.equal(f.api.meeting().periodEnd,"2026-10-20");
  f.api.render();
  assert.equal(f.ui.performancePeriod.textContent,"2026-10-01 through 2026-10-20");
  assert.match(f.ui.performanceSource.textContent,/synthetic-sapr-2026-10-20/);
  const cards=f.ui.performanceKpis.children;
  assert.equal(cards[0].children[1].textContent,"2200","shown gross uses selected authoritative import");
  assert.match(cards[0].children[2].textContent,/vs 2026-10-19/,
    "the previous comparison must not use the current source or a future report");
  assert.deepEqual(JSON.parse(JSON.stringify(f.consumers)),[
    ["Executive","2026-10-20"],["Trend","2026-10-20"],["Controllables","2026-10-20"]
  ],"every Performance section uses the same period as Home and Meeting");
  assert.equal(JSON.stringify(snapshots),before,"rendering changes no source, manual data or import lineage");
});

test("59-01 a fully finished positive SAPR working-day period remains verified for Home and Meeting",()=>{
  const final=snapshot("2026-10-31","2026-11-01T12:00:00Z",5200,22,22,true);
  const f=harness({"2026-10-30":snapshot("2026-10-30","2026-10-30T22:00:00Z",4900,21,22),
    "2026-10-31":final});
  assert.equal(f.api.current(true)?.periodEnd,"2026-10-31",
    "completed==total is a valid final monthly working-day observation");
  assert.equal(f.api.meeting()?.periodEnd,"2026-10-31");
  f.api.render();
  assert.equal(f.ui.performancePeriod.textContent,"2026-10-01 through 2026-10-31");
  assert.equal(f.ui.performanceKpis.children[0].children[1].textContent,"5200");
});

test("59-01 impossible or unverified day counts cannot supersede known good source authority",()=>{
  for(const [completed,total,verified] of [[-1,22,true],[23,22,true],[0,0,true],[10,22,false]]){
    const f=harness({
      "2026-10-19":snapshot("2026-10-19","2026-10-19T20:00:00Z",2000,8,22),
      "2026-10-20":snapshot("2026-10-20","2026-10-23T20:00:00Z",2700,completed,total,verified)
    });
    assert.equal(f.api.current(true)?.periodEnd,"2026-10-19");
    assert.equal(f.api.meeting()?.periodEnd,"2026-10-19");
    f.api.render();
    assert.equal(f.ui.performancePeriod.textContent,"2026-10-01 through 2026-10-19");
    assert.equal(f.ui.performanceKpis.children[0].children[1].textContent,"2000");
  }
});

test("59-01 retains legacy Performance fallback and selects newly verified current report",()=>{
  const legacy=snapshot("2026-10-20","",2300,0,0,false);
  legacy.validation.advisorDetailSheets=0;
  const old=harness({"2026-10-20":legacy});
  assert.equal(old.api.current(),null);
  old.api.render();
  assert.equal(old.ui.performanceKpis.children[0].children[1].textContent,"2300",
    "legacy Performance remains visible but cannot falsely become verified Home/Meeting authority");
  const f=harness({
    "2026-10-20":snapshot("2026-10-20","2026-10-20T20:00:00Z",2000,8,22),
    "2026-10-21":snapshot("2026-10-21","2026-10-22T20:00:00Z",3100,9,22)
  });
  f.api.render();
  assert.equal(f.api.current(true).periodEnd,"2026-10-21");
  assert.equal(f.ui.performanceKpis.children[0].children[1].textContent,"3100");
  assert.match(f.ui.performanceKpis.children[0].children[2].textContent,/vs 2026-10-20/);
});
