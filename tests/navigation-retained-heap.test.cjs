"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {execFileSync}=require("node:child_process");
const path=require("node:path");

if(process.argv[2]!=="--probe")test("navigation remains bounded across 500 synthetic tab cycles and source revisions",()=>{
  const output=execFileSync(process.execPath,["--expose-gc",__filename,"--probe"],{encoding:"utf8",timeout:30000});
  const result=JSON.parse(output.trim());
  assert.equal(result.syntheticCycles,500);
  assert.equal(result.sourceRevisions,20);
  assert.ok(result.pendingCallbacks===0,"navigation callback queues should be empty after each flushed cycle");
  assert.ok(result.heapSamples.length>=10);
  assert.ok(result.heapSamples.every(Number.isSafeInteger));
  assert.ok(result.retainedHeapDeltaBytes<1024*1024,
    "navigation retained "+result.retainedHeapDeltaBytes+" bytes after full GC; expected less than 1 MiB");
  assert.ok(result.maxRetainedGrowthBytes<1024*1024,
    "navigation intermediate full-GC samples grew by "+result.maxRetainedGrowthBytes+" bytes; expected less than 1 MiB");
  console.log("# retained-navigation-heap "+JSON.stringify(result));
});

if(process.argv[2]==="--probe"){
  const fs=require("node:fs");
  const vm=require("node:vm");
  const src=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
  const begin=src.indexOf("  // Keep calculated Meeting and Performance views");
  const end=src.indexOf("  function ensurePhase3Ui()",begin);
  assert.ok(begin>0&&end>begin,"production navigation implementation exists");
  const navigation=src.slice(begin,end);
  const names=["home","tools","performance","meeting","open-ro","arrivals","assign-next"];
  const makeClassList=()=>{const values=new Set();return{
    add:name=>values.add(name),remove:name=>values.delete(name),
    contains:name=>values.has(name),toggle:(name,on)=>on?values.add(name):values.delete(name)
  };};
  const buttons=Object.fromEntries(names.map(name=>[name,{textContent:name,classList:makeClassList(),setAttribute(){},removeAttribute(){}}]));
  const views=Object.fromEntries(names.map(name=>[name,{classList:makeClassList()}]));
  const pendingFrames=[],pendingTimers=[];
  const draw={meeting:0,performance:0,openRo:0,arrivals:0};
  const context={
    ui:{pageTitle:{textContent:""},appointmentDate:{value:"2026-10-12"},arrivalSearch:{value:""},
      ...Object.fromEntries(Object.entries(views).map(([name,view])=>["view-"+name,view]))},
    document:{
      querySelector:selector=>buttons[selector.match(/data-view="([^"]+)"/)?.[1]]||null,
      querySelectorAll:selector=>selector===".nav-item"?Object.values(buttons):selector===".view"?Object.values(views):[],
      getElementById:()=>null
    },
    renderMeeting:()=>{draw.meeting++;},renderPerformance:()=>{draw.performance++;},
    renderTable:()=>{draw.openRo++;},renderArrivals:()=>{draw.arrivals++;},renderAssignNext:()=>{},
    localDateKey:()=>"2026-10-12",freshness:{timeParts:()=>({hour:10})},
    businessTimeZone:()=>"America/Los_Angeles",ensureMeetingV3Shell:()=>{},
    requestAnimationFrame:fn=>pendingFrames.push(fn),setTimeout:fn=>pendingTimers.push(fn),
    performance:{now:()=>0},console:{warn:()=>{}},
    globalThis:{__serviceMeetingPresenter:{activate(){},paint(){}}}
  };
  vm.runInNewContext(navigation,context);
  const flush=()=>{
    let turns=0;
    while(pendingFrames.length||pendingTimers.length){
      if(++turns>100)throw new Error("navigation callback queue did not settle");
      while(pendingFrames.length)pendingFrames.shift()();
      while(pendingTimers.length)pendingTimers.shift()();
    }
  };
  const cycle=()=>{
    for(const name of names){context.navigateTo(name);flush();}
    for(const name of names.slice().reverse()){context.navigateTo(name);flush();}
  };
  cycle();
  if(typeof global.gc==="function")global.gc();
  const start=process.memoryUsage().heapUsed;
  const samples=[];
  let pendingCallbacks=0,sourceRevisions=0;
  for(let i=0;i<500;i++){
    cycle();
    if((i+1)%25===0){context.invalidateNavigationRenders();sourceRevisions++;}
    flush();
    pendingCallbacks=Math.max(pendingCallbacks,pendingFrames.length+pendingTimers.length);
    if((i+1)%50===0){
      if(typeof global.gc==="function")global.gc();
      samples.push(process.memoryUsage().heapUsed);
    }
  }
  if(typeof global.gc==="function")global.gc();
  const endHeap=process.memoryUsage().heapUsed;
  const growth=samples.map(value=>value-start);
  const result={
    syntheticCycles:500,sourceRevisions,pendingCallbacks,
    heapSamples:samples,
    retainedHeapDeltaBytes:endHeap-start,
    maxRetainedGrowthBytes:Math.max(0,...growth),
    rendered:draw
  };
  process.stdout.write(JSON.stringify(result));
}