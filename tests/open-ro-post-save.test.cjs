"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

// Evaluate the shipped post-commit path, without touching a Workspace or files.
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const from=app.indexOf("  async function finishSavedOpenRo(");
const to=app.indexOf("  async function saveRecord(",from);
assert.ok(from>=0&&to>from,"production save completion helper is available");
const production=app.slice(from,to);

async function scenario({historyFails=false,workbookFails=false,advance=true,nextId="next"}={}) {
  const events=[],diagnostics=[],messages=[];
  const model={state:{records:[{id:"synthetic"},{id:"next"}]}};
  const ui={editDialog:{close:()=>events.push("closed")}};
  const context={
    model,ui,editDraftDirty:true,
    addHistory:async()=>{events.push("history");if(historyFails)throw Object.assign(new Error("Synthetic journal failure"),{name:"NotReadableError"});},
    markSupervisorWorkbookStale:async()=>{events.push("workbook");if(workbookFails)throw Object.assign(new Error("Synthetic recovery failure"),{name:"NotAllowedError"});},
    recordDiagnostic:(kind,text)=>diagnostics.push({kind,text}),
    renderAll:()=>events.push("render"),
    openEdit:(id,origin)=>events.push("next:"+id+":"+origin),
    status:(message,type)=>messages.push({message,type})
  };
  vm.runInNewContext(production+"\nthis.finishSavedOpenRo=finishSavedOpenRo;",context);
  const record={id:"synthetic",ro:"SYNTHETIC-001"};
  const before={nextAction:"Inspect"};
  const after={nextAction:"Verify parts ETA"};
  const saved=await context.finishSavedOpenRo(record,before,after,"table",advance,nextId);
  return {saved,events,diagnostics,messages,dirty:context.editDraftDirty};
}

test("verified RO save advances and confirms successful follow-ups",async()=>{
  const result=await scenario();
  assert.equal(result.saved,true);
  assert.deepEqual(result.events,["history","workbook","render","next:next:table"]);
  assert.equal(result.messages[0].type,"success");
  assert.match(result.messages[0].message,/saved and read-back verified/);
  assert.equal(result.dirty,false);
});

test("failed activity history does not block workbook invalidation or Save & Next",async()=>{
  const result=await scenario({historyFails:true});
  assert.deepEqual(result.events,["history","workbook","render","next:next:table"]);
  assert.equal(result.messages[0].type,"error");
  assert.match(result.messages[0].message,/saved and read-back verified/);
  assert.match(result.messages[0].message,/Activity history could not be verified/);
  assert.equal(result.diagnostics.length,1);
});

test("failed workbook invalidation never implies rollback or permits trust in old workbook",async()=>{
  const result=await scenario({workbookFails:true});
  assert.deepEqual(result.events,["history","workbook","render","next:next:table"]);
  assert.equal(result.saved,true);
  assert.equal(result.messages[0].type,"error");
  assert.match(result.messages[0].message,/Do not import the previous workbook/);
  assert.doesNotMatch(result.messages[0].message,/Supervisor Workbook is out of date; generate/);
  assert.equal(result.diagnostics[0].kind,"WORKBOOK STALE MARK FAILED");
});

test("both secondary failures remain visible and saved RO still completes",async()=>{
  const result=await scenario({historyFails:true,workbookFails:true,advance:false});
  assert.deepEqual(result.events,["history","workbook","render","closed"]);
  assert.equal(result.messages[0].type,"error");
  assert.equal(result.diagnostics.length,2);
  assert.equal(result.dirty,false);
});

test("stale next selection closes after save rather than navigating into a removed RO",async()=>{
  const result=await scenario({nextId:"removed"});
  assert.deepEqual(result.events,["history","workbook","render","closed"]);
  assert.doesNotMatch(result.messages[0].message,/Continue with the next displayed RO/);
});

test("production entry only delegates follow-ups after read-back verified saveState",()=>{
  const portion=app.slice(app.indexOf("  async function saveRecord("),app.indexOf("  async function closeRo("));
  assert.match(portion,/await saveState\("Updated RO "\+record\.ro, priorState\)/);
  assert.match(portion,/return finishSavedOpenRo\(record,before,proposed,origin,advance,nextId\)/);
  assert.ok(portion.indexOf("await saveState(")<portion.indexOf("return finishSavedOpenRo("));
});
