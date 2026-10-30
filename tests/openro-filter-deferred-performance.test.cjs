"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {performance}=require("node:perf_hooks");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf('  let openRoFiltersDirty = true');
const end=app.indexOf('  function renderOverviewPanelsIfNeeded(',start);
assert.ok(start>0&&end>start,"actual production deferred-filter helper is available");
const source=app.slice(start,end);
const p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
function harness(){
 let date="2026-10-30",revision=0,renderCalls=0,rows=2100;
 const fakeChoices=Array.from({length:rows},(_,i)=>({advisor:"Synthetic "+i%12,status:"Open "+i%5}));
 const context={navigationDataRevision:revision,localDateKey:()=>date,renderFilters(){
   renderCalls++;
   const options=[...new Set(fakeChoices.map(x=>x.advisor))].sort();
   const statuses=[...new Set(fakeChoices.map(x=>x.status))].sort();
   if(options.length!==12||statuses.length!==5)throw Error("Synthetic options lost");
 }};
 vm.runInNewContext(source+"
this.paint=renderOpenRoFiltersIfNeeded;",context);\n const fn=context.paint;
 return{fn,context,get count(){return renderCalls;},setDate:value=>date=value,
 setRevision:value=>context.navigationDataRevision=value,
 raw:()=>context.renderFilters()};
}
test("inactive Open RO filter DOM does no work across 2100-row import and Home redraws",()=>{
 const f=harness();
 for(let i=0;i<100;i++)assert.equal(f.fn(false,true),false);
 assert.equal(f.count,0,"off-screen imports must not rebuild options 100 times");
 assert.equal(f.fn(true),true,"first Open RO activation builds options");
 assert.equal(f.count,1);
 for(let i=0;i<100;i++)assert.equal(f.fn(true),false);
 assert.equal(f.count,1,"unchanged tab returns reuse filter choices");
});
test("source revision, dirty background refresh, operating-day rollover and explicit updates invalidate choices",()=>{
 const f=harness();f.fn(true);
 f.setRevision(2);
 assert.equal(f.fn(true),true,"source revision refreshes filters");
 assert.equal(f.fn(true),false);
 f.fn(false,true);
 assert.equal(f.fn(true),true,"hidden import is visible after returning");
 f.setDate("2026-10-31");
 assert.equal(f.fn(true),true,"business-date change refreshes choices");
 assert.equal(f.fn(true,true),true,"foreground import redraw is immediate");
 assert.equal(f.count,5);
});
test("production renderAll defers hidden filters and refreshes them before Open RO table",()=>{
 const a=app.indexOf("  function renderAll() {");
 const b=app.indexOf("  const renderAllWithCanonicalSourceLabels=renderAll;",a);
 assert.ok(a>=0&&b>a);
 const body=app.slice(a,b);
 assert.match(body,/renderOpenRoFiltersIfNeeded\(ui\["view-open-ro"\]\?\.classList\.contains\("active"\), true\)/);
 assert.ok(body.indexOf("renderOpenRoFiltersIfNeeded(")<body.indexOf("renderTable()"),
  "a foreground data change restores select options before table rebuild");
 assert.doesNotMatch(body,/renderFilters\(\);/,"hidden Home renders must not rebuild Open RO select options");
 const n=app.indexOf("  const navigateBeforeDeferredPanelRefresh = navigateTo;");
 const e=app.indexOf("  const navigateWithLearnedFailures = navigateTo;",n);
 const nav=app.slice(n,e);
 assert.match(nav,/if \(view === "open-ro".*?\{[\s\S]*?renderOpenRoFiltersIfNeeded\(true\)/);
});
test("synthetic 2100-row repeated work records skipped redraw count and time without browser/OneDrive claims",t=>{
 const f=harness(),baseline=[],inactive=[];
 for(let trial=0;trial<9;trial++){
   const started=performance.now();
   for(let k=0;k<20;k++)f.raw();
   baseline.push(performance.now()-started);
   const optimized=performance.now();
   for(let k=0;k<20;k++)f.fn(false,true);
   inactive.push(performance.now()-optimized);
 }
 const before=f.count;
 f.fn(true);
 assert.equal(f.count,before+1);
 t.diagnostic(JSON.stringify({scope:"Node synthetic Open RO advisor/status filters; 2100 rows, no real browser DOM or OneDrive",
  baseline:{operationsPerTrial:20,p95Ms:+p95(baseline).toFixed(3)},
  deferred:{operationsPerTrial:0,p95Ms:+p95(inactive).toFixed(3)},
  skippedRebuilds:180}));
});
