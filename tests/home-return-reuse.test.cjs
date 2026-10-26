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
  let minute=Date.parse("2026-10-25T20:02:00Z"),businessDate="2026-10-25",hour=13,
      paints=0,paintAdvanceMs=0,rankingAdvanceMs=0,lastPaintedTask=null;
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
  const listeners=new Map(),refresh={sources:{}};
  const context=vm.createContext({
    model,state,api:{refreshHistory:()=>refresh},now:()=>minute,today:()=>businessDate,businessHour:()=>hour,
    attentionTopThree:()=>{
      const until=Date.parse(refresh.sources.performance?.notNowUntil||"");
      const id=Number.isFinite(until)&&minute<until?"report-snoozed":"report-due";
      minute+=rankingAdvanceMs;
      return [{id,fingerprint:id}];
    },
    renderHome:top=>{paints++;lastPaintedTask=top?.[0]?.id||null;minute+=paintAdvanceMs;},
    $:id=>id==="dailyTask"?taskNode:id==="view-home"?homeNode:null,
    document:{addEventListener:(type,listener)=>listeners.set(type,listener)}
  });
  const helpers=section("  let homePaintReceipt=null;","  function settingsCategory(category){");
  const invalidation=section("  for(const eventName of ['moondog-data'","  installThemeToggle();installShell();");
  vm.runInContext(helpers+"\n"+invalidation+"\nthis.canReuse=canReuseHomeOnReturn;this.rankHome=rankedHomeSnapshot;",context);

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

  // Report reminder snoozes are persisted in refreshHistory, not task events.
  // The source planner releases the report at its exact notNowUntil time.
  refresh.sources.performance={notNowUntil:"2026-10-25T20:03:45.000Z"};
  context.renderHome();
  minute=Date.parse("2026-10-25T20:03:35.000Z");
  assert.equal(context.canReuse(),true,"report remains snoozed before exact deadline");
  minute=Date.parse("2026-10-25T20:03:50.000Z");
  assert.equal(context.canReuse(),false,
    "same-minute report-snooze expiry must refresh Home report priorities");
  context.renderHome();assert.equal(context.canReuse(),true);

  // Deadline and minute transitions during synchronous ranking/DOM painting
  // must invalidate the receipt at creation, even before the next navigation.
  refresh.sources.performance.notNowUntil="2026-10-25T20:05:45.000Z";
  minute=Date.parse("2026-10-25T20:05:44.950Z");paintAdvanceMs=100;
  context.renderHome();
  assert.equal(context.canReuse(),false,
    "report snooze crossing during paint must not certify stale Home DOM");
  paintAdvanceMs=0;context.renderHome();
  assert.equal(context.canReuse(),true,"a fresh post-expiry paint may be reused");
  refresh.sources.performance.notNowUntil="";
  minute=Date.parse("2026-10-25T20:06:59.950Z");paintAdvanceMs=100;
  context.renderHome();
  assert.equal(context.canReuse(),false,
    "minute rollover during paint invalidates the just-rendered Home");
  paintAdvanceMs=0;context.renderHome();assert.equal(context.canReuse(),true);

  // selectNext()/refreshCurrent() pass a pre-ranked snapshot. If it becomes
  // stale before painting, the Home wrapper must discard and recalculate it.
  refresh.sources.performance.notNowUntil="2026-10-25T20:08:45.000Z";
  minute=Date.parse("2026-10-25T20:08:44.950Z");
  const stale=context.rankHome();
  assert.equal(stale.top[0].id,"report-snoozed");
  minute=Date.parse("2026-10-25T20:08:45.050Z");
  context.renderHome(stale.top,stale);
  assert.equal(lastPaintedTask,"report-due",
    "a supplied task ranking from before a deadline must not paint stale Home");
  assert.equal(context.canReuse(),true,"re-ranked fresh Home is reusable");

  // Also cross a deadline *during* the task ranking function; the first
  // selection is stale and must be retried before it is offered to Home.
  refresh.sources.performance.notNowUntil="2026-10-25T20:09:45.000Z";
  minute=Date.parse("2026-10-25T20:09:44.950Z");rankingAdvanceMs=100;
  const retried=context.rankHome();
  assert.equal(retried.stable,true,"ranking retries after a deadline crossing");
  assert.equal(retried.top[0].id,"report-due",
    "ranking crossing an exact deadline must pick the newly actionable report");
  rankingAdvanceMs=0;context.renderHome(retried.top,retried);
  assert.equal(lastPaintedTask,"report-due");
  assert.equal(context.canReuse(),true);

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
  assert.match(daily,/const ranked=rankedHomeSnapshot\(\),top=ranked\.top,task=/,
    "selectNext must preserve the time-tested ranking receipt until Home paint");
  assert.match(daily,/const ranked=rankedHomeSnapshot\(\),top=ranked\.top,next=/,
    "refreshCurrent must preserve the time-tested ranking receipt until Home paint");
});
