"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf("  let editDraftDirty = false;");
const end=app.indexOf("  function visibleFocusIds()",start);
assert.ok(start>=0&&end>start,"production edit-draft guards exist");
const production=app.slice(start,end);
assert.match(app,/window\.addEventListener\("beforeunload",guardUnsavedEditUnload\)/);

function harness({dirty=false,confirm=true}={}){
  let closed=0;
  const context={editDraftDirty:dirty,window:{confirm:()=>confirm},
    ui:{editDialog:{close:()=>{closed++;}}}};
  vm.runInNewContext(production+[
    "this.guard=guardUnsavedEditUnload;",
    "this.close=closeEditDialog;",
    "this.isDirty=()=>editDraftDirty;"
  ].join("\n"),context);
  return{context,closed:()=>closed};
}

test("dirty Open RO draft asks the browser before a page unload and remains intact",()=>{
  const h=harness({dirty:true});
  let prevented=false;
  const event={returnValue:null,preventDefault(){prevented=true;}};
  h.context.guard(event);
  assert.equal(prevented,true,"request a prompt while preserving the draft until the user chooses");
  assert.equal(event.returnValue,"","request the browser's native unsaved-change prompt");
  assert.equal(h.context.isDirty(),true,"the draft remains dirty if the user cancels leaving");
});

test("clean Open RO editor does not prompt before page unload",()=>{
  const h=harness();
  let prevented=false;
  const event={returnValue:null,preventDefault(){prevented=true;}};
  h.context.guard(event);
  assert.equal(prevented,false);
  assert.equal(event.returnValue,null);
});

test("discard confirmation keeps the draft on cancel and clears it only after explicit discard",()=>{
  const cancelled=harness({dirty:true,confirm:false});
  cancelled.context.close();
  assert.equal(cancelled.closed(),0);
  assert.equal(cancelled.context.isDirty(),true);

  const discarded=harness({dirty:true,confirm:true});
  discarded.context.close();
  assert.equal(discarded.closed(),1);
  assert.equal(discarded.context.isDirty(),false);
});
