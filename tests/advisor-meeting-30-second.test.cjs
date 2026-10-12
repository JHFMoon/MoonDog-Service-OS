"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,"..");
const app=fs.readFileSync(path.join(root,"assets/app.js"),"utf8");
const css=fs.readFileSync(path.join(root,"src/meeting-presenter.css"),"utf8");
const bundle=fs.readFileSync(path.join(root,"assets/meeting.css"),"utf8");
const begin=app.indexOf("  function meetingAdvisorTv("),end=app.indexOf("  function attachMeetingAdvisorTv(",begin);
assert.ok(begin>0&&end>begin,"Arena renderer must be in the live application");
const source=app.slice(begin,end);
function render(opts={}){
 const current=opts.current!==false,older=!!opts.older,nps=opts.nps??0;
 const metricNames=["cpElr","cpHoursPerRo","mediaViewed","texting","vir","menuPresentation","menuPenetration","dealerNps"];
 const sampleTargets=[230,2.1,86,98,92,78,42,95];
 const context={Math,Number,Intl,Date,console,
  standard:key=>sampleTargets[metricNames.indexOf(key)],
  performanceFormat:(n,kind)=>kind==="money"?"$"+Math.round(n).toLocaleString("en-US"):String(Math.round(n)),
  compactMoney:n=>"$"+(n/1000).toFixed(1)+"K",
  shortDate:d=>({"2026-10-11":"Oct 11","2026-10-08":"Oct 8","2026-10-05":"Oct 5","2026-10-10":"Oct 10"})[d]||"Oct 11",
  meetingEscape:s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),
  virMeetingEvidence:()=>({verified:current&&!older,status:older?"stale":current?"verified":"missing-source"}),
  virObservationDate:()=> "2026-10-08",
  latestOperationalSnapshot:key=>({releaseWeek:"2026-10-05",advisors:{test:key==="vir"?{utilization:94}:{presentation:81,penetration:43}}}),
  menuMeetingEvidence:()=>({verified:current&&!older,status:older?"stale":current?"verified":"missing-source"}),
  csiMetricEvidence:()=>({verified:current&&nps>0}),
 };
 const functionBody=vm.runInNewContext(source+"\nmeetingAdvisorTv;",context);
 const values=[29600,215,1.9,93,92];
 const entity=Object.fromEntries(["totalGross","cpElr","cpHours","mediaViewed","texting"].map((key,i)=>[key,values[i]]));
 return functionBody("test",
 {periodEnd:"2026-10-11",validation:{saprDaysVerified:current,finalTotalsVerified:current},saprDaysCompleted:7,saprTotalDays:23},
 entity,{configured:true,target:67000+8000,roundedDaily:2800,remainingDays:16.5,achieved:false},
 {current:{total:null,missingDates:opts.missing??["2026-10-10"]},prior:{total:null}},
 {label:opts.label??"ALIGNMENTS",measure:"Need 1 more sale",achieved:false},
 {responses:nps,nps:nps?100:null});
}
test("Arena stage has real progress ring, giant gross, one prominent objective",()=>{
 const html=render();
 for(const label of ["arena-advisor","aa-earnings","aa-money","aa-circle","aa-ring-value","aa-race-line","aa-pulse","aa-next","NEXT WIN","ALIGNMENTS","1 MORE SALE","NEEDED EACH WORKDAY"])assert.ok(html.includes(label),label);
 assert.ok(html.includes("$29.6K"));
 assert.match(html,/NEEDS A STRONGER FINISH|ON PACE/);
 assert.doesNotMatch(html,/PERFORMANCE TELEMETRY|SAPR|HISTORICAL|CONFIGURED GOAL|SOURCE RECONCILIATION|Review tire wear/i);
});
test("Older results show update date and are never categorized as current wins",()=>{
 const html=render({older:true});
 assert.match(html,/UPDATED OCT 8/i);
 assert.match(html,/UPDATED OCT 5/i);
 assert.match(html,/LAST REPORTED/);
 assert.doesNotMatch(html,/HISTORICAL|VERIFIED/);
});
test("Incomplete week is human-readable, without pretending a weekly total exists",()=>{
 const html=render({missing:["2026-10-10"]});
 assert.match(html,/WAITING FOR OCT 10/);
 assert.doesNotMatch(html,/1 DAYS MISSING|SAPR|WEEKLY TOTAL WITHHELD/);
});
test("No survey result is never presented as zero or achievement",()=>{
 const html=render({nps:0});
 assert.doesNotMatch(html,/CUSTOMER SCORE<\/b><strong>0/);
});
test("Missing validated SAPR cannot turn monthly gross into a real measurement",()=>{
 const html=render({current:false});
 assert.match(html,/LATEST NUMBERS PENDING/);
 assert.match(html,/PROJECTION NOT READY/);
 assert.doesNotMatch(html,/\$29\.6K/);
});
test("Names are escaped before entering HTML markup",()=>{
 const html=render({label:"<img src=x onerror=alert(1)>"});
 assert.ok(html.includes("&lt;img"));
 assert.ok(!html.includes("<img"));
});
test("Arena store is attached to the ACTUAL renderer; safe fallback remains",()=>{
 const a=app.indexOf("function renderMeetingV3Accurate()"),b=app.indexOf("function decorateMeetingCycle",a);
 const live=app.slice(a,b);
 assert.match(live,/renderMeetingArenaStore\(view,latest,grossWindow,virEvidence,menuPresentation,menuPenetration,dealer\)/);
 assert.match(app,/view\.classList\.add\("arena-ready"\)/);
 assert.match(app,/classList\.remove\("arena-ready"\)/);
 assert.equal(live.split("attachMeetingAdvisorTv(card, code, latest,").length-1,2);
 assert.match(app,/renderMeeting = function renderMeetingWithCycle\(\) \{ renderMeetingV3Accurate\(\)/);
});
test("Original overview remains available, CSS generated bundle stays identical",()=>{
 assert.match(css,/MOONDOG ARENA/);
 assert.match(css,/\.arena-store/);
 assert.match(css,/\.arena-advisor/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 const start="/* BEGIN GENERATED MEETING LAYOUT (see src/meeting-presenter.css) */";
 const stop="/* END GENERATED MEETING LAYOUT */";
 assert.equal(bundle.split(start)[1].split(stop)[0].trim(),css.trim());
 assert.match(css,/\.tv-ready>:not\(h3\):not\(\.advisor-tv\)\{display:none!important\}/);
});

test("Store chart never counts a closed Sunday as a reported operating day",()=>{
 const first=app.indexOf("  function renderMeetingArenaStore("),last=app.indexOf("  function attachMeetingAdvisorTv(",first);
 assert.ok(first>=0&&last>first,"Live Arena store renderer required");
 const presenter=app.slice(first,last);
 let inserted=null,ready=false;
 const context={Number,Math,Date,console,
   document:{createElement(){return {className:"",innerHTML:"",setAttribute(){}};}},
   compactMoney:n=>Math.round(n).toLocaleString("en-US"),
   shortDate:d=>({"2026-10-11":"Oct 11","2026-10-10":"Oct 10","2026-10-08":"Oct 8","2026-10-05":"Oct 5"})[d]||"DAY",
   meetingEscape:v=>String(v),
   sourceFreshness:()=>({safeForCurrent:false}),
   virObservationDate:()=> "2026-10-08",
   latestOperationalSnapshot:k=>k==="vir"?{observationTimestamp:"2026-10-08T12:00:00Z"}:
     {releaseWeek:"2026-10-05",store:{presentation:77,penetration:33}},
   storeMeetingNextOpportunity:()=>null
 };
 const show=vm.runInNewContext(presenter+"\nrenderMeetingArenaStore;",context);
 const view={
   querySelector:selector=>selector===".arena-store"?null:selector===".meeting-scoreboard-head"?{after(el){inserted=el;}}:null,
   classList:{add(name){if(name==="arena-ready")ready=true;},remove(){ready=false;}}
 };
 const days=["2026-10-05","2026-10-06","2026-10-07","2026-10-08","2026-10-09","2026-10-10","2026-10-11"];
 const points=days.map((date,i)=>({date,value:i===5?null:i===6?0:(i+1)*1000,available:i!==5,closed:i===6}));
 show(view,{periodEnd:"2026-10-11",validation:{finalTotalsVerified:true},store:{totalGross:85000}},
   {current:{points,missingDates:["2026-10-10"],total:null}},
   {verified:true,value:77},
   {verified:true,period:"2026-10-05"},
   {verified:false},
   {responses:0});
 assert.ok(ready,"Arena Store should render");
 const html=inserted?.innerHTML||"";
 assert.match(html,/5 OF 6 OPEN DAYS REPORTED/);
 assert.match(html,/WAITING FOR OCT 10/);
 assert.match(html,/class="as-bar closed"><b>CLOSED/);
 assert.doesNotMatch(html,/6 DAYS REPORTED|\$0<\/b>/);
 assert.match(html,/UPDATED OCT 8/);
 assert.match(html,/WEEK OF OCT 5/);
 assert.doesNotMatch(html,/>CURRENT<\/small>/);
});
