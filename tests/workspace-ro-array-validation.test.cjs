"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function production(start,end){
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"actual production connection guard and stable source anchors exist");
  return app.slice(a,b);
}
const helper=production("  function validateConnectedWorkbookSnapshot(", "  async function finishReadOnlyConnection(");
const readOnly=production("      for (const [key, path] of paths) {", "      const rawSettings =");
const writable=production(
  "    validateConnectedWorkbookSnapshot(connectionReadResults[0]);",
  "    model.operationalMetrics.nextAppointments ||="
);
assert.match(readOnly,/validateConnectedWorkbookSnapshot\(loaded\)/);
assert.match(writable,/validateConnectedWorkbookSnapshot\(connectionReadResults\[0\]\)/);
assert.ok(writable.indexOf("validateConnectedWorkbookSnapshot") <
  writable.indexOf("normalizeControllableVinCounts"),
  "durable RO source validation must precede mutation or migration");

const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const valid=()=>({
  schemaVersion:1,updatedAt:"synthetic-update",source:{sha256:"synthetic-source-digest"},
  records:[{id:"SYN-OPEN-01",management:{note:"original manager note"}}],
  closedRecords:[{id:"SYN-CLOSED-01",closedAt:"2026-11-02T11:00:00.000Z",
    management:{note:"original closed note"}}]
});
function runHelper(value){
  const ctx=vm.createContext({});
  vm.runInContext(helper+"\nthis.validate=validateConnectedWorkbookSnapshot;",ctx);
  return ctx.validate(value);
}
test("actual connection validator accepts complete and truly absent legacy retained arrays",()=>{
  const current=valid();
  assert.equal(runHelper(current),current,"verified original data returned without cloning or mutation");
  assert.deepEqual(current,valid());
  const legacy=valid();delete legacy.closedRecords;
  assert.equal(runHelper(legacy),legacy,"absent legacy retained roster stays distinguishable");
  const empty=valid();empty.records=[];empty.closedRecords=[];
  assert.equal(runHelper(empty),empty,"explicit verified empty record arrays are valid");
});
test("corrupt arrays fail closed instead of becoming a zero-record Workspace",()=>{
  const source=valid();
  const values=[null,undefined,[],{},false,
    {...source,records:null},{...source,records:"invalid"},
    {...source,records:{items:[]}}, {...source,closedRecords:null},
    {...source,closedRecords:"invalid"},
    {...source,closedRecords:{items:[]}}];
  for(const value of values)assert.throws(()=>runHelper(value),/Saved Open\/Closed RO records are invalid/);
});
function readOnlyHarness(saved){
  const previous=valid(),model={state:clone(previous),appointments:{original:true}},readEvents=[];
  const ctx=vm.createContext({model,paths:[["state","state"],["appointments","appointments"]],
    readJson:async location=>{
      readEvents.push(location);
      return location==="state"?clone(saved):{replaced:true};
    }
  });
  vm.runInContext(helper+"\nthis.run=async function(){"+readOnly+"};",ctx);
  return {model,previous,readEvents,run:()=>ctx.run()};
}
test("read-only reconnect rejects malformed source before replacing prior active model state",async()=>{
  const bad=valid();bad.closedRecords=null;
  const h=readOnlyHarness(bad);
  await assert.rejects(h.run(),/Saved Open\/Closed RO records are invalid/);
  assert.deepEqual(h.model.state,h.previous,"existing connected state stays intact");
  assert.deepEqual(h.model.appointments,{original:true},"no partial hydration of later files");
  assert.deepEqual(h.readEvents,["state"],"invalid RO state halts subsequent reads");
});
test("read-only reconnect hydrates validated source and preserves manager notes",async()=>{
  const source=valid(),h=readOnlyHarness(source);
  await h.run();
  assert.deepEqual(h.model.state,source);
  assert.equal(h.model.state.closedRecords[0].management.note,"original closed note");
  assert.deepEqual(h.model.appointments,{replaced:true});
});
function writableHarness(saved){
  const prior=valid(),model={
    state:clone(prior),appointments:{prior:true},performance:{snapshots:{}},
    operationalMetrics:{original:true},meetingCycle:{},assignNext:{},autoImport:{},recovery:{}
  };
  const replacement=[clone(saved),{from:"appointment"},{snapshots:{}},{from:"metrics"},
    {from:"meeting"},{from:"assign"},{from:"auto"},{from:"recovery"}];
  const calls={normalizations:0,writes:0,history:0};
  const ctx=vm.createContext({
    model,connectionReadResults:replacement,pendingSettings:{},JSON,
    pruneClosedRecords:rows=>rows,
    normalizeControllableVinCounts:()=>{calls.normalizations++;return false;},
    writeJson:async()=>{calls.writes++;},addHistory:async()=>{calls.history++;},
    stamp:()=>"synthetic",now:()=>"synthetic",PERFORMANCE_PATH:["performance"]
  });
  vm.runInContext(helper+"\nthis.run=async function(){"+writable+"};",ctx);
  return {model,prior,calls,run:()=>ctx.run()};
}
test("write-enabled reconnect rejects malformed durable roster before hydration or migration",async()=>{
  for(const mutate of [state=>{state.records=null;},
    state=>{state.records={};},state=>{state.closedRecords=null;},
    state=>{state.closedRecords={items:[]};}]){
    const snapshot=valid();mutate(snapshot);
    const h=writableHarness(snapshot);
    await assert.rejects(h.run(),/Saved Open\/Closed RO records are invalid/);
    assert.deepEqual(h.model.state,h.prior,"prior in-memory source and manual edits untouched");
    assert.equal(h.model.appointments.prior,true);
    assert.deepEqual(h.calls,{normalizations:0,writes:0,history:0});
  }
});
test("write-enabled reconnect accepts verified synthetic empty and legacy retained states",async()=>{
  for(const kind of ["legacy","empty","current"]){
    const snapshot=valid();
    if(kind==="legacy")delete snapshot.closedRecords;
    if(kind==="empty"){snapshot.records=[];snapshot.closedRecords=[];}
    const h=writableHarness(snapshot);
    await h.run();
    assert.deepEqual(h.model.state.records,snapshot.records);
    assert.deepEqual(h.model.state.closedRecords,snapshot.closedRecords??[]);
    assert.equal(h.calls.normalizations,1);
    assert.equal(h.calls.writes,0);
    assert.equal(h.calls.history,0);
  }
});
