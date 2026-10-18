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
function fixture({journal={status:"verified",inventory:[],verifiedUpdate:proof},listed=["MoonDog-Update-Backup-2025-01-01T00-00-00-000Z-id"]}={}){
  let content=JSON.stringify(journal),writes=0;
  const file={
    getFile:async()=>({text:async()=>content}),
    createWritable:async()=>{let pending;return{
      write:async value=>{pending=value;},
      close:async()=>{content=pending;writes++;},
      abort:async()=>{}
    };}
  };
  const backup={
    entries:async function*(){for(const name of listed)yield[name,{kind:"directory"}];},
    getDirectoryHandle:async name=>{if(!listed.includes(name))throw missing();return directory;}
  };
  const directory={getFileHandle:async name=>{if(name!=="journal.json")throw missing();return file;}};
  const levels={
    "System Files":{getDirectoryHandle:async name=>name==="Workspace"?levels.Workspace:Promise.reject(missing())},
    Workspace:{getDirectoryHandle:async name=>name==="backups"?levels.backups:Promise.reject(missing())},
    backups:{getDirectoryHandle:async name=>name==="system-updates"?backup:Promise.reject(missing())}
  };
  const root={getDirectoryHandle:async name=>levels[name]||Promise.reject(missing())};
  return {root,backup,directory,file,get content(){return content;},get writes(){return writes;}};
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
