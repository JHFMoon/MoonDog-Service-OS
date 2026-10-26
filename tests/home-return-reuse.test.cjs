"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const daily=fs.readFileSync(path.join(__dirname,"..","assets","daily-ops.js"),"utf8");
function section(start,end){
  const a=daily.indexOf(start),b=daily.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"Production Home reuse section must exist: "+start);
  return daily.slice(a,b);
}

test("verified, unchanged Home return preserves mounted DOM but all source and permission boundaries invalidate",()=>{
  const root={name:"Synthetic connected folder"},taskNode={},
        homeNode={contains:node=>node===taskNode};
  let minute=Date.parse("2026-10-25T20:02:00Z"),businessDate="2026-10-25",hour=13,paints=0;
  const model={
    root,workspaceConnectionCommittedRoot:root,pendingRoot:null,
    connectionState:"CONNECTED",
    state:{updatedAt:"2026-10-25T20:01:30Z",records:[{id:"synthetic",ro:"000001"}]},
    appointments:{updatedAt:"0"},performance:{updatedAt:"0"},
    operationalMetrics:{updatedAt:"0"},assignNext:{updatedAt:"0"},
    settings:{updatedAt:"0"},recovery:{updatedAt:"0"}
  };
  const state={events:[],current:{id:"synthetic-task",fingerprint:"one"},
    loadedRoot:root,busy:false,loading:false,editing:false,pending:false};
  const listeners=new Map();
  const context=vm.createContext({
    model,state,now:()=>minute,today:()=>businessDate,businessHour:()=>hour,
    renderHome:()=>{paints++;},
    $:id=>id==="dailyTask"?taskNode:id==="view-home"?homeNode:null,
    document:{addEventListener:(type,listener)=>listeners.set(type,listener)}
  });
  const helpers=section("  let homePaintReceipt=null;","  function settingsCategory(category){");
  const invalidation=section("  for(const eventName of ['moondog-data'","  installThemeToggle();installShell();");
  vm.runInContext(helpers+"\n"+invalidation+"\nthis.canReuse=canReuseHomeOnReturn;",context);

  context.renderHome();assert.equal(paints,1);
  assert.equal(context.canReuse(),true,"an already verified Home can be reused in the same minute");
  minute+=25000;assert.equal(context.canReuse(),true);
  // A deferred task can become eligible before a clock minute changes.
  // Production MoonDogDailyEngine.eligible evaluates details.until exactly.
  state.events.push({id:"synthetic-suppression",at:"2026-10-25T20:02:25.000Z",
    details:{taskId:"synthetic-task",action:"deferred",fingerprint:"one",rank:1,
      until:"2026-10-25T20:02:45.000Z"}});
  context.renderHome();
  minute+=10000;assert.equal(context.canReuse(),true,"suppressed task remains hidden before exact expiry");
  minute+=15000;assert.equal(context.canReuse(),false,
    "a same-minute suppression expiry must re-evaluate the priority task");
  context.renderHome();assert.equal(context.canReuse(),true,"an expired suppression can be freshly painted");
  minute+=20000;assert.equal(context.canReuse(),false,"a new minute re-evaluates time-dependent priorities");
  context.renderHome();assert.equal(context.canReuse(),true);

  model.state.updatedAt="2026-10-25T20:03:20Z";
  assert.equal(context.canReuse(),false,"durable source revision invalidates");
  context.renderHome();assert.equal(context.canReuse(),true);

  state.events.push({id:"synthetic-event",at:"2026-10-25T20:03:30Z"});
  assert.equal(context.canReuse(),false,"task history invalidates");
  context.renderHome();assert.equal(context.canReuse(),true);

  for(const name of ["moondog-data","moondog-imported","moondog-saved",
      "moondog-workspace-changing","moondog-recovered"]){
    context.renderHome();assert.equal(context.canReuse(),true);
    assert.equal(typeof listeners.get(name),"function","event invalidation registered: "+name);
    listeners.get(name)();assert.equal(context.canReuse(),false,"event invalidates Home: "+name);
  }

  context.renderHome();model.pendingRoot=root;
  assert.equal(context.canReuse(),false,"permission reconnect cannot reuse Home actions");
  model.pendingRoot=null;model.connectionState="PERMISSION REQUIRED";
  assert.equal(context.canReuse(),false,"connection failure cannot be cached");
  model.connectionState="CONNECTED";state.pending=true;
  assert.equal(context.canReuse(),false,"unacknowledged newer data prevents reuse");
  state.pending=false;state.editing=true;
  assert.equal(context.canReuse(),false,"unsaved Home draft prevents reuse");
  state.editing=false;businessDate="2026-10-26";
  assert.equal(context.canReuse(),false,"business-date rollover invalidates");
  businessDate="2026-10-25";hour=14;
  assert.equal(context.canReuse(),false,"business-hour change invalidates");

  const nextRoot={name:"Synthetic replacement folder"};
  model.root=nextRoot;
  assert.equal(context.canReuse(),false,"old-root Home cannot be reused for a new Workspace");
  assert.match(daily,/if\(!canReuseHomeOnReturn\(\)\)refreshCurrent\(\)/,
    "actual navigation handler must use safe reuse predicate");
});
