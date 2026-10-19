"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

// Run the real shipped wrapper, with deferred synthetic durable writes.
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf("  const saveBeforeDaily = saveRecord;");
const end=app.indexOf("  // Paste & Learn uses an ephemeral preview token;",start);
assert.ok(start>=0&&end>start,"production Open RO save wrapper exists");
const production=app.slice(start,end);
function harness(){
  const writes=[],notices=[];
  const model={selectedId:"SYNTHETIC-RO",editOrigin:"table",state:{records:[{id:"SYNTHETIC-RO"}]}};
  const ui={editValidation:{hidden:true,textContent:""}};
  let pending;
  const baseline=(event,advance)=>{writes.push({event,advance});return new Promise((resolve,reject)=>{pending={resolve,reject};});};
  const context={model,ui,dailyNotify:(type,detail)=>notices.push({type,detail}),saveRecord:baseline};
  vm.runInNewContext(production+"\nthis.saveForTest=saveRecord;",context);
  return {save:context.saveForTest,model,ui,writes,notices,finish:()=>pending};
}

test("overlapping Save and Save & Next launch only one durable mutation",async()=>{
  const h=harness(),event={count:0,preventDefault(){this.count++;}};
  const first=h.save(event,false,{reviewTime:"08:30"});
  assert.equal(h.writes.length,1);
  const overlapping=await h.save(event,true,{reviewTime:"09:30"});
  assert.equal(overlapping,false);
  assert.equal(h.writes.length,1,"second click must not start a competing backup or write");
  assert.equal(event.count,2,"blocked form submission still prevents navigation");
  assert.match(h.ui.editValidation.textContent,/save is still being verified/);
  h.finish().resolve(true);
  assert.equal(await first,true);
  assert.equal(h.notices.length,1);
});

test("successful save releases guard for a different RO",async()=>{
  const h=harness();
  const first=h.save(null,false);
  h.finish().resolve(true);
  assert.equal(await first,true);
  h.model.selectedId="NEXT-RO";
  h.model.state.records.push({id:"NEXT-RO"});
  const second=h.save(null,true);
  assert.equal(h.writes.length,2);
  h.finish().resolve(true);
  assert.equal(await second,true);
  assert.equal(h.notices.length,2);
});

test("storage rejection frees guard for a manager-initiated retry",async()=>{
  const h=harness();
  const first=h.save(null,false);
  h.finish().reject(new Error("synthetic storage failure"));
  await assert.rejects(first,/synthetic storage failure/);
  const retry=h.save(null,false);
  assert.equal(h.writes.length,2);
  h.finish().resolve(true);
  assert.equal(await retry,true);
});

test("invalid time fails before locking and leaves no unintended mutation",async()=>{
  const h=harness();
  await assert.rejects(h.save(null,false,{reviewTime:"29:99"}),/valid follow-up time/);
  assert.equal(h.writes.length,0);
  const valid=h.save(null,false,{reviewTime:"09:30"});
  h.finish().resolve(true);
  assert.equal(await valid,true);
  assert.equal(h.writes.length,1);
});
