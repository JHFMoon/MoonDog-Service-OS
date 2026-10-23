"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const {performance}=require("node:perf_hooks");
const maintenance=require("../assets/maintenance.js");

// All files are in a disposable in-memory representation. This executes the
// production maintenance.create(...).run(...) and its real retention engine,
// not a transcription of the cleanup algorithm or a connected Workspace.
const DAY=86400000,now=Date.parse("2026-10-19T12:00:00Z");
const encoder=new TextEncoder(),decoder=new TextDecoder();
const enc=value=>encoder.encode(JSON.stringify(value));
const sha=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
function fixture({corruptCurrent=false,contended=false}={}){
  const files=new Map(),removed=[],finished=[],events=[],readCounts=new Map();
  function put(path,bytes,daysAgo){
    files.set(path,{bytes:new Uint8Array(bytes),modified:now-daysAgo*DAY});
  }
  // 76 distinct full backups (one day apart) stress the actual deep inventory.
  for(let i=0;i<76;i++){
    put("backups/MoonDog Full Backup - synthetic-"+String(i).padStart(3,"0")+".zip",
      enc({manifest:{createdAt:new Date(now-(i+1)*DAY).toISOString()},index:i}),i+1);
  }
  const invalid="backups/MoonDog Full Backup - malformed-old.zip";
  put(invalid,encoder.encode("not a valid synthetic backup"),90);
  // Two verified restore-point directories plus one interrupted and one
  // structurally invalid directory. Incomplete and damaged entries are pinned.
  function updateDir(suffix,status,days,valid=true){
    const root="backups/system-updates/MoonDog-Update-Backup-2026-08-01T00-00-00-000Z-00000000-0000-0000-0000-"+suffix;
    const payload=encoder.encode("synthetic JS backup "+suffix);
    put(root+"/assets/app.js",payload,days);
    const journal=valid?{
      status,inventory:[{path:"assets/app.js",existed:true,sha256:sha(payload)}]
    }:{status,inventory:[{path:"assets/app.js",existed:true,sha256:"wrong"}]};
    put(root+"/journal.json",enc(journal),days);
    return root;
  }
  const resolvedA=updateDir("000000000001","verified",47),
    resolvedB=updateDir("000000000002","restored",47),
    pending=updateDir("000000000003","applying",47),
    damaged=updateDir("000000000004","verified",47,false);
  let injected=false;
  const io={
    async list(prefix,deep){
      const selected=[...files.keys()].filter(p=>prefix?
        p.startsWith(prefix+"/")&&(deep||!p.slice(prefix.length+1).includes("/")):
        !p.includes("/"));
      return selected;
    },
    async stat(path){
      const item=files.get(path);if(!item)throw Object.assign(Error("missing"),{name:"NotFoundError"});
      return{size:item.bytes.length,modified:item.modified};
    },
    async read(path){
      let item=files.get(path);if(!item)throw Object.assign(Error("missing"),{name:"NotFoundError"});
      const n=readCounts.get(path)||0;readCounts.set(path,n+1);
      if(contended&&!injected&&path.includes("synthetic-040.zip")&&n>=2){
        injected=true;
        files.set(path,{bytes:encoder.encode("externally modified"),modified:item.modified+20});
        item=files.get(path);
      }
      return new Uint8Array(item.bytes);
    },
    hash:async bytes=>sha(bytes),
    remove:async path=>{removed.push(path);files.delete(path);},
    exists:async path=>files.has(path),
    removeTree:async path=>{
      for(const key of [...files.keys()])if(key.startsWith(path+"/")){files.delete(key);removed.push(key);}
    }
  };
  const recovery={housekeeping:{}};
  const api={
    now:()=>now,day:()=>"2026-10-19",recovery:()=>recovery,
    busy:()=>false,references:()=>[],ensureFolders:async()=>{},
    validateCurrent:async()=>{if(corruptCurrent)throw Error("synthetic current Workspace validation failed");return true;},
    validateBackup:async bytes=>{
      const doc=JSON.parse(decoder.decode(bytes));
      if(!doc?.manifest?.createdAt)throw Error("Invalid test backup");
      return doc;
    },
    createRetentionBackup:async()=>null,
    currentWorkbook:()=>"exports/current.xlsx",
    validateWorkbook:async()=>false,
    checkpoint:async data=>{events.push(...data);},
    finish:async data=>{recovery.housekeeping=data;finished.push(data);},
    diagnostic:async()=>{},changed:()=>{}
  };
  const engine=maintenance.create(io,api);
  return{files,removed,finished,events,readCounts,engine,invalid,
    resolvedA,resolvedB,pending,damaged,api};
}
function percentile(sorted,q){return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(q*sorted.length)-1))];}
test("76+ validated full backups remain bounded, and incomplete update journals are protected",async()=>{
  const f=fixture(),originalCount=f.files.size;
  const start=performance.now(),r=await f.engine.run({force:true,reason:"synthetic large inventory"}),duration=performance.now()-start;
  assert.equal(r.failed,undefined,"deep inspection must complete without a hidden failure");
  assert.equal(r.deep,true);
  assert.ok(r.filesRemoved>0,"obsolete verified recovery points can be retired");
  assert.ok(f.files.has(f.invalid),"malformed backup is kept for review");
  assert.ok([...f.files.keys()].some(p=>p.startsWith(f.pending+"/")),"interrupted update journal is protected");
  assert.ok([...f.files.keys()].some(p=>p.startsWith(f.damaged+"/")),"damaged update journal is protected");
  assert.ok(f.finished.at(-1).issues.some(x=>x.path===f.pending),"unresolved update surfaced as actionable warning");
  assert.ok(f.finished.at(-1).issues.some(x=>x.path===f.damaged),"damaged update surfaced as actionable warning");
  assert.ok(f.files.size<originalCount,"safe retention reduces inventory size");
  assert.ok(duration<30000,"synthetic 80+ item scan should not hang CI");
});
test("completed update directories may retire; applying and invalid directories never do",async()=>{
  const f=fixture();
  const r=await f.engine.run({force:true});
  assert.equal(r.failed,undefined);
  for(const dir of [f.resolvedA,f.resolvedB])
    assert.equal([...f.files.keys()].some(p=>p.startsWith(dir+"/")),false,"verified old rollback may be retired");
  for(const dir of [f.pending,f.damaged])
    assert.equal([...f.files.keys()].some(p=>p.startsWith(dir+"/")),true,"unresolved rollback is pinned");
  assert.equal(f.finished.at(-1).lastHousekeepingStatus,"Needs attention","manager sees retained risks");
});
test("source file changed mid-cleanup is not deleted as if it were verified",async()=>{
  const f=fixture({contended:true});
  await f.engine.run({force:true});
  const key="backups/MoonDog Full Backup - synthetic-040.zip";
  assert.equal(f.files.has(key),true,"externally changed backup retained");
  assert.equal(f.removed.includes(key),false,"unverified bytes must never be removed");
});
test("actual maintenance engine never prunes verified full backups when current Workspace validation fails",async()=>{
  const f=fixture({corruptCurrent:true});
  const fullBefore=[...f.files.keys()].filter(p=>p.startsWith("backups/MoonDog Full Backup -")).sort();
  const run=await f.engine.run({force:true});
  assert.equal(run.failed,undefined,"validation failure is handled explicitly, not a hidden scan crash");
  assert.ok(run.issues.some(x=>x.path==="data"&&x.reason.includes("validation failed")),"manager is alerted to unverified current state");
  assert.deepEqual([...f.files.keys()].filter(p=>p.startsWith("backups/MoonDog Full Backup -")).sort(),
    fullBefore,"retention must not remove any full backup without current-state validation");
  assert.equal(f.removed.some(p=>p.startsWith("backups/MoonDog Full Backup -")),false);
});
test("repeated large inventory runs report measured synthetic p50/p95, without real field claims",async()=>{
  const durations=[];
  for(let i=0;i<5;i++){
    const f=fixture();const start=performance.now();
    const run=await f.engine.run({force:true});assert.equal(run.failed,undefined);
    durations.push(performance.now()-start);
  }
  const sorted=durations.sort((a,b)=>a-b),p50=percentile(sorted,0.50),p95=percentile(sorted,0.95);
  assert.ok(Number.isFinite(p50)&&Number.isFinite(p95)&&p50<=p95);
  assert.ok(p95<30000,"bounded synthetic-only measurement, not a Windows performance guarantee");
  console.log("SYNTHETIC 80+ backup deep scan p50="+p50.toFixed(1)+"ms p95="+p95.toFixed(1)+"ms; no Windows field evidence");
});

test("overlapping maintenance runs coalesce and release the single-flight guard",async()=>{
  const f=fixture();
  let signalEntered,releaseRun;
  const entered=new Promise(resolve=>{signalEntered=resolve;});
  const gate=new Promise(resolve=>{releaseRun=resolve;});
  let ensureCalls=0;
  f.api.ensureFolders=async()=>{
    ensureCalls++;
    signalEntered();
    await gate;
  };
  const first=f.engine.run({force:true,reason:"synthetic concurrent maintenance"});
  const second=f.engine.run({force:true,reason:"synthetic overlapping maintenance"});
  await entered.promise;
  assert.equal(f.engine.running,true,"the first maintenance pass owns the single-flight guard");
  assert.equal(ensureCalls,1,"the overlapping pass must reuse the existing run");
  releaseRun();
  const [a,b]=await Promise.all([first,second]);
  assert.strictEqual(a,b,"overlapping callers must receive the same active result");
  assert.equal(a.failed,undefined);
  assert.equal(b.failed,undefined);
  assert.equal(ensureCalls,1,"coalesced callers must not start a second inventory");
  assert.equal(f.finished.length,1,"one shared run persists housekeeping state once");
  assert.equal(f.engine.running,false,"the single-flight guard releases after completion");
});
