"use strict";
// Criterion 59-06: real production loader, search and readiness routines,
// exercised only with synthetic in-memory browser/Workspace doubles.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const daily = fs.readFileSync(path.join(__dirname, "..", "assets", "daily-ops.js"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function extract(text, first, last) {
  const start = text.indexOf(first);
  assert.ok(start >= 0, "Missing production entry: " + first);
  const end = text.indexOf(last, start + first.length);
  assert.ok(end > start, "Missing production boundary: " + last);
  return text.slice(start, end);
}
const loader = extract(daily, "  const historyFileCache=new Map();", "  async function log(");
const readiness = extract(daily, "  async function ready(){", "  async function checkOperatingDate(){");
const searching = extract(daily, "  const matches=", "  document.addEventListener('moondog-recovered'");
const draftGuard = extract(daily, "  function discardDraftOk(){", "  function go(");
const connection = extract(app, "  async function connect() {", "  async function restoreConnection() {");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return {promise, resolve, reject};
};
const eventFile = (id, name = "daily-same.json", type = "daily-task") => ({
  name,
  handle: {getFile: async () => ({text: async () =>
    JSON.stringify({id, at:"2026-10-19T12:00:00Z", type, summary:id})})}
});
const tick = () => new Promise(resolve => setImmediate(resolve));
function historyHarness(root, readEntries) {
  const model = {root, connectionState:"CONNECTED", workspaceConnectionCommittedRoot:root};
  const state = {history:[], events:[], searchToken:0, loadedRoot:null, loading:false, busy:false, current:null, editing:false};
  const api = {readEntries: location => readEntries(location, model.root)};
  const context = vm.createContext({model,state,api,Promise,setTimeout,queueMicrotask});
  vm.runInContext(loader + "\nthis.loadHistory=loadHistory;", context);
  return {context,model,state,api};
}

test("delayed A history read cannot replace B history or B events", async () => {
  const A = {name:"Fake-A"}, B = {name:"Fake-B"};
  const gate = deferred();
  const h = historyHarness(A, (_path, root) =>
    root === A ? gate.promise : [eventFile("B-event")]);
  const old = h.context.loadHistory();
  h.model.root = B;
  assert.equal(await h.context.loadHistory(), true);
  gate.resolve([eventFile("A-event")]);
  assert.equal(await old, false);
  assert.equal(h.state.history.length, 1);
  assert.equal(h.state.events.length, 1);
  assert.equal(h.state.history[0].id, "B-event");
  assert.equal(h.state.events[0].id, "B-event");
});

test("identical filenames are isolated across A/B/A root changes", async () => {
  const A = {name:"Fake-A"}, B = {name:"Fake-B"};
  let readsA = 0, readsB = 0;
  const file = root => ({
    name:"daily-collision.json",
    handle: {getFile: async () => ({text: async () => {
      if (root === A) readsA++; else readsB++;
      return JSON.stringify({id:root.name,at:"2026-10-19",type:"daily-task"});
    }})}
  });
  const h = historyHarness(A, (_path, root) => [file(root)]);
  assert.equal(await h.context.loadHistory(),true);
  assert.equal(h.state.history[0].id,"Fake-A");
  h.model.root=B;
  assert.equal(await h.context.loadHistory(),true);
  assert.equal(h.state.history[0].id,"Fake-B");
  assert.equal(await h.context.loadHistory(),true);
  assert.equal(readsB,1,"Same-root cache remains reusable");
  h.model.root=A;
  assert.equal(await h.context.loadHistory(),true);
  assert.equal(h.state.history[0].id,"Fake-A");
  assert.equal(readsA,2,"Returning to A must not reuse B's same-name cached file");
});

test("late A file completion cannot poison B cache after root generation changes", async () => {
  const A = {name:"Fake-A"}, B = {name:"Fake-B"};
  const started = deferred(), release = deferred();
  let readsB=0;
  const aFile = {name:"daily-collision.json",handle:{getFile:async()=>({
    text:async()=>{started.resolve();return release.promise;}
  })}};
  const bFile = {name:"daily-collision.json",handle:{getFile:async()=>({
    text:async()=>{readsB++;return JSON.stringify({id:"B",type:"daily-task",at:"2026-10-19"});}
  })}};
  const h = historyHarness(A, (_path, root) => root===A?[aFile]:[bFile]);
  const old = h.context.loadHistory();
  await started.promise;
  h.model.root=B;
  assert.equal(await h.context.loadHistory(),true);
  release.resolve(JSON.stringify({id:"A",type:"daily-task",at:"2026-10-19"}));
  assert.equal(await old,false);
  assert.equal(await h.context.loadHistory(),true);
  assert.equal(readsB,1,"B cache must retain B's value after late A resolves");
  assert.equal(h.state.history[0].id,"B");
  assert.equal(h.state.events[0].id,"B");
});

