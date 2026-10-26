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
const unloadBinding=app.match(/window\.addEventListener\("beforeunload",guardUnsavedEditUnload\);/)?.[0];
assert.ok(unloadBinding,"the production unload guard is registered");

function harness({dirty=false,confirm=true,activeView="open-ro"}={}){
  let closed=0,confirmCalls=0,unloadHandler=null;
  const dialog={open:true,close(){closed++;this.open=false;}};
  const context={
    window:{confirm:()=>{confirmCalls++;return confirm;},addEventListener:(event,handler)=>{if(event==="beforeunload")unloadHandler=handler;}},
    document:{querySelector:selector=>selector===".view.active"?{id:`view-${activeView}`}:null},
    ui:{editDialog:dialog}
  };
  vm.runInNewContext(production+"\n"+unloadBinding+"\n"+[
    "this.guard=guardUnsavedEditUnload;",
    "this.unload=window.__unload;",
    "this.navigateGuard=confirmEditNavigation;",
    "this.setDirty=(value)=>{editDraftDirty=value;}",
    "this.close=closeEditDialog;",
    "this.isDirty=()=>editDraftDirty;"
   ].join("\n"),context);
  context.unload=unloadHandler;
  context.setDirty(dirty);
  return{context,dialog,closed:()=>closed,confirmCalls:()=>confirmCalls};
}

test("registered beforeunload handler preserves a dirty Open RO draft",()=>{
  const h=harness({dirty:true});
  let prevented=false;
  const event={returnValue:null,preventDefault(){prevented=true;}};
  h.context.unload(event);
  assert.equal(prevented,true);
  assert.equal(event.returnValue,"");
  assert.equal(h.context.isDirty(),true);
});

test("clean Open RO editor does not prompt before page unload",()=>{
  const h=harness();
  let prevented=false;
  const event={returnValue:null,preventDefault(){prevented=true;}};
  h.context.unload(event);
  assert.equal(prevented,false);
  assert.equal(event.returnValue,null);
});

test("discard confirmation keeps the draft on dialog-close cancel and clears it after explicit discard",()=>{
  const cancelled=harness({dirty:true,confirm:false});
  cancelled.context.close();
  assert.equal(cancelled.closed(),0);
  assert.equal(cancelled.context.isDirty(),true);

  const discarded=harness({dirty:true,confirm:true});
  discarded.context.close();
  assert.equal(discarded.closed(),1);
  assert.equal(discarded.context.isDirty(),false);
});

test("canceling SPA navigation preserves the draft and leaves the edit dialog open",()=>{
  const h=harness({dirty:true,confirm:false});
  assert.equal(h.context.navigateGuard("dashboard"),false);
  assert.equal(h.confirmCalls(),1);
  assert.equal(h.context.isDirty(),true);
  assert.equal(h.dialog.open,true);
  assert.equal(h.closed(),0);
});

test("confirming SPA navigation clears and closes the dirty editor before leaving",()=>{
  const h=harness({dirty:true,confirm:true});
  assert.equal(h.context.navigateGuard("dashboard"),true);
  assert.equal(h.confirmCalls(),1);
  assert.equal(h.context.isDirty(),false);
  assert.equal(h.dialog.open,false);
  assert.equal(h.closed(),1);
});

test("navigation within the active view does not discard the dirty draft",()=>{
  const h=harness({dirty:true,activeView:"open-ro",confirm:false});
  assert.equal(h.context.navigateGuard("open-ro"),true);
  assert.equal(h.confirmCalls(),0);
  assert.equal(h.context.isDirty(),true);
  assert.equal(h.dialog.open,true);
});

test("production navigation guard runs before any view navigation side effects",()=>{
  assert.match(app,/function navigateTo\(view,anchor=""\)\{if\(typeof confirmEditNavigation==="function"&&!confirmEditNavigation\(view\)\)return;const button=document\.querySelector/);
});
