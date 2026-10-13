"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const daily=fs.readFileSync(path.join(__dirname,"..","assets","daily-ops.js"),"utf8");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const css=fs.readFileSync(path.join(__dirname,"..","assets","daily-ops.css"),"utf8");
const slice=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i+a.length);assert.ok(i>=0&&j>i,a+" / "+b);return s.slice(i,j);};
const planner=slice(daily,"  function reportPresentationPlan(","  function renderReportImportCard(");
function runPlanner(rows,asOf="2026-10-12"){
 const cx={globalThis:{MoonDogFreshness:{mondayFor:day=>{let d=new Date(day+"T12:00:00Z");d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10)}}}};
 vm.runInNewContext(planner+"this.plan=reportPresentationPlan;this.period=reportPeriodInstruction;",cx);
 return {plan:cx.plan(rows,asOf),period:cx.period};
}
const row=(key,state,missing=[],opts={})=>({key,source:opts.source||key,
  need:{state,reason:opts.reason||"Source verified for matching business purpose.",actions:opts.actions||[]},
  trend:{kind:opts.kind||"optional",missing,status:opts.status||"Current"},
  coverage:{actions:[],details:[]}});
test("October 12 separates immediate needs, awaiting releases, required history and optional observation dates",()=>{
 const rows=[
  row("openRo","NEED NOW",[],{kind:"none"}),
  row("csi","NEED NOW",[],{kind:"recoverable"}),
  row("sapr","CURRENT",["2026-10-10"],{kind:"required"}),
  row("menu","AWAITING RELEASE",["2026-10-05","2026-10-12"],{kind:"required"}),
  row("nextAppointments","OPTIONAL",["2026-10-01","2026-10-02","2026-10-03","2026-10-08","2026-10-09","2026-10-10"],{kind:"optional"}),
  row("vir","CURRENT",["2026-10-01","2026-10-05"],{kind:"optional"}),
  row("sor","OPTIONAL",["2026-10-13"],{kind:"optional"}),
  row("supervisorWorkbook","ON DEMAND",[],{kind:"none"})
 ];
 const {plan,period}=runPlanner(rows);
 assert.equal(plan.now.length,2);
 assert.equal(plan.soon.length,1);
 assert.equal(plan.historical.length,2);
 assert.deepEqual(Array.from(plan.historical.find(x=>x.row.key==="menu").dates),["2026-10-05"]);
 assert.equal(plan.optional.length,4);
 assert.equal(plan.reference.length,1);
 assert.equal(plan.optional.find(x=>x.row.key==="sor").dates.length,0,"future observation is not missing");
 const sapr=plan.historical.find(x=>x.row.key==="sapr");
 assert.match(period(sapr.row,sapr.dates,"historical","2026-10-12")[0],/Oct 1.*through.*Oct 10/);
});
test("October 13 requires the separately missing Monday Menu release, never a Sunday report",()=>{
 const rows=[row("menu","NEED NOW",["2026-10-05","2026-10-12"],{kind:"required"}),row("sapr","CURRENT",["2026-10-11","2026-10-12"],{kind:"required"})];
 const {plan}=runPlanner(rows,"2026-10-13");
 assert.equal(plan.now.length,1);
 assert.deepEqual(Array.from(plan.historical.find(x=>x.row.key==="menu").dates),["2026-10-05","2026-10-12"]);
});
test("report view has five distinct action groups and keeps optional dates out of urgent cards",()=>{
 assert.match(daily,/section\('Needed now',plan\.now,'now'/);
 assert.match(daily,/section\('Needed soon \/ awaiting release',plan\.soon,'soon'/);
 assert.match(daily,/section\('Required historical coverage',plan\.historical,'historical'/);
 assert.match(daily,/section\('Optional reporting and current sources',plan\.optional,'optional'/);
 assert.match(daily,/section\('Reference \/ on demand',plan\.reference,'reference'/);
 assert.match(daily,/const summary=document\.createElement\('p'\)/);
 assert.match(daily,/function renderReportAvailability\(options,rows\)/);
});
test("CSS disables report card implicit grids and supports 320px reflow",()=>{
 const override=css.slice(css.indexOf("/* REPORTS & DATA — stable card layout."));
 assert.match(override,/\.daily-source-row\{display:flex;flex-direction:column/);
 assert.match(override,/\.daily-source-row>\*\{min-width:0!important;max-width:100%/);
 assert.match(override,/@media\(max-width:700px\)/);
 assert.doesNotMatch(override,/word-break:break-all/);
});
test("unknown report cadence is not treated as daily and monthly release handles February",()=>{
 const script=slice(app,"  function reportCadenceDue(","  function reportNeeds(");
 const cadence={value:"auto"};
 const cx={reportCadenceEvidence:()=>cadence,localDateKey:()=>"2026-02-28",
 freshness:{dayOfWeek:d=>new Date(d+"T12:00:00Z").getUTCDay(),addDays:(d,n)=>{const x=new Date(d+"T12:00:00Z");x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)},
  lastDayOfMonth:month=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0,12)).toISOString().slice(0,10)}};
 vm.runInNewContext(script+"this.due=reportCadenceDue",cx);
 assert.equal(cx.due("vir","2026-10-12"),false);
 assert.equal(cx.due("sapr","2026-10-12"),true);
 assert.equal(cx.due("menu","2026-10-12"),false,"unconfirmed Monday release must wait");
 assert.equal(cx.due("menu","2026-10-13"),true,"Tuesday report becomes actionable");
 cadence.value="monthly";cadence.automatic=false;cadence.releaseDay=31;
 assert.equal(cx.due("sor","2026-02-27"),false);
 assert.equal(cx.due("sor","2026-02-28"),true);
 cadence.value="weekly";cadence.releaseDay=1;
 assert.equal(cx.due("menu","2026-10-11"),false);
 assert.equal(cx.due("menu","2026-10-12"),true);
});