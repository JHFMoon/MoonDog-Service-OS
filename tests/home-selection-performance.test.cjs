"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("Home computes advisor skips once per task-selection pass",()=>{
  const source=read("assets/daily-ops.js");
  const start=source.indexOf("  function allTasks(){");
  const end=source.indexOf("  function attentionTopThree(){",start);
  assert.ok(start>=0&&end>start,"load the exact production task-selection helper");
  const tasks=Array.from({length:500},(_,i)=>({id:"task:"+i,type:"ro",advisor:String(i%5)}));
  tasks.push({id:"manager",type:"settings"});
  let skipReads=0;
  const harness={
    candidates:()=>tasks,
    compactTask:task=>task,
    skippedAdvisorsToday:()=>{skipReads++;return new Set(["3"]);},
    advisorCodeFor:task=>task.advisor
  };
  vm.runInNewContext(source.slice(start,end)+"\nthis.selectAll=allTasks;",harness);
  const selected=harness.selectAll();
  assert.equal(skipReads,1,"historical skip events are scanned once, never once per RO");
  assert.equal(selected.length,401,"skip filtering leaves all unrelated manager work intact");
  assert.ok(selected.every(task=>task.type!=="ro"||task.advisor!=="3"));
});

test("Indexed event eligibility preserves production task decisions and bounds history reads",()=>{
  const context=vm.createContext({Date,Intl,console});
  vm.runInContext(read("assets/freshness.js"),context);
  vm.runInContext(read("assets/daily-engine.js"),context);
  const ranking=context.ServiceRefreshIntelligence;
  const engine=context.MoonDogDailyEngine;
  const at=Date.parse("2026-10-12T22:00:00.000Z");
  const tasks=Array.from({length:240},(_,i)=>({
    id:"task:"+i,recordId:i%3===0?"record:"+i:null,
    type:i%3===0?"ro":i%3===1?"coaching":"followup",
    advisor:String(i%6),rank:i%9,age:i%12,
    fingerprint:"revision:"+(i%4),actual:4,key:"inspections",
    record:{management:{reviewDate:i%2?"2026-10-13":"2026-10-11",managerReviewedOn:""}}
  }));
  const events=Array.from({length:2200},(_,i)=>({
    at:"2026-10-12T20:00:00.000Z",
    details:{taskId:"task:"+(i%240),action:["completed","deferred","not-an-issue","advisor-skip"][i%4],
      taskType:"ro",rank:i%9,fingerprint:"revision:"+(i%5),until:"2026-10-13T00:00:00.000Z",actual:5}
  }));
  let reads=0;
  const tracked=events.map(event=>Object.defineProperty({at:event.at},"details",{
    get(){reads++;return event.details;},enumerable:true
  }));
  const oldSelection=ranking.topFive(tasks,tracked,{
    eligible:task=>engine.eligible(task,tracked,at)
  },at).map(task=>task.id);
  const unindexedReads=reads;
  reads=0;
  const newSelection=ranking.topFive(tasks,tracked,engine,at).map(task=>task.id);
  const indexedReads=reads;
  assert.deepEqual(newSelection,oldSelection,"last matching event and ranking semantics remain identical");
  assert.ok(indexedReads<5000,"one history pass plus bounded per-task lookups");
  assert.ok(unindexedReads>indexedReads*20,"remove repeated full-history scans");
  console.log("Synthetic Home event-detail reads: unindexed="+unindexedReads+" indexed="+indexedReads);
});

test("Home navigation does not redundantly rebuild the entire task DOM",()=>{
  const daily=read("assets/daily-ops.js");
  assert.match(daily,/if\(e\.detail\.view==='home'&&!state\.editing\)\{if\(state\.busy\|\|state\.loading\)renderHome\(\);else if\(!canReuseHomeOnReturn\(\)\)refreshCurrent\(\);\}/);
  assert.doesNotMatch(daily,/refreshCurrent\(\);renderHome\(\);/);
  assert.match(daily,/top \|\|= attentionTopThree\(\)/);
});
