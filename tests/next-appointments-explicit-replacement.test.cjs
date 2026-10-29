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

function fixture({failWrite=false,mismatchReadback=false,confirmReplacement=true,equivalent=false,unreadableDuplicate=false}={}){
  const key="2026-10-20";
  const previous={sourceFile:"older.csv",importedAt:"2026-10-21T00:00:00.000Z",periodStart:"2026-10-20",periodEnd:key,appointmentCount:1,appointments:[{id:"synthetic-old"}],validation:{parser:"v1"}};
  const incoming=equivalent
    ?{sourceFile:"new-name.csv",importedAt:"2026-10-24T00:00:00.000Z",periodStart:"2026-10-20",periodEnd:key,appointmentCount:1,appointments:[{id:"synthetic-old"}],validation:{parser:"v2"}}
    :{sourceFile:"synthetic-next-appointments.csv",importedAt:"2026-10-24T00:00:00.000Z",periodStart:"2026-10-20",periodEnd:key,appointmentCount:2,appointments:[{id:"synthetic-a"},{id:"synthetic-b"}],identityConflicts:[],validation:{parser:"v2"}};
  const model={operationalMetrics:{nextAppointments:{snapshots:{[key]:previous}},supplementalReports:{snapshots:{}},updatedAt:"prior-update"}};
  const before=structuredClone(model.operationalMetrics),events=[];
  let durable=unreadableDuplicate?null:structuredClone(model.operationalMetrics);
  const context={
    model,structuredClone,window:{confirm:()=>confirmReplacement},
    sourceFileHandle:async()=>({getFile:async()=>({text:async()=>"synthetic report",lastModified:0})}),
    parseNextAppointmentsCsv:()=>structuredClone(incoming),
    parseAppointmentsCreatedSummaryCsv:()=>{throw Error("not a supplemental source");},
    pruneDatedSnapshots:snapshots=>snapshots,
    pruneSupplementalSnapshots:snapshots=>snapshots,
    OPERATIONAL_METRICS_PATH:["data","operational-metrics.json"],
    now:()=>"2026-10-24T00:00:00.000Z",
    writeJson:async(_path,value)=>{events.push("write");if(failWrite)throw Error("synthetic durable write failure");durable=structuredClone(value);},
    readJson:async()=>{events.push("read");const value=structuredClone(durable);if(mismatchReadback&&value)value.nextAppointments.snapshots[key].appointmentCount+=1;return value;},
    addHistory:async(type,message,details)=>events.push({type,message,details}),
    removeSourceEntry:async name=>events.push({type:"remove",name}),
    renderOverviewIntelligence:()=>events.push("render")
  };
  vm.runInNewContext(importer+"\nglobalThis.runImport=importNextAppointmentsFile;",context);
  return{run:(deleteAfterSuccess=false,allowInteractiveReplacement=false)=>context.runImport("synthetic-next-appointments.csv",deleteAfterSuccess,allowInteractiveReplacement),model,before,events,key,durable:()=>durable,incoming,previous};
}

test("automatic same-period conflict fails closed before mutation or source cleanup",async()=>{
  const f=fixture();
  await assert.rejects(f.run(true),/different Next Appointments report.*source was retained/);
  assert.deepEqual(JSON.parse(JSON.stringify(f.model.operationalMetrics)),JSON.parse(JSON.stringify(f.before)));
  assert.deepEqual(f.events,[]);
});

test("manual same-period replacement requires confirmation and verifies durable read-back before cleanup",async()=>{
  const f=fixture();
  await f.run(true,true);
  const saved=f.model.operationalMetrics.nextAppointments.snapshots[f.key];
  assert.deepEqual(JSON.parse(JSON.stringify(saved)),JSON.parse(JSON.stringify(f.incoming)));
  assert.deepEqual(JSON.parse(JSON.stringify(f.durable().nextAppointments.snapshots[f.key])),JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(f.events.slice(0,2),["write","read"],"read-back must follow the durable write");
  assert.equal(f.events[2].type,"next-appointments-import");
  assert.match(f.events[2].message,/^Replaced Next Appointments snapshot through 2026-10-20$/);
  assert.equal(f.events[2].details.fileName,"synthetic-next-appointments.csv");
  assert.equal(f.events[3].type,"remove");
  assert.equal(f.events[3].name,"synthetic-next-appointments.csv");
  assert.deepEqual(f.events.slice(-2).map(item=>typeof item==="string"?item:item.type),["source-deleted","render"]);
});

test("declined replacement retains the saved snapshot and original source",async()=>{
  const f=fixture({confirmReplacement:false});
  await assert.rejects(f.run(true,true),/Replacement canceled.*source were retained/);
  assert.deepEqual(JSON.parse(JSON.stringify(f.model.operationalMetrics)),JSON.parse(JSON.stringify(f.before)));
  assert.deepEqual(f.events,[]);
});

test("failed durable replacement restores the prior snapshot and retains the source",async()=>{
  const f=fixture({failWrite:true});
  await assert.rejects(f.run(true,true),/synthetic durable write failure/);
  assert.deepEqual(JSON.parse(JSON.stringify(f.model.operationalMetrics)),JSON.parse(JSON.stringify(f.before)));
  assert.deepEqual(f.events,["write"]);
});

test("mismatched durable read-back rolls back replacement and retains the source",async()=>{
  const f=fixture({mismatchReadback:true});
  await assert.rejects(f.run(true,true),/could not be verified after saving/);
  assert.deepEqual(JSON.parse(JSON.stringify(f.model.operationalMetrics)),JSON.parse(JSON.stringify(f.before)));
  assert.deepEqual(f.events,["write","read"]);
});

test("equivalent reimport ignores derived provenance, verifies durable state, and avoids rewriting the snapshot",async()=>{
  const f=fixture({equivalent:true});
  await f.run(true);
  assert.deepEqual(f.events.slice(0,2),["read",{type:"next-appointments-duplicate"}].map(x=>typeof x==="string"?x:x.type));
  assert.equal(f.events.some(item=>item==="write"),false,"equivalent report must not rewrite saved metrics");
  assert.equal(f.events[1].type,"next-appointments-duplicate");
  assert.equal(f.events[2].type,"remove","source cleanup follows durable duplicate verification");
  assert.equal(f.events[3].type,"source-deleted");
  assert.equal(f.events[4],"render");
  assert.deepEqual(JSON.parse(JSON.stringify(f.model.operationalMetrics)),JSON.parse(JSON.stringify(f.before)));
});

test("equivalent reimport is retained when durable saved data cannot be verified",async()=>{
  const f=fixture({equivalent:true,unreadableDuplicate:true});
  await assert.rejects(f.run(true),/could not be verified from durable storage.*source was retained/);
  assert.deepEqual(JSON.parse(JSON.stringify(f.model.operationalMetrics)),JSON.parse(JSON.stringify(f.before)));
  assert.deepEqual(f.events,["read"]);
});
