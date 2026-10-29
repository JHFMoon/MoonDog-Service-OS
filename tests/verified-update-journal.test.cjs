"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function helper(name,nextName){
  const start=app.indexOf(`  async function ${name}(`);
  const end=app.indexOf(`\n  async function ${nextName}(`,start);
  assert.ok(start>=0&&end>start,`${name} exists in production source`);
  return vm.runInNewContext("("+app.slice(start,end).trim()+")",{Date,JSON,Number,RegExp});
}
const findReceipt=helper("findVerifiedUpdateFollowup","markVerifiedUpdateFollowupComplete");
const markComplete=vm.runInNewContext("("+app.slice(
  app.indexOf("  async function markVerifiedUpdateFollowupComplete("),
  app.indexOf("\n  async function auditInstalledRuntimeLayout(",app.indexOf("  async function markVerifiedUpdateFollowupComplete("))
).trim()+")",{Date,JSON});
const missing=()=>Object.assign(new Error("Not found"),{name:"NotFoundError"});
const version="0.10.18-beta.93";
const proof={version,channel:"beta",sha256:"a".repeat(64),verifiedAt:"2025-01-01T00:00:00.000Z"};
function fixture({journal={status:"verified",inventory:[],verifiedUpdate:proof},listed=["MoonDog-Update-Backup-2025-01-01T00-00-00-000Z-id"],journalsByName={},rawContentsByName={},readErrorsByName={}}={}){
  const initialByName=Object.fromEntries(listed.map((name,index)=>[
    name,Object.hasOwn(rawContentsByName,name)?rawContentsByName[name]:JSON.stringify(Object.hasOwn(journalsByName,name)?journalsByName[name]:index===0?journal:null)
  ]));
  const contents=new Map(Object.entries(initialByName)),writeCounts=new Map();
  const files=new Map(),directories=new Map();
  function fileFor(name){
    if(!files.has(name))files.set(name,{
      getFile:async()=>{const error=readErrorsByName[name];if(error)throw error;return{text:async()=>contents.get(name)};},
      createWritable:async()=>{let pending;return{
        write:async value=>{pending=value;},
        close:async()=>{contents.set(name,pending);writeCounts.set(name,(writeCounts.get(name)||0)+1);},
        abort:async()=>{}
      };}
    });
    return files.get(name);
  }
  function directoryFor(name){
    if(!directories.has(name))directories.set(name,{getFileHandle:async fileName=>{
      if(fileName!=="journal.json"||!contents.has(name))throw missing();
      return fileFor(name);
    }});
    return directories.get(name);
  }
  const backup={
    entries:async function*(){for(const name of listed)yield[name,{kind:"directory"}];},
    getDirectoryHandle:async name=>{if(!listed.includes(name))throw missing();return directoryFor(name);}
  };
  const levels={
    "System Files":{getDirectoryHandle:async name=>name==="Workspace"?levels.Workspace:Promise.reject(missing())},
    Workspace:{getDirectoryHandle:async name=>name==="backups"?levels.backups:Promise.reject(missing())},
    backups:{getDirectoryHandle:async name=>name==="system-updates"?backup:Promise.reject(missing())}
  };
  const root={getDirectoryHandle:async name=>levels[name]||Promise.reject(missing())};
  const first=listed[0];
  return {root,backup,get directory(){return directoryFor(first);},get file(){return fileFor(first);},
    get content(){return contents.get(first);},get writes(){return [...writeCounts.values()].reduce((sum,count)=>sum+count,0);},contents};
}

test("bootstrap accepts only a latest exact-version verified install journal",async()=>{
  const current=fixture();
  const receipt=await findReceipt(current.root,version);
  assert.equal(receipt.version,version);
  assert.equal(receipt.directory,current.directory);
  assert.equal(await findReceipt(current.root,"0.10.18-beta.94"),null);
  const completed=fixture({journal:{...JSON.parse(current.content),followup:{version,status:"complete"}}});
  assert.equal((await findReceipt(completed.root,version)).completed,true);
});

test("manual, rolled-back, malformed, and incomplete journal states are not receipts",async()=>{
  for(const journal of [
    {status:"verified",verifiedUpdate:{...proof,version:"0.10.18-beta.92"}},
    {status:"restored",verifiedUpdate:proof},
    {status:"verified",verifiedUpdate:{...proof,sha256:"bad"}},
    {status:"verified",verifiedUpdate:{...proof,verifiedAt:"invalid"}}
  ])assert.equal(await findReceipt(fixture({journal}).root,version),null);
  const malformed=fixture({journal:{status:"applying",inventory:[]}});
  assert.equal(await findReceipt(malformed.root,version),null);
  const noBackup=fixture({listed:[]});
  assert.equal(await findReceipt(noBackup.root,version),null);
});

