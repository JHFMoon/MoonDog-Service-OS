"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf("  async function saveRecord(");
const end=app.indexOf("  async function closeRo(",start);
assert.ok(start>=0&&end>start,"production Open RO save handler exists");
const production=app.slice(start,end);

function harness(){
  const record={id:"synthetic",ro:"SYNTHETIC-001",management:{status:"Open",owner:"Synthetic owner",nextAction:"Inspect",reviewDate:"2026-10-23",communication:"called",note:""}};
  const next={id:"next",ro:"SYNTHETIC-002",management:{}};
  const model={state:{records:[record,next]},selectedId:"synthetic",editOrigin:"table"};
  const diagnostics=[],events=[];
  const ui={
    editNextAction:{value:"Verify parts ETA"},
    editReviewDate:{value:"2026-10-24"},
    editStatus:{value:"Open"},
    editStatusDetail:{value:""},
    editStatusDetailOther:{value:""},
    editCommunication:{value:"called"},
    editAdminBlocker:{value:""},
    editAdminTaskDate:{value:""},
    editAdminCloseDate:{value:""},
    editAdminChangeReason:{value:""},
    editOwner:{value:"Synthetic owner"},
    editNote:{value:"Synthetic note"},
    editValidation:{hidden:true,textContent:""}
  };
  const context={
    model,ui,COMMUNICATION_STATUSES:["called"],dailySaveAdditions:null,
    canonicalReviewStatus:value=>value,resolveStatusId:()=> "open",statusDetailsFor:()=>[],
    statusAllowedForSave:()=>true,editValidationError(message){throw new Error(message);},
    visibleRecordIds:()=>["synthetic","next"],visibleFocusIds:()=>[],
    localDateKey:()=>"2026-10-22",now:()=>"2026-10-22T15:00:00Z",
    saveState:async(_label,prior)=>{events.push("save");assert.equal(prior.records[0].management.nextAction,"Inspect");throw Object.assign(new Error("Synthetic read-back failure"),{name:"NotReadableError"});},
    finishSavedOpenRo:async()=>{events.push("post-save");},
    recordDiagnostic:(kind,message)=>diagnostics.push({kind,message})
  };
  vm.runInNewContext(production+"\nthis.run=saveRecord;",context);
  return{context,model,ui,diagnostics,events};
}

test("failed durable RO save preserves the draft and never advances to the next RO",async()=>{
  const h=harness();
  let prevented=false;
  await h.context.run({preventDefault(){prevented=true;}},true);
  assert.equal(prevented,true);
  assert.equal(h.model.state.records[0].management.nextAction,"Inspect","failed state rolls back in-memory data");
  assert.equal(h.ui.editNextAction.value,"Verify parts ETA","the user's unsaved entry remains visible for retry");
  assert.equal(h.events.includes("post-save"),false,"Save & Next completion must wait for verified durable save");
  assert.deepEqual(h.events,["save"]);
  assert.equal(h.ui.editValidation.hidden,false);
  assert.match(h.ui.editValidation.textContent,/entries are still shown; check the folder connection and try again/);
  assert.equal(h.diagnostics.length,1);
  assert.equal(h.diagnostics[0].kind,"QUICK UPDATE SAVE FAILED");
});
