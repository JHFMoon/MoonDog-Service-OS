"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const maintenance=require("../assets/maintenance.js");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const day="2026-10-12",eventPath="data/history/synthetic-history.json";

async function housekeepingCase(deep){
  const requests=[];
  let metadata={lastDeepHousekeepingDate:deep?"":day};
  const io={
    list:async (folder,recursive)=>{
      requests.push({operation:"list",path:folder,recursive:Boolean(recursive)});
      return folder==="data/history"?[eventPath]:[];
    },
    stat:async p=>({modified:Date.parse(day+"T12:00:00Z")}),
    read:async p=>{
      requests.push({operation:"read",path:p});
      if(p===eventPath)return Buffer.from("{}");
      throw Object.assign(Error("Not found"),{name:"NotFoundError"});
    },
    hash:async()=>"",exists:async()=>false,listDirectories:async()=>[]
  };
  const api={
    recovery:()=>({housekeeping:metadata}),day:()=>day,
    now:()=>Date.parse(day+"T19:00:00Z"),busy:()=>false,references:()=>[],
    currentWorkbook:()=>"exports/absent.xlsx",ensureFolders:async()=>{},
    validateCurrent:async()=>{},validateWorkbook:async()=>{},
    finish:async updated=>{metadata=updated;},diagnostic:async()=>{}
  };
  const result=await maintenance.create(io,api).run();
  assert.equal(result.failed,undefined,"housekeeping succeeds");
  assert.equal(result.deep,deep,"requested maintenance depth is preserved");
  return requests;
}

test("Light housekeeping does not enumerate or read thousands of historical event files",async()=>{
  const requests=await housekeepingCase(false);
  assert.ok(!requests.some(request=>request.path==="data/history"||request.path===eventPath));
  assert.ok(requests.some(request=>request.path==="backups"),"light rollback and backup safety work still runs");
});

test("Daily deep housekeeping still validates historical event files",async()=>{
  const requests=await housekeepingCase(true);
  assert.ok(requests.some(request=>request.operation==="list"&&request.path==="data/history"));
  assert.ok(requests.some(request=>request.operation==="read"&&request.path===eventPath));
});

test("Scheduled housekeeping defers to fullscreen presentation and resumes on exit",()=>{
  assert.match(app,/busy:.*Boolean\(document\.fullscreenElement\)/,
    "foreground fullscreen blocks scheduled housekeeping");
  assert.match(app,/addEventListener\('fullscreenchange',\(\)=>\{if\(!document\.fullscreenElement\)notify\(\);\}\)/,
    "fullscreen exit schedules postponed housekeeping");
});
