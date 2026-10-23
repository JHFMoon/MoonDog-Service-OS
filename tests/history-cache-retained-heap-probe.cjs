"use strict";
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
if(typeof global.gc!=="function")throw new Error("Probe must run with --expose-gc");
const daily=fs.readFileSync(path.join(__dirname,"..","assets","daily-ops.js"),"utf8");
const start=daily.indexOf("  const historyFileCache=new Map();");
const end=daily.indexOf("  async function log(",start);
if(start<0||end<=start)throw new Error("Production history loader was not found");
const history=daily.slice(start,end);
const files=[];let fileReads=0;
for(let i=0;i<2104;i++){
  const isDaily=i<204,name=(isDaily?"daily-":"event-")+i+".json";
  const event={id:name,at:"2026-10-12T12:00:00Z",type:isDaily?"daily-task":"history",action:"synthetic-completed",taskId:"synthetic-task-"+i,taskType:isDaily?"ro":"history",advisor:"123",recordId:"synthetic-record-"+i,day:"2026-10-12",hour:12,rank:i%20,fingerprint:"synthetic-"+String(i).padStart(8,"0")+"-".repeat(220)};
  const payload=JSON.stringify(event);
  files.push({name,handle:{getFile:async()=>({text:async()=>{fileReads++;return payload;}})}});
}
const state={history:[],events:[],searchToken:1};
const context=vm.createContext({api:{readEntries:async()=>files},state,model:{root:{}},Promise,setTimeout,JSON});
vm.runInContext(history+"\nthis.loadHistory=loadHistory;this.cacheSize=()=>historyFileCache.size;this.sameSnapshot=()=>state.history===fullHistoryCache;",context);
(async()=>{
  if(!await context.loadHistory(true,1))throw new Error("Initial full-history load was cancelled");
  global.gc();const baseline=process.memoryUsage().heapUsed,heapSamples=[baseline];
  for(let i=0;i<500;i++){
    if(!await context.loadHistory(true,1))throw new Error("Warm history search was cancelled");
    if((i+1)%25===0){global.gc();heapSamples.push(process.memoryUsage().heapUsed);}
  }
  global.gc();const retained=process.memoryUsage().heapUsed;heapSamples.push(retained);
  const growth=heapSamples.slice(1).map(value=>value-baseline);
  process.stdout.write(JSON.stringify({syntheticFiles:files.length,warmSearches:500,fileReads,cacheSize:context.cacheSize(),snapshotReused:context.sameSnapshot(),heapSamples,retainedHeapDeltaBytes:retained-baseline,maxRetainedGrowthBytes:Math.max(...growth)}));
})().catch(error=>{console.error(error);process.exitCode=1;});

