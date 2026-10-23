"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf('  window.addEventListener("focus",()=>folderWatchScan("focus"));document.addEventListener("visibilitychange"');
const end=app.indexOf("\n  syncArrivalDate();",start);
assert.ok(start>=0&&end>start,"production focus and visibility resume hooks exist");
const lifecycle=app.slice(start,end);

function harness(){
  const listeners=new Map(),scans=[];
  const document={visibilityState:"hidden",addEventListener:(name,handler)=>listeners.set("document:"+name,handler)};
  const window={addEventListener:(name,handler)=>listeners.set("window:"+name,handler)};
  const context=vm.createContext({document,window,folderWatchScan:reason=>{scans.push(reason);}});
  vm.runInContext(lifecycle,context);
  return {document,listeners,scans};
}

test("visible resume rechecks the synthetic Report Inbox after hidden idle periods",()=>{
  const {document,listeners,scans}=harness();
  const onVisibility=listeners.get("document:visibilitychange");
  assert.equal(typeof onVisibility,"function");
  for(let i=0;i<100;i++){
    document.visibilityState="hidden";
    onVisibility();
    document.visibilityState="visible";
    onVisibility();
  }
  assert.equal(scans.length,100,"hidden periods do no work and each visible resume starts one recheck");
  assert.ok(scans.every(reason=>reason==="visible"));
});

test("window focus rechecks the synthetic Report Inbox through the production hook",()=>{
  const {listeners,scans}=harness();
  const onFocus=listeners.get("window:focus");
  assert.equal(typeof onFocus,"function");
  onFocus();
  assert.deepEqual(scans,["focus"]);
});
