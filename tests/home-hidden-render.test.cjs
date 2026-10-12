"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const daily=fs.readFileSync(path.join(__dirname,"..","assets","daily-ops.js"),"utf8");
function segment(begin,end){
  const from=daily.indexOf(begin),to=daily.indexOf(end,from+begin.length);
  assert.ok(from>=0&&to>from,"production source segment is present: "+begin);
  return daily.slice(from,to);
}

test("Background task refresh updates priorities and Home badge without rebuilding hidden DOM",async()=>{
  let view="performance",rankCalls=0,badgeCalls=0,drawCalls=0,drawnTop=null;
  let priorities=[{id:"ro:one",fingerprint:"a"}];
  const env={
    state:{current:null,editing:false,loading:false,busy:false,error:"",pending:false},
    engine:{phase:()=>"midday"},
    today:()=>"2026-10-12",now:()=>Date.parse("2026-10-12T20:00:00.000Z"),
    attentionTopThree:()=>{rankCalls++;return priorities;},
    refreshAttentionCount:()=>{badgeCalls++;},
    active:()=>view,renderHome:top=>{drawCalls++;drawnTop=top;},
    action:async fn=>fn(),allTasks:()=>[]
  };
  vm.runInNewContext(
    segment("  async function selectNext(){","  async function ready(){")+
    segment("  function refreshCurrent(){","  async function action(fn){")+
    "\nthis.selectNext=selectNext;this.refreshCurrent=refreshCurrent;",env);
  await env.selectNext();
  assert.equal(env.state.current.id,"ro:one");
  assert.equal(drawCalls,0,"hidden Home is not rebuilt after source import");
  assert.equal(rankCalls,1,"selection uses one rank pass");
  assert.equal(badgeCalls,1,"hidden Home still announces current priorities");
  env.refreshCurrent();
  assert.equal(drawCalls,0,"unchanged source does not rebuild hidden controls");
  assert.equal(badgeCalls,2);
  priorities=[{id:"ro:two",fingerprint:"b"}];
  env.refreshCurrent();
  assert.equal(env.state.current.id,"ro:two","new data reconciles while hidden");
  assert.equal(drawCalls,0);
  view="home";
  env.refreshCurrent();
  assert.equal(drawCalls,1,"return to Home draws fresh selection");
  assert.equal(drawnTop,priorities,"already-ranked priorities are reused");
  assert.equal(rankCalls,5);
});

test("Original Home selection uses a provided top-three snapshot rather than re-ranking",()=>{
  const head=segment("  function renderHome(prioritizedTop=null){","    const host=$('dailyTask');host.replaceChildren();");
  let extraRanks=0;
  const provided=[{id:"ro:two",fingerprint:"two"}];
  const env={model:{root:{},},state:{loadedRoot:{},editing:false,current:null},
    attentionTopThree:()=>{extraRanks++;return [{id:"other"}];}};
  vm.runInNewContext(head+"\nthis.preview=renderHome;",env);
  // Use a no-DOM test helper composed from the exact production pre-render block.
  vm.runInNewContext("this.beforePaint=function(prioritizedTop){"+head.slice(head.indexOf("{")+1)+"return top;};",env);
  const top=env.beforePaint(provided);
  assert.equal(top,provided);
  assert.equal(env.state.current,provided[0]);
  assert.equal(extraRanks,0);
});
