"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function source(start,end){
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"production Workspace boundary exists: "+start);
  return app.slice(a,b);
}
const defaults=source("  const pristineWorkspaceSnapshots=Object.fromEntries(","  let connectedNativeRoot = null;");
const validation=source("  function validateConnectedWorkbookSnapshot(","  let postConnectionScanBusy=false;");
const readOnly=source("      for (const [key, path] of paths) {","      const rawSettings =");
const plan=source("    const connectionReadSpecs = [","    const connectionReadResults");
assert.match(readOnly,/readJson\(path, newWorkspaceSnapshot\(key\)\)/);
for(const key of ["state","appointments","performance","operationalMetrics","meetingCycle","assignNext","autoImport","recovery"])
  assert.ok(plan.includes('newWorkspaceSnapshot("'+key+'")'),"current Workspace read plan must use a fresh "+key+" snapshot");

const names=["state","appointments","performance","operationalMetrics",
  "meetingCycle","assignNext","autoImport","recovery"];
const clone=value=>JSON.parse(JSON.stringify(value));
function fresh(){
  const model={
    state:{schemaVersion:1,updatedAt:null,source:null,records:[],closedRecords:[]},
    appointments:{days:{}},performance:{snapshots:{}},operationalMetrics:{snapshots:{}},
    meetingCycle:{metrics:{}},assignNext:{days:{}},autoImport:{seen:{}},recovery:{status:"Ready"}
  };
  const initial=clone(model);
  const ctx=vm.createContext({model,JSON,Object});
  vm.runInContext(defaults+validation+"\nthis.next=newWorkspaceSnapshot;this.validate=validateConnectedWorkbookSnapshot;",ctx);
  return {model,initial,ctx};
}
function switchToWorkspaceA(f){
  f.model.state={schemaVersion:1,updatedAt:"synthetic-A",source:{sha256:"SYN-A"},
    records:[{id:"SYN-A-OPEN",management:{note:"Manager A note"}}],
    closedRecords:[{id:"SYN-A-CLOSED",management:{note:"Manager A closed note"}}]};
  f.model.appointments={days:{"2026-11-03":{owner:"A"}}};
  f.model.performance={snapshots:{"2026-11-03":{gross:500}}};
  f.model.operationalMetrics={snapshots:{source:"A"}};
  f.model.meetingCycle={metrics:{source:"A"}};
  f.model.assignNext={days:{source:"A"}};
  f.model.autoImport={seen:{source:"A"}};
  f.model.recovery={status:"A needs review"};
}
test("fresh default snapshot is never aliased to a previously connected Workspace",()=>{
  const f=fresh();switchToWorkspaceA(f);
  for(const key of names){
    const one=f.ctx.next(key),two=f.ctx.next(key);
    assert.deepEqual(one,f.initial[key],"B does not inherit A's "+key);
    assert.deepEqual(two,f.initial[key]);
    assert.notEqual(one,f.model[key],"B must not reference A's mutable "+key);
    assert.notEqual(one,two,"different reconnects need independent "+key+" instances");
    one.syntheticMutation=true;
    assert.equal(two.syntheticMutation,undefined,"mutable B fallback must not poison C");
  }
  assert.equal(f.model.state.records[0].management.note,"Manager A note");
});
test("actual writable connection read plan uses fresh fallback for all eight files",()=>{
  const f=fresh();switchToWorkspaceA(f);
  const parts=names.map(key=>key+"-path");
  const ctx=f.ctx;
  Object.assign(ctx,Object.fromEntries([
    "STATE_PATH","APPOINTMENTS_PATH","PERFORMANCE_PATH","OPERATIONAL_METRICS_PATH",
    "MEETING_CYCLE_PATH","ASSIGN_NEXT_PATH","AUTO_IMPORT_PATH","RECOVERY_PATH"
  ].map((name,index)=>[name,parts[index]])));
  vm.runInContext(plan+"\nthis.plan=connectionReadSpecs;",ctx);
  assert.equal(ctx.plan.length,8);
  for(let i=0;i<8;i++){
    assert.equal(ctx.plan[i][0],parts[i]);
    assert.deepEqual(ctx.plan[i][1],f.initial[names[i]],"missing B file must not copy A "+names[i]);
    assert.notEqual(ctx.plan[i][1],f.model[names[i]]);
  }
});
test("actual read-only connection uses root-independent defaults and preserves valid B source",async()=>{
  const f=fresh();switchToWorkspaceA(f);
  const oldA=clone(f.model);
  const paths=names.map(key=>[key,key]);
  const ctx=f.ctx;
  ctx.paths=paths;
  ctx.readJson=async (key,fallback)=>key==="state" ? fallback :
    key==="performance" ? {snapshots:{"2026-11-03":{source:"SYN-B"}}} : fallback;
  vm.runInContext("this.load=async function(){"+readOnly+"};",ctx);
  await ctx.load();
  assert.deepEqual(f.model.state,f.initial.state,"missing B state cannot import A RO notes");
  assert.deepEqual(f.model.performance,{snapshots:{"2026-11-03":{source:"SYN-B"}}},
    "verified B report takes precedence over empty default");
  assert.equal(f.model.appointments.days["2026-11-03"],undefined);
  assert.equal(oldA.state.records[0].management.note,"Manager A note",
    "the prior A source evidence is not rewritten during a B read");
});
test("malformed B state fails without fallback to still-present A RO records",async()=>{
  const f=fresh();switchToWorkspaceA(f);
  const existing=clone(f.model.state);
  const ctx=f.ctx;
  ctx.paths=[["state","state"],["performance","performance"]];
  ctx.readJson=async key=>key==="state"?{records:null,closedRecords:[]}:f.ctx.next(key);
  vm.runInContext("this.load=async function(){"+readOnly+"};",ctx);
  await assert.rejects(ctx.load(),/Saved Open\/Closed RO records are invalid/);
  assert.deepEqual(f.model.state,existing,"invalid B never replaces A in-memory state before connection error");
});