function searchHarness(root, readEntries) {
  const h=historyHarness(root,readEntries);
  h.model.state={records:[],reviewQueue:[]};
  h.model.appointments={days:{}};
  h.model.settings={advisors:{}};
  h.model.operationalMetrics={};
  h.model.performance={};
  h.model.assignNext={};
  h.state.searchResults=[];
  const input={value:""};
  const host={children:[],hidden:true,replaceChildren(...items){this.children=items;},append(...items){this.children.push(...items);}};
  const element=tag=>({tagName:tag,textContent:"",children:[],append(...items){this.children.push(...items);}});
  Object.assign(h.context, {
    $:id=>({findAnything:input,findResults:host})[id],
    document:{createElement:element},
    button:(label,open)=>({textContent:label,open,children:[],append(...items){this.children.push(...items);}}),
    toolNames:{},
    allTasks:()=>[],
    engine:{lastEvent:()=>null}
  });
  h.api.imports=()=>[];
  vm.runInContext(searching+"\nthis.searchAll=searchAll;", h.context);
  return {...h,input,host};
}

test("overlapping A/B searches paint only the newest root's results", async () => {
  const A={name:"Fake-A"}, B={name:"Fake-B"}, gate=deferred();
  const h=searchHarness(A,(path,root)=>{
    if(path==="backups")return [];
    return root===A?gate.promise:[eventFile("Beta-result")];
  });
  h.input.value="Alpha";
  const old=h.context.searchAll();
  h.model.root=B;
  h.model.workspaceConnectionCommittedRoot=B;
  h.input.value="Beta";
  await h.context.searchAll();
  gate.resolve([eventFile("Alpha-result")]);
  await old;
  assert.equal(h.state.history.length,1);
  assert.equal(h.state.history[0].id,"Beta-result");
  assert.ok(h.state.searchResults.some(row=>row.label.includes("Beta-result")));
  assert.ok(h.state.searchResults.every(row=>!row.label.includes("Alpha-result")));
  assert.ok(h.host.children.some(row=>String(row.textContent).includes("Beta-result")));
  assert.ok(h.host.children.every(row=>!String(row.textContent).includes("Alpha-result")));
});

test("explicitly cleared search cancels an in-flight history search and its rendering", async () => {
  const A={name:"Fake-A"}, gate=deferred();
  const h=searchHarness(A,(path)=>path==="backups"?[]:gate.promise);
  h.state.history=[{id:"preserved"}];
  h.input.value="Alpha";
  const old=h.context.searchAll();
  h.input.value="";
  await h.context.searchAll();
  gate.resolve([eventFile("Alpha-result")]);
  await old;
  assert.equal(h.state.history[0].id,"preserved");
  assert.equal(h.host.hidden,true);
  assert.equal(h.host.children.length,0);
});

test("ready retries exactly once for latest connected root after overlapping changes", async () => {
  const A={name:"Fake-A"},B={name:"Fake-B"},C={name:"Fake-C"};
  const gate=deferred(),calls=[],selected=[];
  const h=historyHarness(A,(_path,root)=>{
    calls.push(root.name);
    return root===A?gate.promise:[eventFile(root.name)];
  });
  Object.assign(h.context, {
    active:()=>"home", renderHome:()=>{},
    checkOperatingDate:async()=>{}, refreshCurrent:()=>{},
    selectNext:async()=>{selected.push(h.model.root.name);},
    say:()=>{}
  });
  vm.runInContext(readiness+"\nthis.ready=ready;",h.context);
  const initial=h.context.ready();
  h.model.root=B;
  await h.context.ready();
  h.model.root=C;
  await h.context.ready();
  // The new root is now fully initialized while the A history read is pending.
  h.model.workspaceConnectionCommittedRoot=C;
  gate.resolve([eventFile("Fake-A")]);
  await initial;
  await tick();
  assert.equal(h.state.loadedRoot,C);
  assert.equal(h.state.history[0].id,"Fake-C");
  assert.equal(h.state.events[0].id,"Fake-C");
  assert.equal(calls.join(","),"Fake-A,Fake-C");
  assert.equal(selected.join(","),"Fake-C");
});

