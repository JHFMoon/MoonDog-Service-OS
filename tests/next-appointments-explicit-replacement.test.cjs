"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf("  async function importNextAppointmentsFile(");
const end=app.indexOf("  const VIR_NAME_CODES =",start);
assert.ok(start>=0&&end>start,"production Next Appointments importer must exist");
const importer=app.slice(start,end);

function fixture({failWrite=false}={}){
  const key="2026-10-20";
  const previous={periodStart:"2026-10-20",periodEnd:key,appointmentCount:1,appointments:[{id:"synthetic-old"}]};
  const incoming={periodStart:"2026-10-20",periodEnd:key,appointmentCount:2,appointments:[{id:"synthetic-a"},{id:"synthetic-b"}],identityConflicts:[]};
  const model={operationalMetrics:{nextAppointments:{snapshots:{[key]:previous}},supplementalReports:{snapshots:{}},updatedAt:"prior-update"}};
  const before=structuredClone(model.operationalMetrics),events=[];
  let durable=null;
  const context={
    model,structuredClone,
    sourceFileHandle:async()=>({getFile:async()=>({text:async()=>"synthetic report",lastModified:0})}),
    parseNextAppointmentsCsv:()=>structuredClone(incoming),
    parseAppointmentsCreatedSummaryCsv:()=>{throw Error("not a supplemental source");},
    pruneDatedSnapshots:snapshots=>snapshots,
    pruneSupplementalSnapshots:snapshots=>snapshots,
    OPERATIONAL_METRICS_PATH:["data","operational-metrics.json"],
    now:()=>"2026-10-24T00:00:00.000Z",
    writeJson:async(_path,value)=>{events.push("write");if(failWrite)throw Error("synthetic durable write failure");durable=structuredClone(value);},
    readJson:async()=>structuredClone(durable),
    addHistory:async(type,message,details)=>events.push({type,message,details}),
    removeSourceEntry:async name=>events.push({type:"remove",name}),
    renderOverviewIntelligence:()=>events.push("render")
  };
  vm.runInNewContext(importer+"\nglobalThis.runImport=importNextAppointmentsFile;",context);
  return{run:(deleteAfterSuccess=false)=>context.runImport("synthetic-next-appointments.csv",deleteAfterSuccess),model,before,events,key};
}

test("same-day Next Appointments replacement is recorded before source deletion",async()=>{
  const f=fixture();
  await f.run(true);
  assert.equal(f.model.operationalMetrics.nextAppointments.snapshots[f.key].appointmentCount,2);
  assert.equal(f.events[1].type,"next-appointments-import");
  assert.match(f.events[1].message,/^Replaced Next Appointments snapshot through 2026-10-20$/);
  assert.equal(f.events[1].details.fileName,"synthetic-next-appointments.csv");
  assert.equal(f.events[2].type,"remove");
  assert.equal(f.events[2].name,"synthetic-next-appointments.csv");
  assert.deepEqual(f.events.slice(-2).map(item=>typeof item==="string"?item:item.type),["source-deleted","render"]);
});

test("failed durable replacement restores the prior snapshot and retains the source",async()=>{
  const f=fixture({failWrite:true});
  await assert.rejects(f.run(true),/synthetic durable write failure/);
  assert.deepEqual(JSON.parse(JSON.stringify(f.model.operationalMetrics)),JSON.parse(JSON.stringify(f.before)));
  assert.deepEqual(f.events,["write"]);
});
