"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const daily=fs.readFileSync(path.join(__dirname,"..","assets","daily-ops.js"),"utf8");
function extract(source,begin,end){const a=source.indexOf(begin),b=source.indexOf(end,a+begin.length);assert.ok(a>=0&&b>a);return source.slice(a,b);}
const history=extract(daily,"  const historyFileCache=new Map();","  async function log(");
const followup=extract(app,"  async function runVerifiedUpdateFollowup()","  const folderWatch=");
const mobile=extract(daily,"  async function publishToHandle(","  async function connectPublisher(");
test("daily startup reads only daily-task history, with complete history on demand",async(t)=>{
 const reads={daily:0,other:0},files=[];let directoryEnumerations=0;
 for(let i=0;i<2104;i++){
  const isDaily=i<204,kind=isDaily?"daily":"other",name=(isDaily?"daily-":"event-")+i+".json";
  files.push({name,handle:{getFile:async()=>({text:async()=>{reads[kind]++;return JSON.stringify({id:name,at:"2026-10-12",type:isDaily?"daily-task":"history"});}})}});
 }
 const state={history:[],events:[],searchToken:1},context=vm.createContext({api:{readEntries:async()=>{directoryEnumerations++;return files;}},state,model:{root:{}},Promise,setTimeout,JSON});
 vm.runInContext(history+"\nthis.loadHistory=loadHistory;this.historyCacheSize=()=>historyFileCache.size;this.historyCachePayloadChars=()=>[...historyFileCache.values()].reduce((sum,event)=>sum+JSON.stringify(event).length,0);this.hasFullHistorySnapshot=()=>fullHistoryCache!==null",context);
 await context.loadHistory();
 assert.equal(reads.daily,204);assert.equal(reads.other,0);assert.equal(state.events.length,204);
 const coldStarted=performance.now();
 await context.loadHistory(true,1);
 const coldFullMs=performance.now()-coldStarted;
 assert.equal(state.history.length,2104);assert.equal(reads.other,1900);assert.equal(state.events.length,204);
 const warmFullSearchMs=[],beforeWarmEnumerations=directoryEnumerations;
 for(let sample=0;sample<7;sample++){
  const started=performance.now();
  assert.equal(await context.loadHistory(true,1),true);
  warmFullSearchMs.push(performance.now()-started);
 }
 assert.equal(reads.daily+reads.other,2104,"warm full-history searches must reuse parsed file payloads");
 assert.equal(context.historyCacheSize(),2104);
 assert.equal(state.history.length,2104);
 const warmDirectoryEnumerations=directoryEnumerations-beforeWarmEnumerations;
 assert.equal(warmDirectoryEnumerations,7,"each warm search must confirm the current directory inventory");
 const sorted=warmFullSearchMs.slice().sort((a,b)=>a-b),quantile=p=>sorted[Math.ceil(p*sorted.length)-1];
 assert.ok(Number.isFinite(coldFullMs)&&coldFullMs>=0);
 assert.ok(warmFullSearchMs.every(value=>Number.isFinite(value)&&value>=0));
 const warm={p50:+quantile(.5).toFixed(3),p95:+quantile(.95).toFixed(3)};
 assert.ok(warm.p95<250,`warm full-history search p95 should remain below 250 ms; observed ${warm.p95} ms`);
 t.diagnostic(JSON.stringify({syntheticHistoryFiles:2104,startupFileReads:204,coldFullFileReads:1900,coldFullLoadMs:+coldFullMs.toFixed(3),warmSearchRuns:warmFullSearchMs.length,warmDirectoryEnumerations,warmSearchMs:warm,cachedFiles:context.historyCacheSize(),cachedPayloadChars:context.historyCachePayloadChars()}));
 const lateName="event-late.json";
 files.push({name:lateName,handle:{getFile:async()=>({text:async()=>{reads.other++;return JSON.stringify({id:lateName,at:"2026-10-13",type:"history"});}})}});
 assert.equal(await context.loadHistory(true,1),true,"new history files must invalidate the materialized search cache");
 assert.equal(reads.other,1901);assert.equal(context.historyCacheSize(),2105);assert.equal(state.history.length,2105);
 files.splice(files.findIndex(file=>file.name===lateName),1);
 assert.equal(await context.loadHistory(true,1),true,"removed history files must invalidate the materialized search cache");
 assert.equal(state.history.length,2104);assert.equal(state.history.some(event=>event.id===lateName),false);
});
test("full-history snapshot stays inside the existing 4,000-file cache bound",async()=>{
 const files=[];
 for(let i=0;i<4001;i++){
  const name="event-"+i+".json";
  files.push({name,handle:{getFile:async()=>({text:async()=>JSON.stringify({id:name,at:"2026-10-12",type:"history"})})}});
 }
 const state={history:[],events:[],searchToken:1},context=vm.createContext({api:{readEntries:async()=>files},state,model:{root:{}},Promise,setTimeout,JSON});
 vm.runInContext(history+"\nthis.loadHistory=loadHistory;this.historyCacheSize=()=>historyFileCache.size;this.hasFullHistorySnapshot=()=>fullHistoryCache!==null",context);
 assert.equal(await context.loadHistory(true,1),true);
 assert.equal(state.history.length,4001);
 assert.equal(context.historyCacheSize(),4000);
 assert.equal(context.hasFullHistorySnapshot(),false,"oversized history must not be pinned by the materialized cache");
});
test("stale historical search cannot overwrite newer history",async()=>{
 let release;const waiting=new Promise(resolve=>release=resolve),state={history:[{id:"newer"}],events:[],searchToken:4};
 const context=vm.createContext({api:{readEntries:async()=>[{name:"daily-1.json",handle:{getFile:async()=>({text:async()=>waiting})}}]},state,model:{root:{}},Promise,setTimeout});
 vm.runInContext(history+"\nthis.loadHistory=loadHistory",context);
 const old=context.loadHistory(true,4);state.searchToken=5;release('{"id":"older","type":"daily-task"}');
 assert.equal(await old,false);assert.equal(state.history[0].id,"newer");
});
test("unmodified recognition rules do not reparse learned files after an update",async()=>{
 let scanned=0,removed=0,written=0;
 const model={root:{},applicationRoot:{},autoImport:{}};
 const context=vm.createContext({model,writeAuthority:{canWrite:true},VERSION:"beta",LEARNED_PARSER_REVISION:"rule-1",
  AUTO_IMPORT_PATH:["data","auto-import.json"],localStorage:{getItem:()=>JSON.stringify({version:"beta"}),removeItem:()=>removed++},
  auditInstalledRuntimeLayout:async()=>({needsReview:false,scanned:35}),
  reconcileLearnedFiles:async()=>{scanned++;return {attempts:135}},
  writeJson:async()=>written++,recordDiagnostic:()=>{}});
 vm.runInContext(followup+"\nthis.runFollowup=runVerifiedUpdateFollowup",context);
 await context.runFollowup();
 assert.equal(scanned,0);assert.equal(removed,1);assert.equal(written,1);
 assert.equal(model.autoImport.learnedParserRevision,"rule-1");
 model.autoImport.learnedParserRevision="prior-rule";removed=0;
 await context.runFollowup();
 assert.equal(scanned,1);assert.equal(removed,1);
});
test("mobile output skips byte-identical writes but verifies changed output",async()=>{
 let text="unchanged",writes=0;
 const handle={getFile:async()=>({arrayBuffer:async()=>new TextEncoder().encode(text).buffer}),
  createWritable:async()=>({write:async bytes=>{writes++;text=new TextDecoder().decode(bytes)},close:async()=>{}})};
 const context=vm.createContext({permission:async()=>"granted",MOBILE_FILENAME:"MoonDog-Mobile.html",TextEncoder,Uint8Array});
 vm.runInContext(mobile+"\nthis.publish=publishToHandle",context);
 const first=await context.publish({getFileHandle:async()=>handle,name:"Synthetic"},"unchanged");
 assert.equal(first.status,"published");assert.equal(first.unchanged,true);assert.equal(writes,0);
 const second=await context.publish({getFileHandle:async()=>handle,name:"Synthetic"},"changed");
 assert.equal(second.status,"published");assert.equal(writes,1);assert.equal(text,"changed");
});
test("cache reuse respects business-day and close-hour boundaries",()=>{
 assert.match(app,/meetingRenderedDate=localDateKey\(\)/);
 assert.match(app,/meetingRenderedDate!==localDateKey\(\)/);
 assert.match(app,/performanceRenderedClock=reportClockToken\(\)/);
 assert.match(app,/performanceRenderedClock!==reportClockToken\(\)/);
 assert.match(app,/hour>=18\?"closed":"open"/);
});
test("watcher and mobile maintenance avoid redundant idle writes",()=>{
 assert.match(app,/if\(!document\.hidden\)void folderWatchScan\("poll"\)/);
 assert.doesNotMatch(daily,/setInterval\(\(\)=>queueMobilePublish\(1000\),300000\)/);
 assert.match(daily,/queueMobilePublish\(1000\);\s*if\(state\.editing\)/);
});
test("diagnostics batch events and never move queued entries to another workspace",async()=>{
 const code=extract(app,"  let diagnosticsQueue = Promise.resolve(),diagnosticTimer=null;","  async function writeJson(");
 let body="",writes=0;const root={name:"Synthetic"},model={root};
 const context=vm.createContext({model,writeAuthority:{canWrite:true},now:()=>new Date().toISOString(),
  Date,Promise,setTimeout,clearTimeout,TextEncoder,
  document:{addEventListener:()=>{}},
  fileAt:async()=>({getFile:async()=>({text:async()=>body})}),
  writeBytes:async(_path,bytes)=>{writes++;body=new TextDecoder().decode(bytes);}
 });
 vm.runInContext(code+"\nthis.recordDiagnostic=recordDiagnostic;this.flushDiagnostics=flushDiagnostics",context);
 for(let i=0;i<50;i++)context.recordDiagnostic("EVENT","Detail "+i);
 await context.flushDiagnostics();
 assert.ok(writes<=3);assert.ok(body.includes("Detail 0")&&body.includes("Detail 49"));
 const before=writes;context.recordDiagnostic("EVENT","Prior workspace");
 model.root={name:"Other workspace"};
 await context.flushDiagnostics();
 assert.equal(writes,before);
});
