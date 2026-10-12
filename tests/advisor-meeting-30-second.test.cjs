"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,"..");
const app=fs.readFileSync(path.join(root,"assets/app.js"),"utf8");
const css=fs.readFileSync(path.join(root,"src/meeting-presenter.css"),"utf8");
const runtime=fs.readFileSync(path.join(root,"assets/meeting.css"),"utf8");
const start=app.indexOf("  function meetingAdvisorTv("),end=app.indexOf("  function attachMeetingAdvisorTv(",start);
assert.ok(start>0&&end>start,"TV presentation must be connected to the app");
const presenter=app.slice(start,end);
function scenario(opts={}){
 const current=opts.current!==false,older=!!opts.older, responses=opts.responses??0,missing=opts.missing??[];
 const knownMetrics=["cpElr","cpHoursPerRo","mediaViewed","texting","vir","menuPresentation","menuPenetration","dealerNps"];
 const testGoals=[230,2.1,86,98,92,78,42,95];
 const context={Number,Math,Intl,String,
   standard:key=>testGoals[knownMetrics.indexOf(key)],
   virMeetingEvidence:()=>({verified:current&&!older,status:older?"stale":current?"verified":"missing-source"}),
   virObservationDate:()=> "2026-10-08",
   latestOperationalSnapshot:key=>({releaseWeek:"2026-10-05",advisors:{test:key==="vir"?{utilization:94}:{presentation:81,penetration:43}}}),
   menuMeetingEvidence:()=>({verified:current&&!older,status:older?"stale":current?"verified":"missing-source"}),
   csiMetricEvidence:()=>({verified:current&&responses>0}),
   performanceFormat:(n,k)=>k==="money"?"$"+Math.round(n).toLocaleString("en-US"):String(Math.round(n)),
   compactMoney:n=>"$"+(n/1000).toFixed(1)+"K",
   shortDate:d=>({"2026-10-11":"Oct 11","2026-10-08":"Oct 8","2026-10-05":"Oct 5","2026-10-10":"Oct 10"})[d]||"Oct 11"
 };
 const render=vm.runInNewContext(presenter+"\nmeetingAdvisorTv;",context);
 const fields=["totalGross","cpElr","cpHours","mediaViewed","texting"],values=[29600,215,1.9,93,92];
 const entity=Object.fromEntries(fields.map((k,i)=>[k,values[i]]));
 return render("test",{periodEnd:"2026-10-11",validation:{saprDaysVerified:current,finalTotalsVerified:current},saprDaysCompleted:7,saprTotalDays:23},entity,
   {configured:true,target:67000+8000,roundedDaily:2800,remainingDays:16.5,achieved:false},
   {current:{total:opts.week?12000:null,missingDates:missing},prior:{total:null}},
   {label:"ALIGNMENTS",measure:"Need 1 more sale",action:"BY NEXT MEETING",achieved:false},
   {responses,nps:responses?100:null});
}
test("Advisor's actual TV rendering tells a simple production and next-win story",()=>{
 const html=scenario({current:true,week:true,responses:2});
 for(const word of ["broadcast-tv","THIS MONTH","NEEDED EACH WORKDAY","ON PACE TO BEAT YOUR GOAL","DOING WELL","NEEDS ATTENTION","NEXT WIN","ALIGNMENTS","1 MORE SALE","BEFORE NEXT MEETING"])assert.ok(html.includes(word),word);
 assert.match(html,/rx-track/);
 assert.ok(html.includes("$29.6K"));
 assert.match(html,/rx-hero/);
 assert.doesNotMatch(html,/PERFORMANCE TELEMETRY|SAPR|HISTORICAL|VERIFIED|CONFIGURED GOAL|CURRENTNESS|Review tire wear/i);
 assert.doesNotMatch(html,/tv-coaching|tv-metric/);
});
test("Clearly dated older numbers do not join current wins or warnings",()=>{
 const html=scenario({current:true,older:true,responses:0});
 assert.match(html,/LAST REPORTED/);
 assert.match(html,/UPDATED Oct 8/i);
 assert.match(html,/UPDATED Oct 5/i);
 assert.doesNotMatch(html,/HISTORICAL|VERIFIED/);
 assert.ok(html.includes("INSPECTIONS"));
});
test("Missing week says exactly what the advisor is waiting for",()=>{
 const html=scenario({missing:["2026-10-10"]});
 assert.match(html,/WAITING FOR OCT 10/);
 assert.doesNotMatch(html,/1 DAYS MISSING|SAPR|UNVERIFIED/);
});
test("Missing evidence never becomes a claimed win or zero score",()=>{
 const html=scenario({current:false,older:false});
 assert.match(html,/YOUR RESULTS|LATEST RESULTS COMING SOON/);
 assert.doesNotMatch(html,/CUSTOMER SCORE.*0%/s);
 assert.doesNotMatch(html,/HISTORICAL|VERIFIED|SAPR/);
});
test("Action remains tied to imported opportunity, never a generic explanation paragraph",()=>{
 const html=scenario();
 assert.match(html,/ALIGNMENTS/);
 assert.match(html,/1 MORE SALE/);
 assert.match(html,/BEFORE NEXT MEETING/);
 assert.doesNotMatch(html,/Review tire|offer an alignment|when indicated/);
});
test("Active, not dormant, meeting code attaches advisor output for complete and missing rows",()=>{
 const start=app.indexOf("function renderMeetingV3Accurate()"),end=app.indexOf("function decorateMeetingCycle",start);
 const active=app.slice(start,end);
 assert.equal(active.split("attachMeetingAdvisorTv(card, code, latest,").length-1,2);
 assert.match(app,/renderMeeting = function renderMeetingWithCycle\(\) \{ renderMeetingV3Accurate\(\)/);
 assert.match(app,/classList.add\("tv-ready"\)/);
 assert.match(app,/MOONDOG <em>LIVE<\/em>/);
 assert.match(active,/UPDATED THROUGH/);
});
test("Broadcast CSS matches bundled runtime and retains fallback-safe visibility",()=>{
 const a="/* BEGIN GENERATED MEETING LAYOUT (see src/meeting-presenter.css) */",b="/* END GENERATED MEETING LAYOUT */";
 assert.equal(runtime.split(a)[1].split(b)[0].trim(),css.trim());
 assert.match(css,/MOONDOG BROADCAST REINVENTION/);
 assert.match(css,/\.advisor-tv\.broadcast-tv/);
 assert.match(css,/\.rx-next/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/\.meeting-v3-advisor\[data-slide-active="true"\]\.tv-ready>:not\(h3\):not\(\.advisor-tv\)\{display:none!important\}/);
});
