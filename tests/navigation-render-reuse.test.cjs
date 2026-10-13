"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const src=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const begin=src.indexOf("  // Keep calculated Meeting and Performance views");
const end=src.indexOf("  function ensurePhase3Ui()",begin);
assert.ok(begin>0&&end>begin,"production navigation implementation exists");
const navigation=src.slice(begin,end);

function harness(){
  const pendingFrames=[],pendingTimers=[],draw={meeting:0,performance:0},calls={paint:0,activate:0,shell:0};
  const makeClassList=()=>{const values=new Set();return{
    add:name=>values.add(name),remove:name=>values.delete(name),
    contains:name=>values.has(name),toggle:(name,on)=>on?values.add(name):values.delete(name)
  };};
  const names=["home","tools","performance","meeting","open-ro","arrivals","assign-next"];
  const buttons=Object.fromEntries(names.map(name=>[name,{textContent:name,
    classList:makeClassList(),setAttribute(){},removeAttribute(){}}]));
  const views=Object.fromEntries(names.map(name=>[name,{classList:makeClassList()}]));
  const context={
    ui:{pageTitle:{textContent:""},...Object.fromEntries(Object.entries(views).map(([n,v])=>["view-"+n,v]))},
    document:{
      querySelector:selector=>buttons[selector.match(/data-view="([^"]+)"/)?.[1]]||null,
      querySelectorAll:selector=>selector===".nav-item"?Object.values(buttons):selector===".view"?Object.values(views):[],
      getElementById:()=>null
    },
    renderMeeting:()=>{draw.meeting++;},
    renderPerformance:()=>{draw.performance++;},
    renderTable:()=>{},renderArrivals:()=>{},renderAssignNext:()=>{},
    ensureMeetingV3Shell:()=>{calls.shell++;},
    requestAnimationFrame:fn=>pendingFrames.push(fn),
    setTimeout:(fn)=>pendingTimers.push(fn),
    performance:{now:()=>0},
    console:{warn:()=>{}},
    globalThis:{__serviceMeetingPresenter:{
      activate:()=>{calls.activate++;},
      paint:()=>{calls.paint++;}
    }}
  };
  vm.runInNewContext(navigation,context);
  const flush=()=>{
    while(pendingFrames.length||pendingTimers.length){
      while(pendingFrames.length)pendingFrames.shift()();
      while(pendingTimers.length)pendingTimers.shift()();
    }
  };
  return {context,draw,calls,flush,views};
}

test("repeated navigation reuses Meeting and Performance DOM on unchanged data",()=>{
  const {context,draw,calls,flush,views}=harness();
  context.navigateTo("meeting");flush();
  context.navigateTo("performance");flush();
  for(let i=0;i<40;i++){
    context.navigateTo("home");flush();
    context.navigateTo("meeting");flush();
    context.navigateTo("performance");flush();
  }
  assert.equal(draw.meeting,1,"Meeting should compute once with identical source");
  assert.equal(draw.performance,1,"Performance should compute once with identical source");
  assert.equal(calls.paint,1,"Meeting recomputes slide state only after an actual rebuild");
  assert.equal(views.performance.classList.contains("active"),true);
});

test("source revision invalidation updates both screens but not unrelated tab returns",()=>{
  const {context,draw,flush}=harness();
  context.navigateTo("meeting");flush();
  context.navigateTo("performance");flush();
  context.invalidateNavigationRenders();
  context.navigateTo("home");flush();
  context.navigateTo("meeting");flush();
  context.navigateTo("performance");flush();
  assert.deepEqual(draw,{meeting:2,performance:2});
  context.navigateTo("meeting");flush();
  assert.equal(draw.meeting,2,"a reactivated presenter does not need a new data render");
  assert.match(src,/renderAll = function \(\) \{\s*invalidateNavigationRenders\(\);\s*renderBeforeDaily\(\);/);
});

test("rapid tab switching cancels stale expensive Meeting and Performance draws",()=>{
  const {context,draw,flush}=harness();
  context.navigateTo("meeting");
  context.navigateTo("performance");
  context.navigateTo("home");
  flush();
  assert.deepEqual(draw,{meeting:0,performance:0},"hidden tabs must never render from delayed callbacks");
  context.navigateTo("performance");flush();
  assert.equal(draw.performance,1);
  context.navigateTo("meeting");flush();
  assert.equal(draw.meeting,1);
});

test("direct report updates refresh cache stamp and still redraw when requested",()=>{
  const {context,draw,flush}=harness();
  context.navigateTo("meeting");flush();
  context.invalidateNavigationRenders();
  context.renderMeeting();
  context.navigateTo("home");flush();
  context.navigateTo("meeting");flush();
  assert.equal(draw.meeting,2,"an explicit report refresh marks the rendered revision as current");
  context.navigateTo("performance");flush();
  context.invalidateNavigationRenders();
  context.renderPerformance();
  context.navigateTo("meeting");flush();
  context.navigateTo("performance");flush();
  assert.equal(draw.performance,2,"direct performance redraw must remain authoritative");
});