test("an older current-version receipt is found behind a newer malformed or unrelated backup",async()=>{
  const newest="MoonDog-Update-Backup-2025-02-01T00-00-00-000Z-newer";
  const older="MoonDog-Update-Backup-2025-01-01T00-00-00-000Z-older";
  const current={status:"verified",inventory:[],verifiedUpdate:proof};
  for(const newer of [
    {rawContentsByName:{[newest]:"{ malformed journal"},journalsByName:{}},
    {journalsByName:{[newest]:{status:"verified",inventory:[],verifiedUpdate:{...proof,version:"0.10.18-beta.94"}}}}
  ]){
    const state=fixture({listed:[older,newest],journalsByName:{[older]:current,...newer.journalsByName},rawContentsByName:newer.rawContentsByName});
    const receipt=await findReceipt(state.root,version);
    assert.equal(receipt.version,version);
    assert.equal(receipt.directory,await state.backup.getDirectoryHandle(older));
  }
});

test("an unreadable newer backup fails closed instead of skipping a possible receipt",async()=>{
  const newest="MoonDog-Update-Backup-2025-02-01T00-00-00-000Z-newer";
  const older="MoonDog-Update-Backup-2025-01-01T00-00-00-000Z-older";
  const state=fixture({listed:[older,newest],journalsByName:{[older]:{status:"verified",inventory:[],verifiedUpdate:proof}},
    readErrorsByName:{[newest]:Object.assign(new Error("synthetic read lock"),{name:"NotReadableError"})}});
  await assert.rejects(findReceipt(state.root,version),/synthetic read lock/);
});

test("consuming a journal receipt writes and verifies its exact-once marker",async()=>{
  const current=fixture();
  const receipt=await findReceipt(current.root,version);
  await markComplete(receipt);
  const journal=JSON.parse(current.content);
  assert.equal(journal.followup.version,version);
  assert.equal(journal.followup.status,"complete");
  assert.ok(Number.isFinite(Date.parse(journal.followup.completedAt)));
  assert.equal(current.writes,1);
  assert.equal((await findReceipt(current.root,version)).completed,true);
});

test("follow-up is gated by either receipt source and consumes durable evidence",()=>{
  const start=app.indexOf("  async function runVerifiedUpdateFollowup()");
  const end=app.indexOf("\n  const folderWatch=",start);
  const followup=app.slice(start,end);
  assert.match(followup,/findVerifiedUpdateFollowup\(model\.applicationRoot\)/);
  assert.match(followup,/receipt\?\.version!==VERSION&&!durableReceipt/);
  assert.match(followup,/markVerifiedUpdateFollowupComplete\(followupReceipt\)/);
  assert.match(followup,/durableReceipt\?\.completed/);
  assert.match(followup,/result\?\.deferred\|\|result\?\.failures/);
});

test("legacy durable import state triggers layout-audited parser retry without an updater receipt",async()=>{
  const sourceStart=app.indexOf("  async function runVerifiedUpdateFollowup()");
  const sourceEnd=app.indexOf("\n  const folderWatch=",sourceStart);
  assert.ok(sourceStart>=0&&sourceEnd>sourceStart,"production update follow-up exists");
  const calls=[];
  const context={
    VERSION:"0.10.18-beta.99",LEARNED_PARSER_REVISION:"parser-v2",AUTO_IMPORT_PATH:"data/auto-import.json",
    model:{root:{},applicationRoot:{},autoImport:{seen:{"old-success":{"kind":"sor","importedAt":"2025-01-01T00:00:00.000Z"}}}},
    writeAuthority:{canWrite:true},
    localStorage:{getItem:()=>{throw new Error("storage unavailable");},removeItem:()=>{throw new Error("storage unavailable");}},
    findVerifiedUpdateFollowup:async()=>null,
    auditInstalledRuntimeLayout:async()=>({needsReview:false,scanned:4,compatibilityIndexPresent:true,misplacedReports:0,unexpectedRuntime:0}),
    reconcileLearnedFiles:async revision=>{calls.push(["reconcile",revision]);return{deferred:false,failures:0,attempts:1,recovered:1,unsupported:0,skipped:0};},
    writeJson:async(path,value)=>calls.push(["write",path,value.learnedParserRevision]),
    recordDiagnostic:(...args)=>calls.push(["diagnostic",...args]),
    Date,String
  };
  vm.runInNewContext(app.slice(sourceStart,sourceEnd)+"\nthis.runFollowup=runVerifiedUpdateFollowup;",context);
  await context.runFollowup();
  assert.ok(calls.some(call=>call[0]==="reconcile"&&call[1]==="parser-v2"),
    "legacy import ledger must permit safe parser retry when no browser or journal receipt exists");
  assert.ok(calls.some(call=>call[0]==="write"&&call[2]==="parser-v2"),
    "successful retry persists the new parser revision for exactly-once recovery");
  assert.equal(calls.filter(call=>call[0]==="diagnostic"&&/Follow-up deferred/.test(call[2]||"")).length,0,
    "unavailable browser storage must not turn a durable successful retry into a reported failure");
});