test("old CONNECTED status cannot select A operational data under B before B connection finishes", async () => {
  const A={name:"Fake-A"}, B={name:"Fake-B"}, gate=deferred();
  const calls=[], selected=[];
  const h=historyHarness(A,(_path,root)=>{
    calls.push(root.name);
    return root===A?gate.promise:[eventFile("B-history")];
  });
  h.model.state={records:[{id:"same-id",fingerprint:"same-fingerprint",customer:"A-customer"}]};
  Object.assign(h.context,{
    active:()=>"home",renderHome:()=>{},
    checkOperatingDate:async()=>{},refreshCurrent:()=>{},
    selectNext:async()=>{
      const record=h.model.state.records[0];
      selected.push(record.customer);
      h.state.current={...record};
    },
    say:()=>{}
  });
  vm.runInContext(readiness+"\nthis.ready=ready;",h.context);
  const old=h.context.ready();
  // finishConnection assigns B before reading B's records/settings and before
  // postConnectReconciliation can mark B as completely connected.
  h.model.root=B;
  assert.equal(h.model.connectionState,"CONNECTED","A's stale status remains CONNECTED");
  await h.context.ready();
  gate.resolve([eventFile("A-history")]);
  await old;
  await tick();
  assert.equal(calls.join(","),"Fake-A","No B history before B's operational model is complete");
  assert.equal(selected.length,0,"No task may be selected using A data under B");
  assert.equal(h.state.loadedRoot,null,"B must not be prematurely marked loaded");
  // Completing the actual B connection replaces the operational model and
  // records readiness before the moondog-data listener calls ready().
  h.model.state={records:[{id:"same-id",fingerprint:"same-fingerprint",customer:"B-customer"}]};
  h.model.workspaceConnectionCommittedRoot=B;
  await h.context.ready();
  assert.equal(calls.join(","),"Fake-A,Fake-B");
  assert.equal(selected.join(","),"B-customer");
  assert.equal(h.state.loadedRoot,B);
  assert.equal(h.state.history[0].id,"B-history");
  assert.equal(h.state.events[0].id,"B-history");
});

test("connection completion publishes its root only after reconciliation settles", async () => {
  const code=extract(app,"  async function postConnectReconciliation(","  async function connect() {");
  const B={name:"Fake-B"}, gate=deferred(),signals=[];
  const model={root:B,recovery:{},workspaceConnectionCommittedRoot:null};
  const context=vm.createContext({
    model,RECOVERY_PATH:["data","recovery.json"], now:()=>42,
    writeJson:async()=>gate.promise,
    setConnectionState:s=>signals.push(s),
    recordDiagnostic:()=>{}
  });
  vm.runInContext(code+"\nthis.reconcile=postConnectReconciliation;",context);
  const pending=context.reconcile(false);
  assert.equal(model.workspaceConnectionCommittedRoot,null);
  assert.equal(signals.length,0);
  gate.resolve();
  await pending;
  assert.equal(model.workspaceConnectionCommittedRoot,B);
  assert.equal(signals.join(","),"CONNECTED");
  // The read-only connection must also publish readiness after all model loads.
  assert.match(app,/model\.workspaceConnectionCommittedRoot=model\.root;\s*setConnectionState\("CONNECTED"\);\s*renderSetup\(\);\s*document\.dispatchEvent\(new Event\("moondog-data"\)\)/);
});

test("ready does not loop or retry persistent read failure on unchanged root", async () => {
  const A={name:"Fake-A"}, calls=[],errors=[];
  const h=historyHarness(A,()=>{calls.push("failed");throw new Error("Synthetic read failure");});
  Object.assign(h.context, {
    active:()=>"home",renderHome:()=>{},
    checkOperatingDate:async()=>{},refreshCurrent:()=>{},
    selectNext:async()=>{throw new Error("Should not select");},
    say:message=>errors.push(message)
  });
  vm.runInContext(readiness+"\nthis.ready=ready;",h.context);
  await h.context.ready();
  await tick();
  assert.equal(calls.length,1);
  assert.equal(errors.length,1);
  assert.equal(h.state.loading,false);
  assert.equal(h.state.loadedRoot,null);
});

