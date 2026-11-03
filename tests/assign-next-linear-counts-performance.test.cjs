"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {performance}=require("node:perf_hooks");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const begin=app.indexOf("  function assignNextRows(");
const finish=app.indexOf("  function renderAssignNext()",begin);
assert.ok(begin>=0&&finish>begin,"actual production Assign Next selector exists");
const shipped=app.slice(begin,finish);
const legacy="  function assignNextRows(today=storeDateKey(), snapshotOverride=undefined) {\n    const day=ensureAssignDay(today),snapshot=snapshotOverride===undefined?activeWorkloadSnapshot(today):snapshotOverride,records=snapshot?.records||[],openedVerified=openedTodayVerified(snapshot,today),snapshotDates=Object.keys(model.performance.snapshots||{}).sort(),latest=snapshotDates.length?model.performance.snapshots[snapshotDates.at(-1)]:null,grossRank=(value)=>Number.isFinite(value)?value:Number.POSITIVE_INFINITY;\n    return Object.entries(ASSIGN_NEXT_ADVISORS).map(([code,name])=>{\n      const saved=day.advisors[code]||{code,name,available:true},current=records.filter((record)=>record.isOpen&&record.advisorCode===code),open=snapshot?current.length:null,openedToday=openedVerified?current.filter((record)=>record.openedDate===today).length:null,totalGross=latest?.advisors?.[code]?.totalGross;\n      return{...saved,code,name,open,openedToday,automatic:Boolean(snapshot),openedTodayVerified:openedVerified,workload:open,totalGross:Number.isFinite(totalGross)?totalGross:null};\n    }).sort((a,b)=>Number(b.available)-Number(a.available)||(snapshot?a.open-b.open:0)||(openedVerified?a.openedToday-b.openedToday:0)||grossRank(a.totalGross)-grossRank(b.totalGross)||a.code.localeCompare(b.code,undefined,{numeric:true}));\n  }\n";
const advisors={"1001":"Synthetic A","1002":"Synthetic B","1003":"Synthetic C","1004":"Synthetic D","1005":"Synthetic E","1006":"Synthetic F"};
const DAY="2026-11-02";

function harness(selector,rows,options={}){
  let filters=0;
  const records=new Proxy(rows,{get(target,key,receiver){
    if(key==="filter")return callback=>{filters++;return Array.prototype.filter.call(target,callback);};
    return Reflect.get(target,key,receiver);
  }});
  const day={date:DAY,advisors:{
    "1001":{available:false},"1004":{available:true}
  }};
  const snapshot=options.disconnected?null:{records};
  const model={performance:{snapshots:{
    "2026-10-31":{advisors:{"1001":{totalGross:8000},"1002":{totalGross:7500}}}
  }}};
  const ctx=vm.createContext({model,ASSIGN_NEXT_ADVISORS:advisors,storeDateKey:()=>DAY,
    ensureAssignDay:()=>day,activeWorkloadSnapshot:()=>snapshot,
    openedTodayVerified:active=>Boolean(active)&&!options.unverifiedOpened,Map,Number,Object,String});
  vm.runInContext(selector+"\nthis.select=assignNextRows;",ctx);
  return {select:(date=DAY)=>ctx.select(date,snapshot),
    filters:()=>filters,reset:()=>{filters=0;},model,records,day};
}
function rows(count){
  return Array.from({length:count},(_,i)=>({
    ro:"SYN-"+i,advisorCode:i%31===0?1001:i%29===0?"9999":String(1001+i%6),
    isOpen:i%8!==0,openedDate:i%5===0?DAY:"2026-10-31"
  }));
}
const serialize=rows=>JSON.stringify(rows);
function pct(values,q){const ordered=[...values].sort((a,b)=>a-b);return ordered[Math.ceil(ordered.length*q)-1];}
function paired(oldRun,newRun,iterations=24){
  const before=[],after=[];
  for(let i=0;i<3;i++){oldRun();newRun();}
  for(let i=0;i<iterations;i++){
    const batch=i%2?[[newRun,after],[oldRun,before]]:[[oldRun,before],[newRun,after]];
    for(const [run,list] of batch){const t=performance.now();run();list.push(performance.now()-t);}
  }
  return {before:{p50Ms:+pct(before,.5).toFixed(3),p95Ms:+pct(before,.95).toFixed(3)},
    after:{p50Ms:+pct(after,.5).toFixed(3),p95Ms:+pct(after,.95).toFixed(3)}};
}

test("58-04: one roster scan preserves every advisor count, eligibility and ordering",()=>{
  assert.match(shipped,/const counts=new Map\(\)/,"production selector computes a per-call roster aggregate");
  for(const size of [0,1,6,2100,15000]){
    for(const unverifiedOpened of [false,true]){
      const data=rows(size),sourceBefore=serialize(data);
      const old=harness(legacy,data,{unverifiedOpened});
      const current=harness(shipped,data,{unverifiedOpened});
      const prior=old.select(),next=current.select();
      assert.equal(serialize(next),serialize(prior),"same output for "+size+" records, opened verified="+!unverifiedOpened);
      assert.equal(old.filters(),Object.keys(advisors).length,"old selector rescans all ROs per advisor");
      assert.equal(current.filters(),0,"new selector does not refilter source roster");
      assert.equal(serialize(data),sourceBefore,"selector cannot alter source records");
      data[0]&&(data[0].advisorCode="1001",data[0].isOpen=true,data[0].openedDate=DAY);
      assert.equal(serialize(current.select()),serialize(old.select()),"edits invalidate counts on next call");
      assert.equal(serialize(current.select("2026-11-03")),serialize(old.select("2026-11-03")),
        "date rollover recomputes open-today counts without stale cache");
    }
  }
  const emptyOld=harness(legacy,rows(0),{disconnected:true});
  const emptyNow=harness(shipped,rows(0),{disconnected:true});
  assert.equal(serialize(emptyNow.select()),serialize(emptyOld.select()),"no snapshot means unknown, not zero");
  assert.ok(emptyNow.select().every(row=>row.open===null&&row.openedToday===null),
    "a missing workload must never be represented as verified zero");
});

test("58-04: paired synthetic Assign Next scan benchmark records p50/p95 on shipped selector",()=>{
  for(const count of [2100,15000]){
    const data=rows(count),before=harness(legacy,data),after=harness(shipped,data);
    assert.equal(serialize(after.select()),serialize(before.select()));
    const result=paired(()=>before.select(),()=>after.select());
    console.log("58-04 Assign Next per-advisor scans vs single roster pass",JSON.stringify({
      dataset:"synthetic-"+count+"-open-ro-records",advisorCount:Object.keys(advisors).length,
      samplesPerPath:24, ...result,
      differenceP50Ms:+(result.before.p50Ms-result.after.p50Ms).toFixed(3),
      differenceP95Ms:+(result.before.p95Ms-result.after.p95Ms).toFixed(3),
      scope:"real production selector in Node VM; synthetic records; excludes browser layout, filesystem and OneDrive"
    }));
    assert.ok(Number.isFinite(result.after.p50Ms)&&Number.isFinite(result.after.p95Ms));
    assert.equal(serialize(after.select()),serialize(before.select()));
  }
});
