"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
const {TextEncoder}=require("node:util");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function section(start,end){
 const i=app.indexOf(start),j=app.indexOf(end,i);
 assert.ok(i>=0&&j>i,start+" production section must exist");
 return app.slice(i,j);
}
const source=[
 section("  async function writeJson(","  async function backupState("),
 section("  function ensureAssignDay(","  function activeWorkloadSnapshot("),
 section("  async function saveOpenRoWorkload(","  function assignNextRows(")
].join("\n");
const copy=x=>JSON.parse(JSON.stringify(x));
const report=(iso="2026-10-30T12:10:00.000Z",ro="123456")=>({
 sourceType:"open-ro",asOf:iso,sourceFile:"Synthetic Open RO",coverageDate:"2026-10-30",
 records:[{ro,advisorCode:"110",isOpen:true}],validation:{canonicalRecords:1}
});
function harness(opts={}){
 const old=report("2026-10-29T12:10:00.000Z","123455");
 const state={schemaVersion:3,updatedAt:"prior",days:{"2026-10-29":{
 date:"2026-10-29",updatedAt:"prior",advisors:{"110":{code:"110",name:"Synthetic",available:false}},
 openedToday:{}}},currentOpenRo:old};
 const model={assignNext:copy(state)},events=[];
 const ADVISORS={"110":"Synthetic","111":"Other"};
 let durable=copy(state),attempts=0,renders=0,release;
 const pending=opts.holdWrite?new Promise(resolve=>{release=resolve;}):null;
 const ctx={model,TextEncoder,ASSIGN_NEXT_PATH:["data","assign.json"],
 ASSIGN_NEXT_ADVISORS:ADVISORS,structuredClone,storeDateKey:()=>"2026-10-30",
 now:()=>"2026-10-30T12:12:00.000Z",text:x=>String(x??""),
 writeAuthority:{requireWrite:()=>{
  if(opts.denied)throw Object.assign(Error("Synthetic read-only folder"),{name:"NotAllowedError"});
 }},
 writeBytes:async(_path,bytes)=>{
  attempts++;events.push("write");
  if(opts.failWrite)throw Error("Synthetic write failed");
  if(pending)await pending;
  durable=JSON.parse(new TextDecoder().decode(bytes));
 },
 readJson:async()=>opts.badReadback?{schemaVersion:3,currentOpenRo:null}:copy(durable),
 recordDiagnostic:(label)=>events.push(label),
 renderAssignNext:()=>{renders++;events.push("render");}
 };
 vm.runInNewContext(source+"\nthis.save=saveOpenRoWorkload;this.day=ensureAssignDay",ctx);
 return{ctx,model,events,prior:state,get durable(){return copy(durable);},
 get writes(){return attempts},get renders(){return renders},release:()=>release?.()};
}
test("Assign Next snapshot publishes only after verified full-payload readback",async()=>{
 const f=harness({holdWrite:true}),next=report();
 const saving=f.ctx.save(next);
 assert.deepEqual(f.model.assignNext,f.prior,"unverified source must not render as authoritative");
 assert.equal(f.renders,0);
 f.release();
 assert.equal(await saving,true);
 assert.equal(f.model.assignNext.currentOpenRo.asOf,next.asOf);
 assert.equal(f.durable.currentOpenRo.asOf,next.asOf);
 assert.equal(f.model.assignNext.days["2026-10-29"].advisors["110"].available,false,
  "manual advisor availability survives generated source updates");
 assert.ok(f.model.assignNext.days["2026-10-30"].advisors["110"]);
 assert.equal(f.model.assignNext.schemaVersion,3);
 assert.equal(f.renders,1);
 assert.equal(f.writes,1);
});
test("denied, failed, or unverifiable write never advances the in-memory workload",async()=>{
 for(const opts of [{denied:true},{failWrite:true},{badReadback:true}]){
  const f=harness(opts),before=copy(f.model.assignNext);
  await assert.rejects(()=>f.ctx.save(report()),/NotAllowedError|read-only folder|Synthetic write failed|Read-back verification failed/);
  assert.deepEqual(f.model.assignNext,before);
  assert.equal(f.renders,0,"unverified source must not trigger a success render");
  assert.equal(f.model.assignNext.days["2026-10-30"],undefined);
 }
});
test("older source cannot regress authoritative snapshot",async()=>{
 const f=harness(),older=report("2026-10-28T11:00:00.000Z","123499");
 assert.equal(await f.ctx.save(older),true);
 assert.equal(f.model.assignNext.currentOpenRo.records[0].ro,"123455");
 assert.equal(f.durable.currentOpenRo.records[0].ro,"123455");
});
test("invalid source is a no-op and does not write",async()=>{
 const f=harness();assert.equal(await f.ctx.save({sourceType:"appointments"}),false);
 assert.equal(f.writes,0);assert.deepEqual(f.model.assignNext,f.prior);
});
test("day preparation can modify a detached state without mutating the visible state",()=>{
 const f=harness(),draft=copy(f.model.assignNext);
 f.ctx.day("2026-10-30",draft);
 assert.ok(draft.days["2026-10-30"]);
 assert.equal(f.model.assignNext.days["2026-10-30"],undefined);
});
