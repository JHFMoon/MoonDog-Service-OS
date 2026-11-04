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
    assert.deepEqual(clone(one),f.initial[key],"B does not inherit A's "+key);
    assert.deepEqual(clone(two),f.initial[key]);
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
    assert.deepEqual(clone(ctx.plan[i][1]),f.initial[names[i]],"missing B file must not copy A "+names[i]);
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
  assert.deepEqual(clone(f.model.state),f.initial.state,"missing B state cannot import A RO notes");
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


test("actual batched writable hydration never inherits the preceding Workspace on missing files",async()=>{
  const f=fresh();switchToWorkspaceA(f);
  const originalA=clone(f.model);
  const ctx=f.ctx;
  const pathNames=[
    "STATE_PATH","APPOINTMENTS_PATH","PERFORMANCE_PATH","OPERATIONAL_METRICS_PATH",
    "MEETING_CYCLE_PATH","ASSIGN_NEXT_PATH","AUTO_IMPORT_PATH","RECOVERY_PATH"
  ];
  const paths=pathNames.map((_,i)=>"SYN-B-"+i);
  Object.assign(ctx,Object.fromEntries(pathNames.map((name,i)=>[name,paths[i]])));
  const active=source("    const connectionReadSpecs = [",
    "    // A legacy bootstrap is migrated into settings below.");
  const commit=source(
    "    [model.state, model.appointments, model.performance, model.operationalMetrics, model.meetingCycle, model.assignNext, model.autoImport, model.recovery] = connectionReadResults;",
    "    const rawSettings = pendingSettings;");
  let readCount=0;
  ctx.readJson=async(_path,fallback)=>{readCount++;return fallback;};
  await vm.runInContext("(async()=>{"+active+commit+"})()",ctx);
  assert.equal(readCount,8);
  for(const key of names)assert.deepEqual(clone(f.model[key]),f.initial[key],
    "committed Workspace B must not inherit A's "+key);
  assert.equal(originalA.state.records[0].management.note,"Manager A note");
});
test("batched writable connection aborts before changing the old Workspace model on an unreadable file",async()=>{
  const f=fresh();switchToWorkspaceA(f);
  const original=clone(f.model),ctx=f.ctx;
  const keys=[
    "STATE_PATH","APPOINTMENTS_PATH","PERFORMANCE_PATH","OPERATIONAL_METRICS_PATH",
    "MEETING_CYCLE_PATH","ASSIGN_NEXT_PATH","AUTO_IMPORT_PATH","RECOVERY_PATH"
  ];
  Object.assign(ctx,Object.fromEntries(keys.map((name,i)=>[name,"SYN-C-"+i])));
  const code=source("    const connectionReadSpecs = [",
    "    // A legacy bootstrap is migrated into settings below.");
  const commit=source(
    "    [model.state, model.appointments, model.performance, model.operationalMetrics, model.meetingCycle, model.assignNext, model.autoImport, model.recovery] = connectionReadResults;",
    "    const rawSettings = pendingSettings;");
  ctx.readJson=async(path,fallback)=>{if(path==="SYN-C-2")throw Error("Synthetic source unreadable");return fallback;};
  await assert.rejects(vm.runInContext("(async()=>{"+code+commit+"})()",ctx),/Synthetic source unreadable/);
  assert.deepEqual(clone(f.model),original,
    "a failed B source read must not replace A's in-memory records or other snapshots");
});

test("independent synthetic Dodge and BMW Workspaces with overlapping RO/advisor identities never reuse prior source-family snapshots",async()=>{
  const f=fresh(),ctx=f.ctx;
  switchToWorkspaceA(f);
  const catalog=require("../assets/freshness.js").SOURCE_DEFINITIONS;
  const operational=Object.keys(catalog).filter(key=>!
    ["openRo","sapr","appointments","supervisorWorkbook"].includes(key));
  assert.equal(operational.length,10,"ten canonical operational families supplement Open RO, SAPR, Arrivals and workbook");
  const sameRO="SYN-RO-301",sameAdvisor="SYN-101";
  f.model.state.records=[{id:sameRO,ro:sameRO,advisorCode:sameAdvisor,
    management:{owner:"Synthetic Dodge",note:"A-specific manager decision"}}];
  f.model.operationalMetrics=Object.fromEntries(operational.map(key=>[key,{
    snapshots:{"2026-11-04":{sourceFile:"synthetic-"+key+"-A.xlsx",
      sourceStoreConfidence:"configured-destination-only",value:"A"}}
  }]));
  const priorA=clone(f.model);
  const B={
    state:{schemaVersion:1,updatedAt:"synthetic-B",source:{sha256:"SYN-B"},
      records:[{id:sameRO,ro:sameRO,advisorCode:sameAdvisor,
        management:{owner:"Synthetic BMW",note:"B-specific manager decision"}}],
      closedRecords:[]},
    appointments:{days:{"2026-11-04":{sourceFile:"synthetic-arrivals-B.xlsx",records:[sameRO]}}},
    performance:{snapshots:{"2026-11-04":{sourceFile:"synthetic-sapr-B.xlsx",
      periodStart:"2026-11-01",periodEnd:"2026-11-04",value:"B"}}},
    operationalMetrics:Object.fromEntries(operational.map(key=>[key,{
      snapshots:{"2026-11-04":{sourceFile:"synthetic-"+key+"-B.xlsx",
        sourceStoreConfidence:"configured-destination-only",value:"B"}}
    }])),
    meetingCycle:{metrics:{store:"B"}},
    assignNext:{days:{"2026-11-04":{source:"SYN-B",ro:sameRO}}},
    autoImport:{seen:{"synthetic-B":{verified:true}}},
    recovery:{status:"Ready",supervisorWorkbook:{issuanceStore:"SYN-B"}}
  };
  ctx.paths=names.map(key=>[key,key]);
  ctx.readJson=async key=>clone(B[key]);
  vm.runInContext("this.load=async function(){"+readOnly+"};",ctx);
  await ctx.load();
  for(const key of names){
    assert.deepEqual(clone(f.model[key]),B[key],"B must read its own saved "+key);
    assert.notDeepEqual(clone(f.model[key]),priorA[key],
      "a colliding RO/advisor cannot resurrect A's "+key);
  }
  assert.equal(f.model.state.records[0].management.note,"B-specific manager decision");
  assert.equal(priorA.state.records[0].management.note,"A-specific manager decision",
    "A's manager override is not rewritten by a B load");
  for(const family of operational){
    const current=f.model.operationalMetrics[family].snapshots["2026-11-04"];
    assert.equal(current.value,"B","B's "+family+" source is selected");
    assert.ok(current.sourceFile.endsWith("-B.xlsx"));
  }
  assert.equal(f.model.recovery.supervisorWorkbook.issuanceStore,"SYN-B");
});
