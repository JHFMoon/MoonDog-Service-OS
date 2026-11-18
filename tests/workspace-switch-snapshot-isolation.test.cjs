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
const readOnly=source("      const snapshots = {};","      const rawSettings =");
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
  vm.runInContext("this.load=async function(){"+readOnly+"return snapshots;};",ctx);
  const snapshots = await ctx.load();
  assert.deepEqual(clone(snapshots.state),f.initial.state,"missing B state cannot import A RO notes");
  assert.deepEqual(snapshots.performance,{snapshots:{"2026-11-03":{source:"SYN-B"}}},
    "verified B report takes precedence over empty default");
  assert.equal(snapshots.appointments.days["2026-11-03"],undefined);
  assert.equal(oldA.state.records[0].management.note,"Manager A note",
    "the prior A source evidence is not rewritten during a B read");
});
test("malformed B state fails without fallback to still-present A RO records",async()=>{
  const f=fresh();switchToWorkspaceA(f);
  const existing=clone(f.model.state);
  const ctx=f.ctx;
  ctx.paths=[["state","state"],["performance","performance"]];
  ctx.readJson=async key=>key==="state"?{records:null,closedRecords:[]}:f.ctx.next(key);
  vm.runInContext("this.load=async function(){"+readOnly+"return snapshots;};",ctx);
  await assert.rejects(ctx.load(),/Saved Open\/Closed RO records are invalid/);
  assert.deepEqual(f.model.state,existing,"invalid B never replaces A in-memory state before connection error");
});


function stageReadOnlyConnection(f, readJson, interruptedRestoreReview = null) {
  const oldHandle = {name: "Synthetic A"};
  const candidate = {name: "Synthetic B"};
  const events = [];
  Object.assign(f.model, {
    root: oldHandle,
    applicationRoot: oldHandle,
    workspaceConnectionCommittedRoot: oldHandle,
    settings: {store: {name: oldHandle.name}}
  });
  const keys = [
    "STATE_PATH", "APPOINTMENTS_PATH", "PERFORMANCE_PATH", "OPERATIONAL_METRICS_PATH",
    "MEETING_CYCLE_PATH", "ASSIGN_NEXT_PATH", "AUTO_IMPORT_PATH", "RECOVERY_PATH"
  ];
  Object.assign(f.ctx, Object.fromEntries(keys.map((key, index) => [key, names[index]])), {
    connectedNativeRoot: oldHandle,
    operationalRoot: async handle => handle,
    wrapOperationalRoot: handle => handle,
    workspaceConnectionBlockReason: () => "",
    document: {dispatchEvent: event => events.push(event.type)},
    Event,
    SETTINGS_PATH: "settings",
    SOURCE_ADAPTER_BOOTSTRAP_PATH: "source-adapter",
    readJson,
    sourceAdapter: {schemaVersion: 1, storeCode: "SYN-A", storeName: "Synthetic A"},
    loadSourceAdapter: (adapter, settings) => {
      f.ctx.sourceAdapter = {...adapter, storeCode: settings.store.code, storeName: settings.store.name};
      events.push("adapter " + settings.store.code);
    },
    clearSourceAdapter: () => {
      f.ctx.sourceAdapter = {};
      events.push("adapter cleared");
    },
    inspectInterruptedRestore: async () => interruptedRestoreReview,
    status: (_message, type) => events.push(type),
    migratedSettings: settings => settings,
    pruneClosedRecords: records => records,
    stopFolderWatch: () => {},
    ui: {homeConnect: {}},
    renderSettings: () => {},
    renderAll: () => {},
    renderRecovery: () => {},
    renderSetup: () => {},
    reportInboxEntries: async () => [],
    scanFiles: async () => {},
    scanAppointmentFiles: async () => {},
    scanPerformanceFiles: async () => {},
    scanRecoveryBackups: async () => {},
    rememberRoot: async handle => events.push("saved " + handle.name),
    setConnectionState: state => events.push(state),
    writeAuthority: {reason: "WORKSPACE_BUSY"},
    scheduleAuthorityRevalidation: handle => events.push("retry " + handle.name)
  });
  const fullConnection = source("  async function finishReadOnlyConnection(", "  // All folder changes");
  vm.runInContext(fullConnection + "\nthis.connectReadOnly=finishReadOnlyConnection;", f.ctx);
  return {oldHandle, candidate, events};
}

