"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"..");
const app=fs.readFileSync(path.join(root,"assets/app.js"),"utf8");
const runtime=fs.readFileSync(path.join(root,"assets/daily-ops.js"),"utf8");
const source=fs.readFileSync(path.join(root,"src/meeting-presenter.js"),"utf8");
const css=fs.readFileSync(path.join(root,"assets/daily-ops.css"),"utf8");
const smoke=fs.readFileSync(path.join(root,"scripts/smoke_overdrive.mjs"),"utf8");
test("Hidden meeting/performance/arrivals/dispatch views aren't rebuilt during initial renderAll",()=>{
 const start=app.indexOf("  function renderAll() {");
 const end=app.indexOf("  const renderAllWithCanonicalSourceLabels=",start);
 assert.ok(start>0&&end>start);
 const content=app.slice(start,end);
 for(const [page,call] of [
  ["view-meeting","renderMeeting"],["view-performance","renderPerformance"],
  ["view-arrivals","renderArrivals"],["view-assign-next","renderAssignNext"]]){
  assert.ok(content.includes('ui["'+page+'"]?.classList.contains("active")) '+call+'();'),page);
 }
});
test("Navigation paints meeting shell before expensive data build and cancels obsolete scheduled work",()=>{
 const start=app.indexOf("  function navigateTo(view,anchor=");
 const end=app.indexOf("  function ensurePhase3Ui()",start);
 assert.ok(start>0&&end>start);
 const nav=app.slice(start,end);
 assert.match(nav,/ensureMeetingV3Shell\(\);\s*requestAnimationFrame\(\(\)=>setTimeout/);
 assert.match(nav,/if\(ticket!==meetingNavigationTicket\|\|!ui\["view-meeting"\]\?\.classList\.contains\("active"\)\)return/);
 assert.match(nav,/globalThis\.__serviceMeetingPresenter\?\.activate\(\)/);
 assert.match(app,/const wasActive=view\.classList\.contains\("active"\); view\.className = "view meeting-view meeting-v3 meeting-scoreboard"\+\(wasActive\?" active":""\)/);
});
test("Runtime presenter exactly matches checked-in source and presentation controls are accessible",()=>{
 const start="// BEGIN GENERATED MEETING PRESENTER (see src/meeting-presenter.js)";
 const end="// END GENERATED MEETING PRESENTER";
 assert.equal(runtime.split(start)[1]?.split(end)[0]?.trim(),source.trim());
 assert.match(source,/data-presentation-help hidden/);
 assert.match(source,/help\.textContent="Full screen was blocked by Edge\./);
 assert.match(source,/role="status" aria-live="polite"/);
});
test("Narrow Edge pane reflows instead of clipping a full TV stage",()=>{
 assert.match(css,/@media\(max-width:1080px\)/);
 assert.match(css,/container-type:inline-size/);
 assert.match(css,/\.arena-store \.as-upper,\.arena-store \.as-lower\{display:flex;flex-direction:column/);
 assert.match(css,/\.arena-advisor \.aa-next\{[\s\S]*?position:relative!important/);
 assert.match(smoke,/page\.setViewportSize\(\{width:830,height:820\}\)/);
 assert.match(smoke,/narrowStore\.lowerInside/);
 assert.match(smoke,/narrowAdvisor\.pctWithinRing/);
 assert.match(smoke,/Return-to-wide-monitor geometry failed/);
});

test("Open RO table is rendered only when active and refreshed on navigation",()=>{
 const start=app.indexOf("  function renderAll() {");
 const end=app.indexOf("  const renderAllWithCanonicalSourceLabels=",start);
 const content=app.slice(start,end);
 assert.ok(content.includes('if(ui["view-open-ro"]?.classList.contains("active"))renderTable();'));
 const nav=app.slice(app.indexOf("  function navigateTo(view,anchor="),app.indexOf("  function ensurePhase3Ui()"));
 assert.ok(nav.includes('if(view==="open-ro")renderTable();'));
});
