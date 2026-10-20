"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.join(__dirname,"..");
const app=fs.readFileSync(path.join(root,"assets","app.js"),"utf8");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const css=fs.readFileSync(path.join(root,"assets","performance.css"),"utf8");
const start=app.indexOf("  function renderAtoTaskPerformance()");
const end=app.indexOf("  const renderPerformanceBeforeNavigationReuse=renderPerformance;",start);
assert.ok(start>=0&&end>start,"ATO view renderer must exist inside the current runtime");
const renderer=app.slice(start,end);

function element(tag){
  return {
    tag,children:[],textContent:"",
    append(...children){this.children.push(...children);},
    replaceChildren(...children){this.children=[...children];}
  };
}
function run(snapshots){
  const panels=Object.fromEntries(["atoTaskPerformance","atoTaskPerformanceScope",
    "atoTaskPerformanceKpis","atoTaskPerformanceFootnote"].map(id=>[id,element("section")]));
  const doc={getElementById:id=>panels[id],createElement:element};
  const context={document:doc,model:{operationalMetrics:{supplementalReports:{snapshots}}}};
  vm.runInNewContext(renderer+";renderAtoTaskPerformance();",context);
  return panels;
}
const synthetic=(metrics,importedAt="2026-10-18T12:00:00Z",override={})=>({
  family:"ato-task-performance",importedAt,
  metrics:{verifiedSummary:metrics},
  validation:{supplementalOnly:true,kpiPromotion:false,grandTotalsVerified:true,...override}
});

test("Advisor Performance contains a real ATO Task Performance panel",()=>{
  assert.match(html,/id="view-performance"[\s\S]*id="atoTaskPerformance"/);
  assert.match(html,/id="atoTaskPerformanceKpis"/);
  assert.match(css,/\.ato-task-kpis/);
  assert.match(app,/renderPerformanceBeforeNavigationReuse\(\.\.\.args\);\s*renderAtoTaskPerformance\(\)/);
  assert.match(app,/snapshot\.family==="ato-task-performance"\)\{invalidateNavigationRenders\(\)/);
  new vm.Script(app);
});
test("No imported ATO means no fabricated zeros or advisor completion metrics",()=>{
  const ui=run({});
  assert.equal(ui.atoTaskPerformanceKpis.children.length,0);
  assert.match(ui.atoTaskPerformanceScope.textContent,/No ATO task report imported/);
});
test("Verified source-wide ATO measures are visible but never labeled as advisor/store results",()=>{
  const verified=synthetic({
    totalTasks:100,completedTasks:96,completionRate:96,
    avgCompletionHours:2.5,pctUnderOneHour:42.2,pctOver24Hours:8.1
  });
  const ui=run({sample:verified});
  const rows=ui.atoTaskPerformanceKpis.children;
  assert.equal(rows.length,6);
  assert.equal(rows[0].children[1].textContent,"100");
  assert.equal(rows[2].children[1].textContent,"96.0%");
  assert.equal(rows[3].children[1].textContent,"2.50 hrs");
  assert.match(ui.atoTaskPerformanceScope.textContent,/NOT this store.s or any advisor.s confirmed KPIs/);
  assert.ok(rows.every(row=>row.children[2].textContent.includes("not advisor-specific")));
  assert.match(ui.atoTaskPerformanceFootnote.textContent,/No verified advisor-level breakdown/);
});
test("Unverified totals, wrong source family or promoted KPI data are excluded",()=>{
  const values={totalTasks:200,completedTasks:199,completionRate:99.5};
  const unsafe=synthetic(values,"2026-10-19T12:00:00Z",{grandTotalsVerified:false});
  const ui=run({unsafe});
  assert.equal(ui.atoTaskPerformanceKpis.children.length,0);
  assert.match(ui.atoTaskPerformanceScope.textContent,/could not be verified/);
  const promoted=run({promoted:synthetic(values,"2026-10-19T12:00:00Z",{kpiPromotion:true})});
  assert.equal(promoted.atoTaskPerformanceKpis.children.length,0);
});
test("Most recently imported eligible ATO summary is used, regardless of key",()=>{
  const a=synthetic({totalTasks:10,completedTasks:10,completionRate:100});
  const b=synthetic({totalTasks:20,completedTasks:19,completionRate:95},"2026-10-20T12:00:00Z");
  const ui=run({zzz:a,aaa:b});
  assert.equal(ui.atoTaskPerformanceKpis.children[0].children[1].textContent,"20");
  assert.match(ui.atoTaskPerformanceFootnote.textContent,/observations: 2/);
});
