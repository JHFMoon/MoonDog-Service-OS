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
  const model = {root, connectionState:"CONNECTED"};
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
  gate.resolve([eventFile("Fake-A")]);
  await initial;
  await tick();
  assert.equal(h.state.loadedRoot,C);
  assert.equal(h.state.history[0].id,"Fake-C");
  assert.equal(h.state.events[0].id,"Fake-C");
  assert.equal(calls.join(","),"Fake-A,Fake-C");
  assert.equal(selected.join(","),"Fake-C");
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
