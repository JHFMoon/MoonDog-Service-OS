"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const F=require("../assets/freshness.js");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const overview=app.indexOf("  function renderOverviewIntelligence()");
const blockStart=app.indexOf("    if (ui.csiSummary) {",overview);
const blockEnd=app.indexOf("\n  }\n  const renderOverviewIntelligenceBase=",blockStart);
const npsStart=app.indexOf("  function npsSummary(");
const npsEnd=app.indexOf("\n  async function importCsiFile(",npsStart);
assert.ok(overview>=0&&blockStart>overview&&blockEnd>blockStart&&npsEnd>npsStart,
  "extract actual Manager Home CSI renderer and production NPS calculation");
const uiSource=app.slice(blockStart,blockEnd);
const npsSource=app.slice(npsStart,npsEnd);
const coverageStart=app.indexOf("  function validCoverageDate(");
const coverageEnd=app.indexOf("\n  function coverageTimestamp(",coverageStart);
const selectorStart=app.indexOf("  function csiReportedPeriod(");
const selectorEnd=app.indexOf("\n  function metricDependencyEvidence(",selectorStart);
assert.ok(coverageStart>=0&&coverageEnd>coverageStart&&
  selectorStart>=0&&selectorEnd>selectorStart,
  "test must exercise the actual production CSI date/scope and source selectors");
const coverageSource=app.slice(coverageStart,coverageEnd);
const selectorSource=app.slice(selectorStart,selectorEnd);
assert.match(uiSource,/zeroVerified=/,"source zero-confidence guard exists");
assert.match(uiSource,/evidence\.safeForCurrent/,"source freshness is mandatory");

function node(tag){
  return {tag,children:[],textContent:"",className:"",
    append(...children){this.children.push(...children);},
    replaceChildren(...children){this.children=[...children];}};
}
const TODAY="2026-10-07",PERIOD_START="2026-10-01";
function fixture({imports=[],surveys={},periodStart=PERIOD_START}={}){
  const ui={csiSummary:node("section"),csiCoverage:node("div")};
  const model={settings:{csiPeriodStart:periodStart},operationalMetrics:{csi:{imports,surveys}}};
  const context=vm.createContext({
    ui,model,document:{createElement:node},localDateKey:()=>TODAY,
    csiSurveys:surveys,csiCoverage:Object.values(surveys).map(s=>s.surveyDate).sort().at(-1)||"",
    csiRefreshDate:imports.at(-1)?.refreshDate||"",
    sourceExpectation:()=> "recommended",businessTimeZone:()=> "UTC",
    freshness:F
  });
  vm.runInContext(coverageSource+"\n"+selectorSource+"\n"+npsSource+
    "\nfunction renderCsi(){\n"+uiSource+
    "\n}\nthis.renderCsi=renderCsi;",context);
  context.renderCsi();
  const cards=ui.csiSummary.children.map(child=>[child.children[0]?.textContent,child.children[1]?.textContent]);
  return {cards,coverage:ui.csiCoverage.textContent,message:ui.csiSummary.children[0]?.textContent};
}
const verified=(start="2026-10-01",end="2026-10-06")=>({
  sourceFile:"synthetic-cumulative.csv",importedAt:"2026-10-07T15:00:00Z",
  scopeVerified:true,scopeStart:start,scopeEnd:end,refreshDate:TODAY
});

test("verified cumulative CSI zero produces verified response count, not fake NPS zero",()=>{
  const actual=fixture({imports:[verified()]});
  assert.deepEqual(JSON.parse(JSON.stringify(actual.cards)),[
    ["Dealer NPS","Not applicable"],["Responses",0],["Promoters",0],["Detractors",0]
  ]);
  assert.match(actual.coverage,/2026-10-01 through 2026-10-06/);
  assert.match(actual.coverage,/verified cumulative export with zero scoring responses/);
  assert.doesNotMatch(actual.coverage,/no verified coverage/);
});

test("missing, stale and incomplete CSI scope cannot claim verified zero",()=>{
  for(const [scenario,imports] of [
    ["missing",[]],
    ["stale",[verified("2026-10-01","2026-10-02")]],
    ["starts mid-window",[verified("2026-10-04","2026-10-06")]],
    ["future end",[verified("2026-10-01","2026-10-10")]],
    ["unverified scope",[{...verified(),scopeVerified:false}]],
    ["malformed start",[verified("2026-13-01","2026-10-06")]]
  ]){
    const state=fixture({imports});
    assert.deepEqual(JSON.parse(JSON.stringify(state.cards)),[],scenario+" no numeric cards");
    assert.equal(state.message,"No verified CSI responses loaded.",scenario);
    assert.equal(state.coverage,"No verified current scoring-window coverage",scenario);
  }
});

test("positive verified CSI responses retain real NPS, not the zero-response branch",()=>{
  const actual=fixture({imports:[verified()],surveys:{
    syntheticA:{surveyDate:"2026-10-06",classification:"Promoter"}
  }});
  assert.deepEqual(JSON.parse(JSON.stringify(actual.cards)),[
    ["Dealer NPS","100"],["Responses",1],["Promoters",1],["Detractors",0]
  ]);
  assert.match(actual.coverage,/verified Pulse responses/);
});

test("scoring window starting before cumulative report does not invent history",()=>{
  const actual=fixture({imports:[verified()],periodStart:"2026-09-01"});
  assert.equal(actual.message,"No verified CSI responses loaded.");
  assert.equal(actual.coverage,"No verified current scoring-window coverage");
});