test("new root synchronously revokes A Home task and search controls", async () => {
  const A={name:"Fake-A"},B={name:"Fake-B"},gate=deferred();
  const h=searchHarness(A,(path)=>path==="backups"?[]:gate.promise);
  h.model.state.records=[{id:"A",customer:"Alpha-customer"}];
  h.state.loadedRoot=A;
  h.state.current={id:"A",customer:"Alpha-customer"};
  h.state.searchResults=[];
  h.state.mobile={timer:null};
  const task={children:[{textContent:"Old A task"}],replaceChildren(...items){this.children=items;},textContent:""};
  const get=h.context.$;
  h.context.$=id=>id==="dailyTask"?task:get(id);
  h.context.clearTimeout=()=>{};
  const source=extract(daily,"  function suspendForWorkspaceChange(){","  function go(");
  vm.runInContext(source+"\nthis.suspendForWorkspaceChange=suspendForWorkspaceChange;",h.context);
  h.input.value="Alpha";
  const search=h.context.searchAll();
  assert.ok(h.host.children.some(row=>String(row.textContent).includes("Alpha-customer")));
  // Actual root replacement emits a synchronous event before any B file reads.
  h.model.root=B;
  h.context.suspendForWorkspaceChange();
  assert.equal(h.state.current,null);
  assert.equal(h.state.loadedRoot,null);
  assert.equal(h.state.history.length,0);
  assert.equal(h.state.events.length,0);
  assert.equal(h.state.searchResults.length,0);
  assert.equal(h.host.hidden,true);
  assert.equal(h.host.children.length,0);
  assert.equal(task.children.length,0);
  assert.equal(task.textContent,"Connecting working folder…");
  gate.resolve([eventFile("A-history")]);
  await search;
  assert.equal(h.host.children.length,0,"Late A search must not repaint A content");
  assert.equal(h.state.current,null,"No A action remains available under B");
  const dispatches=app.match(/model\.root = wrapOperationalRoot\(await operationalRoot\(handle\)\); model\.applicationRoot = handle;\s*\/\/ Synchronously revoke old Daily task\/search actions before any B async load\.\s*document\.dispatchEvent\(new Event\("moondog-workspace-changing"\)\)/g)||[];
  assert.equal(dispatches.length,2,"Both writable and read-only root assignments revoke A actions synchronously");
  assert.match(daily,/if\(typeof model!==['"]undefined['"]&&model\.workspaceConnectionCommittedRoot&&model\.root&&model\.workspaceConnectionCommittedRoot!==model\.root\)\{\s*const host=\$\('dailyTask'\)/);
});

test("overlapping connection attempts serialize across restore and manual switching", async () => {
  const code=extract(app,"  let workspaceConnectionBusy=false;","  async function completeWorkspaceConnection(handle, ask) {");
  const gate=deferred(),calls=[];
  const context=vm.createContext({completeWorkspaceConnection:async(handle)=>{
    calls.push(handle);
    if(handle==="Fake-B")await gate.promise;
    return handle;
  }});
  vm.runInContext(code+"\nthis.finishConnection=finishConnection;",context);
  const B=context.finishConnection("Fake-B",true);
  await tick();
  await assert.rejects(()=>context.finishConnection("Fake-C",true),/Another Workspace connection/);
  assert.equal(calls.join(","),"Fake-B");
  gate.resolve();
  assert.equal(await B,"Fake-B");
  assert.equal(await context.finishConnection("Fake-C",true),"Fake-C");
  assert.equal(calls.join(","),"Fake-B,Fake-C");
});

test("rejected overlapping manual switch preserves active connection write authority", async () => {
  const A={name:"Fake-A"}, B={name:"Fake-B"}, C={name:"Fake-C"};
  const gate=deferred(),calls=[];
  const writeAuthority={canWrite:true,disableCalls:0,disable(){this.disableCalls++;this.canWrite=false;}};
  const context=vm.createContext({
    completeWorkspaceConnection:async handle=>{
      calls.push(handle.name);
      if(handle===B)await gate.promise;
      return handle;
    },
    model:{root:A,pendingRoot:null},
    __moondogDailyUI:{confirmWorkspaceChange:()=>true},
    window:{showDirectoryPicker:async()=>C},
    writeAuthority,
    setConnectionState:()=>{}
  });
  const wrapper=extract(app,"  let workspaceConnectionBusy=false;","  async function completeWorkspaceConnection(handle, ask) {");
  vm.runInContext(wrapper+"\n"+connection+"\nthis.finishConnection=finishConnection;this.connect=connect;",context);
  const first=context.finishConnection(B,true);
  await tick();
  await assert.rejects(()=>context.connect(),error=>{
    assert.equal(error.code,"WORKSPACE_CONNECTION_BUSY");
    return true;
  });
  assert.equal(writeAuthority.disableCalls,0,"Rejected second switch must not revoke B's authority");
  assert.equal(writeAuthority.canWrite,true);
  assert.equal(calls.join(","),"Fake-B","C never starts");
  gate.resolve();
  assert.equal(await first,B);
  assert.equal(writeAuthority.canWrite,true,"B stays writable after it finishes");
});

test("ordinary folder-connection failure still disables write authority", async () => {
  const model={root:{name:"Fake-A"},pendingRoot:null};
  const writeAuthority={canWrite:true,disableCalls:0,disable(){this.disableCalls++;this.canWrite=false;}};
  const context=vm.createContext({
    model,writeAuthority,
    __moondogDailyUI:{confirmWorkspaceChange:()=>true},
    window:{showDirectoryPicker:async()=>({name:"Fake-B"})},
    finishConnection:async()=>{throw new Error("Synthetic permission failure");},
    setConnectionState:()=>{}
  });
  vm.runInContext(connection+"\nthis.connect=connect;",context);
  await assert.rejects(()=>context.connect(),/Synthetic permission failure/);
  assert.equal(writeAuthority.disableCalls,1,"Real connection failures retain prior fail-closed policy");
  assert.equal(writeAuthority.canWrite,false);
});

test("busy saved-folder restore does not show a false permission-required error", async () => {
  const A={name:"Fake-A"},pending={name:"Fake-B"};
  const states=[],writeAuthority={canWrite:true,disableCalls:0,disable(){this.disableCalls++;this.canWrite=false;}};
  const context=vm.createContext({
    model:{root:A,pendingRoot:pending},
    __moondogDailyUI:{confirmWorkspaceChange:()=>true},
    window:{showDirectoryPicker:async()=>pending},
    finishConnection:async()=>{const error=new Error("Busy");error.code="WORKSPACE_CONNECTION_BUSY";throw error;},
    writeAuthority,setConnectionState:state=>states.push(state)
  });
  vm.runInContext(connection+"\nthis.connect=connect;",context);
  await assert.rejects(()=>context.connect(),error=>error.code==="WORKSPACE_CONNECTION_BUSY");
  assert.equal(writeAuthority.disableCalls,0);
  assert.equal(writeAuthority.canWrite,true);
  assert.equal(states.includes("PERMISSION REQUIRED"),false);
  assert.equal(context.model.root,A);
});

test("declined Home draft confirmation stops Workspace picker without changing root or draft", async () => {
  const A={name:"Fake-A"},B={name:"Fake-B"};
  const state={editing:true},model={root:A,pendingRoot:null};
  let confirmations=0,picks=0,connections=0;
  const context=vm.createContext({
    state,model,
    confirm:()=>{confirmations++;return false;},
    window:{showDirectoryPicker:async()=>{picks++;return B;}},
    finishConnection:async()=>{connections++;},
    writeAuthority:{disable:()=>{}},setConnectionState:()=>{}
  });
  vm.runInContext(draftGuard+"\nthis.discardDraftOk=discardDraftOk;",context);
  context.__moondogDailyUI={confirmWorkspaceChange:()=>context.discardDraftOk()};
  vm.runInContext(connection+"\nthis.connect=connect;",context);
  await context.connect();
  assert.equal(confirmations,1);
  assert.equal(picks,0);
  assert.equal(connections,0);
  assert.equal(model.root,A);
  assert.equal(state.editing,true);
  assert.match(daily,/confirmWorkspaceChange:discardDraftOk/);
});

test("confirming draft then cancelling folder picker preserves draft and root", async () => {
  const A={name:"Fake-A"},state={editing:true},model={root:A,pendingRoot:null};
  let confirmations=0,picks=0;
  const context=vm.createContext({
    state,model,confirm:()=>{confirmations++;return true;},
    window:{showDirectoryPicker:async()=>{picks++;const e=new Error("Synthetic picker cancellation");e.name="AbortError";throw e;}},
    finishConnection:async()=>{throw new Error("Unexpected connection");},
    writeAuthority:{disable:()=>{}},setConnectionState:()=>{}
  });
  vm.runInContext(draftGuard+"\nthis.discardDraftOk=discardDraftOk;",context);
  context.__moondogDailyUI={confirmWorkspaceChange:()=>context.discardDraftOk()};
  vm.runInContext(connection+"\nthis.connect=connect;",context);
  await assert.rejects(()=>context.connect(),{name:"AbortError"});
  assert.equal(confirmations,1);
  assert.equal(picks,1);
  assert.equal(model.root,A);
  assert.equal(state.editing,true);
});

test("missing Daily UI guard fails closed before picker or root change", async () => {
  const A={name:"Fake-A"},model={root:A,pendingRoot:null};
  let picks=0;
  const context=vm.createContext({
    model,
    window:{showDirectoryPicker:async()=>{picks++;return {name:"Fake-B"};}},
    writeAuthority:{disable:()=>{}},setConnectionState:()=>{}
  });
  vm.runInContext(connection+"\nthis.connect=connect;",context);
  await assert.rejects(()=>context.connect(),/Daily Operations is still initializing/);
  assert.equal(picks,0);
  assert.equal(model.root,A);
});
