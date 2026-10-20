"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const app = fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const section=(start,end)=>{
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0 && b>a,"Missing source section: "+start);
  return app.slice(a,b);
};
const activity=section("  function parseAppointmentActivityWorkbook(","  function normalizedPerson(");
const aging=section("  function parseOpenRoAgingByAsmWorkbook(","  function parseSupplementalWorkbook(");
const references=section("  function parseAtoTaskPerformancePdf(","  function parseSupplementalPdfReport(");
const base={
  text:v=>String(v??""),norm:v=>String(v??"").toLowerCase().trim(),
  now:()=> "2026-10-20T00:00:00.000Z",
  isoCell:v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)?v:"",
  reportStoreCode:()=> "9001",
  reportTextLines:s=>String(s).split(/\n+/).map(x=>x.trim()).filter(Boolean),
  reportNumber:v=>Number(String(v).replace(/,/g,""))
};
function compile(source,extra={}){
  const ctx={...base,...extra};
  vm.runInNewContext(source,ctx);
  return ctx;
}
function activityRow(store,created,appointment,interaction){
  const a=Array(19).fill(null);
  a[1]=store;a[5]=interaction;a[7]="Fake";a[8]="Customer";
  a[9]="SYNTHETIC-ONLY";a[14]=created;a[15]=appointment;
  a[17]="synthetic private note that must not persist";
  return a;
}
test("appointment activity accepts 18/19-column sources, isolates store and keeps aggregates only",()=>{
  const header=["S. No.","Store Code","Store Name","ASD Market","ASD","Interaction",
    "Customer No.","First Name","Last Name","VIN","Make","Model","Year",
    "Contacted Date","Appt Creation Date","Appt Set Date","Appt Time","Appt Notes"];
  const rows=[header,
    activityRow("9001","2026-10-12","2026-10-12","SERVICE_REMINDER").slice(0,18),
    activityRow("9001","2026-10-13","2026-10-20","SERVICE_REMINDER"),
    activityRow("9001","2026-10-13","2026-11-20","SERVICE_CHECK"),
    activityRow("1002","2026-10-13","2026-10-13","OTHER")];
  const cx=compile(activity,{workbookGrid:()=>({rows})});
  const out=cx.parseAppointmentActivityWorkbook(new Uint8Array([1]),"synthetic.xlsx");
  assert.equal(out.rowCount,3);
  assert.equal(out.byCreationDate["2026-10-13"],2);
  assert.equal(out.byInteraction.SERVICE_REMINDER,2);
  assert.equal(out.leadTimeBuckets.sameDay,1);
  assert.equal(out.leadTimeBuckets.days1to7,1);
  assert.equal(out.leadTimeBuckets.over30,1);
  assert.equal(out.validation.kpiPromotion,false);
  assert.equal(out.validation.piiRowsNotRetained,3);
  assert.doesNotMatch(JSON.stringify(out),/Fake|Customer|SYNTHETIC-ONLY|synthetic private note/);
});
test("appointment activity refuses missing configured store and unverified dates",()=>{
  const header=["Store Code","Interaction","Contacted Date","Appt Creation Date","Appt Set Date","Appt Time"];
  const rows=[header,["other","CALL","","","",""],["else","CALL","","","",""]];
  const ctx=compile(activity,{workbookGrid:()=>({rows})});
  assert.throws(()=>ctx.parseAppointmentActivityWorkbook([],"synthetic.xlsx"),/store filtering/);
});
test("advisor-grouped Open RO report remains nonauthoritative and contains no individual RO details",()=>{
  const rows=[
    ["SVCADV : SYNTHETIC"],[],
    [null,"REPORT OF OPEN ROS BY ADVISOR - 3 Rows Returned"],
    [null,"RO","TAG-NO","OPEN-DATE","RO-CNT","DAYS","CUSTOMERNAME","STATUS","TYPES"],
    [null,"123456","TAG-X","2026-10-16",1,4,"Fake Customer","OPENED","C"],
    [null,"123457","TAG-Y","2026-10-11",1,9,"Other Customer","WORKING","W"],
    [null,"TOTAL"]];
  const cx=compile(aging,{workbookGrid:()=>({rows})});
  const out=cx.parseOpenRoAgingByAsmWorkbook([],"synthetic.xlsx");
  assert.equal(out.metrics.verifiedRows,2);
  assert.equal(out.metrics.reportedRows,3);
  assert.equal(out.metrics.aging.days2to4,1);
  assert.equal(out.metrics.aging.days5plus,1);
  assert.equal(out.validation.authoritativeRoster,false);
  assert.equal(out.validation.reportedAndVerifiedCountsMatch,false);
  assert.doesNotMatch(JSON.stringify(out),/TAG-X|TAG-Y|123456|123457|Fake Customer|Other Customer/);
});
test("ATO PDF preserves report-level ambiguity instead of promoting mixed market totals",()=>{
  const cx=compile(references);
  const pdf="TASK_WEEK 01/01/2026 10/01/2026\n"+
    "Total Tasks 12 13 25\nCompleted Tasks 11 13 24\n"+
    "Completion Rate 91.7% 100.0% 96.0% MK02-AA\n"+
    "Avg Completion Hours 3.5 2.0 2.75\n"+
    "Pct Under 1 Hour 20.0% 40.0% 30.0% MK02-BB\n"+
    "Pct Over 24 Hours 9.0% 1.0% 5.0% MK02-CC\n";
  const out=cx.parseAtoTaskPerformancePdf(pdf,"synthetic.pdf");
  assert.equal(out.metrics.verifiedSummary.totalTasks,25);
  assert.equal(out.metrics.verifiedSummary.completedTasks,24);
  assert.equal(out.metrics.verifiedSummary.completionRate,96);
  assert.equal(out.metrics.verifiedSummary.pctUnderOneHour,30);
  assert.equal(out.validation.sourceScopeVerified,false);
  assert.equal(out.validation.kpiPromotion,false);
});
test("training guide records procedural rule, never asserts actual enrollment",()=>{
  const cx=compile(references);
  const out=cx.parseTrainingRegistrationGuide(
    "Events Calendar usage for identifying Status: Registered classes","synthetic.pdf");
  assert.match(out.metrics.statusRule,/Only Registered/);
  assert.equal(out.validation.trainingRosterVerified,false);
  assert.equal(out.validation.kpiPromotion,false);
});
test("generic browser bundle includes new verified source registry",()=>{
  new vm.Script(app);
  assert.match(app,/return"ato-task-performance"/);
  assert.match(app,/return"training-registration-guide"/);
  assert.match(app,/return parseOpenRoAgingByAsmWorkbook/);
  assert.match(app,/acceptsMissingRemarks:true/);
});
