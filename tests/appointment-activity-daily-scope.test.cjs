"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function source(start,end){const a=app.indexOf(start),b=app.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return app.slice(a,b);}
const parser=source("  function parseAppointmentActivityWorkbook(","  function normalizedPerson(");
const importer=source("  async function importManagerSource(","  async function classifyImportFile(");
const columns=["S. No.","Store Code","Store Name","ASD Market","ASD","Interaction","Customer No.",
  "First Name","Last Name","VIN","Make","Model","Year","Contacted Date",
  "Appt Creation Date","Appt Set Date","Appt Time","Appt Notes"];
const serialDate=n=>new Date(Date.UTC(1899,11,30)+n*86400000).toISOString().slice(0,10);
const row=(store,created,appt,interaction="SERVICE_REMINDER")=>{
  const result=Array(18).fill(null);
  result[1]=store;result[5]=interaction;result[7]="Synthetic Private First";
  result[8]="Synthetic Private Last";result[9]="SYNTHETIC-ONLY-NOT-VIN";
  result[14]=created;result[15]=appt;result[17]="Synthetic note must not persist";
  return result;
};
function fixture(rows,opts={}){
  const sourceRows=[columns,...rows];
  let durable={};
  const model={operationalMetrics:{},settings:{}};
  const ctx={
    text:v=>String(v??""),
    norm:v=>String(v??"").trim().toLowerCase(),
    now:()=>"2026-10-20T12:00:00.000Z",
    localDateKey:()=>"2026-10-20",
    isoCell:v=>typeof v==="string"&&/^20\d{2}-\d{2}-\d{2}$/.test(v)?v:"",
    reportStoreCode:()=>"9001",
    workbookGrid:()=>({rows:sourceRows}),
    model,
    structuredClone,
    OPERATIONAL_METRICS_PATH:["data","operational-metrics.json"],
    sourceFileHandle:async()=>({getFile:async()=>({lastModified:Date.UTC(2026,9,20)})}),
    dailyEvidenceDate:()=> "2026-10-20",
    internalObservationDate:()=> "",
    pruneDatedSnapshots:s=>s,
    learnTechnicians:()=>{},
    advisorDisplayName:x=>String(x),
    writeJson:async(_path,value)=>{durable=structuredClone(value);},
    readJson:async()=>structuredClone(durable),
    addHistory:async()=>{},
    removeSourceEntry:async()=>{}
  };
  vm.runInNewContext(parser+importer,ctx);
  return{parse:()=>ctx.parseAppointmentActivityWorkbook([],"synthetic-appointments.xlsx"),
    import:()=>ctx.importManagerSource("synthetic-appointments.xlsx","appointment-activity",[],false),ctx,model,durable:()=>durable};
}
test("vendor serial dates and ISO dates produce separate verified store days",()=>{
  const d1=serialDate(46310),d2=serialDate(46312);
  const f=fixture([
    row("9001",46310,46310),row("1002",46311,46311),
    row("9001",46312,46319,"REPAIR_BOOKING"),
    row("1002",46312,46312)
  ]);
  const snapshot=f.parse();
  assert.equal(snapshot.storeCode,"9001");
  assert.equal(snapshot.rowCount,2);
  assert.equal(snapshot.periodStart,d1);
  assert.equal(snapshot.periodEnd,d2);
  assert.equal(snapshot.dailyCounts[d1].rowCount,1);
  assert.equal(snapshot.dailyCounts[d2].rowCount,1);
  assert.equal(snapshot.dailyCounts[d2].byInteraction.REPAIR_BOOKING,1);
  assert.equal(snapshot.leadTimeBuckets.sameDay,1);
  assert.equal(snapshot.leadTimeBuckets.days1to7,1);
  assert.equal(snapshot.validation.noInferredZeroDays,true);
  assert.doesNotMatch(JSON.stringify(snapshot),/Synthetic Private|SYNTHETIC-ONLY|Synthetic note/);
});
test("other-store-only dates never become fabricated local zero rows",()=>{
  const skipped=serialDate(46311);
  const s=fixture([row("9001",46310,46310),row("1002",46311,46311),row("9001",46312,46312)]).parse();
  assert.equal(Object.hasOwn(s.dailyCounts,skipped),false);
  assert.equal(s.rowCount,2);
  assert.equal(Object.values(s.dailyCounts).reduce((n,d)=>n+d.rowCount,0),s.rowCount);
});
test("import persists individually scoped daily observations and one overall aggregate",async()=>{
  const one=serialDate(46310),two=serialDate(46312);
  const f=fixture([row("9001",46310,46310),row("1002",46311,46311),row("9001",46312,46319)]);
  await f.import();
  const family=f.durable().appointmentActivity;
  assert.ok(family,"Appointment Activity was not durably saved");
  assert.equal(Object.keys(family.snapshots).length,1);
  assert.equal(Object.keys(family.dailySnapshots).length,2);
  assert.equal(family.dailySnapshots[one].periodStart,one);
  assert.equal(family.dailySnapshots[one].periodEnd,one);
  assert.equal(family.dailySnapshots[one].rowCount,1);
  assert.deepEqual(Object.keys(family.dailySnapshots[one].byCreationDate),[one]);
  assert.equal(family.dailySnapshots[two].rowCount,1);
  assert.equal(family.dailySnapshots[two].leadTimeBuckets.days1to7,1);
  assert.equal(family.dailySnapshots[one].dailyCounts,undefined,"Per-day snapshots must not clone all other days");
  assert.equal(family.dailySnapshots[serialDate(46311)],undefined,"Do not manufacture zero activity");
  assert.equal(family.snapshots[two].rowCount,2);
});
test("invalid selected-store dates are rejected rather than yielding partial totals",()=>{
  const f=fixture([row("9001",46310,46310),row("9001","bad date",46312),row("1002",46311,46311)]);
  assert.throws(()=>f.parse(),/unreadable appointment creation date/);
});
test("ambiguous source population without verified configured store fails closed",()=>{
  const f=fixture([row("1002",46310,46310),row("1003",46311,46311)]);
  assert.throws(()=>f.parse(),/store filtering could not be verified/);
});
test("source parser epoch is advanced only in verified app code",()=>{
  new vm.Script(app);
  assert.match(app,/const LEARNED_PARSER_REVISION = "strict-report-recognition-2026-10-21-activity"/);
});