test("read-only reconnect keeps the preceding Workspace intact when a later snapshot is unreadable", async () => {
  const f=fresh();switchToWorkspaceA(f);
  const {oldHandle, candidate, events} = stageReadOnlyConnection(f, async (key, fallback) => {
    if (key === "performance") throw Error("Synthetic performance read failed");
    return fallback;
  });
  const before = {...f.model};
  await assert.rejects(f.ctx.connectReadOnly(candidate), /Synthetic performance read failed/);
  for (const key of names) assert.equal(f.model[key], before[key], key + " still belongs to A");
  assert.equal(f.model.settings, before.settings);
  assert.equal(f.model.root, oldHandle);
  assert.equal(f.model.applicationRoot, oldHandle);
  assert.equal(f.model.workspaceConnectionCommittedRoot, oldHandle);
  assert.equal(f.ctx.connectedNativeRoot, oldHandle);
  assert.deepEqual(events, ["moondog-workspace-changing"]);
});

test("read-only reconnect retains the preceding snapshots when the selected store adapter is missing", async () => {
  const f=fresh();switchToWorkspaceA(f);
  const {oldHandle, candidate, events} = stageReadOnlyConnection(f, async (key, fallback) =>
    key === "settings" ? {advisors: {"SYN-B": {}}} : fallback);
  const before = {...f.model};
  await assert.rejects(f.ctx.connectReadOnly(candidate), /protected local source adapter is missing/);
  for (const key of names) assert.equal(f.model[key], before[key], key + " still belongs to A");
  assert.equal(f.model.settings, before.settings);
  assert.equal(f.model.root, oldHandle);
  assert.equal(f.model.workspaceConnectionCommittedRoot, oldHandle);
  assert.deepEqual(events, ["moondog-workspace-changing"]);
});

test("a failed settings migration restores the preceding Workspace source adapter", async () => {
  const f=fresh();switchToWorkspaceA(f);
  const {oldHandle, candidate, events} = stageReadOnlyConnection(f, async (key, fallback) =>
    key === "settings" ? {store: {code: "SYN-B", name: "Synthetic B"}, sourceAdapters: {schemaVersion: 1}} : fallback);
  const before = {...f.model};
  const originalAdapter = f.ctx.sourceAdapter;
  f.ctx.migratedSettings = () => { throw Error("Synthetic settings migration failed"); };
  await assert.rejects(f.ctx.connectReadOnly(candidate), /Synthetic settings migration failed/);
  for (const key of names) assert.equal(f.model[key], before[key], key + " still belongs to A");
  assert.equal(f.model.settings, before.settings);
  assert.equal(f.model.root, oldHandle);
  assert.deepEqual(f.ctx.sourceAdapter, originalAdapter);
  assert.deepEqual(events, ["moondog-workspace-changing", "adapter SYN-B", "adapter SYN-A"]);
});

test("a successful read-only reconnect publishes only the fully loaded selected Workspace", async () => {
  const f=fresh();switchToWorkspaceA(f);
  const selectedState = {records: [{id: "SYN-B-OPEN"}], closedRecords: []};
  const previousMetrics = f.model.operationalMetrics;
  const review = {state: "held"};
  const {candidate, events} = stageReadOnlyConnection(f, async (key, fallback) => {
    if (key === "state") return selectedState;
    if (key === "settings") return {store: {name: "Synthetic B"}};
    return fallback;
  }, review);
  await f.ctx.connectReadOnly(candidate);
  assert.equal(f.model.root, candidate);
  assert.equal(f.model.workspaceConnectionCommittedRoot, candidate);
  assert.equal(f.model.state, selectedState);
  assert.equal(f.model.settings.store.name, "Synthetic B");
  assert.equal(f.model.appointments.days["2026-11-03"], undefined);
  assert.equal(f.model.recovery.interruptedRestoreReview, review);
  assert.match(f.model.recovery.status, /Interrupted restore/);
  assert.deepEqual(clone(f.model.operationalMetrics.efficiency), {snapshots: {}});
  assert.deepEqual(previousMetrics, {snapshots: {source: "A"}});
  assert.deepEqual(events, [
    "moondog-workspace-changing", "adapter cleared", "saved Synthetic B",
    "CONNECTED", "retry Synthetic B", "error", "moondog-data"
  ]);
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
