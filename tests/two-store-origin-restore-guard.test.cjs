"use strict";
// Synthetic independent-install negative paths; no real dealership identifiers.
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function extract(start,end){
  const from=app.indexOf(start),to=app.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,"Required production authority boundary: "+start);
  return app.slice(from,to);
}
const reportSource=extract("  // Guided Setup owns the installation identity.","  const escapeSourceCode =");
const backupSource=extract("  function verifyBackupStoreOwnership(","  async function restoreSelectedBackup()");
function store(name,code,brand){return {store:{name,code,brand}};}
const installs=[
  {id:"Dodge",settings:store("Exampletown Motors","9001","Dodge")},
  {id:"BMW",settings:store("Exampletown Motors","9001","BMW")}
];
function selectedCode(settings,reports={},family="appointmentActivity"){
  const context=vm.createContext({model:{settings},sourceAdapter:{reports}});
  vm.runInContext(reportSource+"\nthis.selectedCode=reportStoreCode;",context);
  return context.selectedCode(family);
}
const sandbox=vm.createContext({});
vm.runInContext(backupSource+"\nthis.checkBackup=verifyBackupStoreOwnership;",sandbox);
test("independent synthetic installs with identical name, code, advisor and RO cannot share a branded source mapping",()=>{
  const sharedOperational={advisorCode:"SYN-101",ro:"SYN-301"};
  const before=JSON.stringify(sharedOperational);
  const rule={storeCode:"SYN-VENDOR",storeIdentityVerified:true,
    guidedSetupStoreName:"Exampletown Motors",guidedSetupStoreCode:"9001",
    guidedSetupStoreBrand:"Dodge"};
  assert.equal(selectedCode(installs[0].settings,{appointmentActivity:rule}),"SYN-VENDOR");
  assert.throws(()=>selectedCode(installs[1].settings,{appointmentActivity:rule}),/Needs Review/);
  assert.equal(selectedCode(installs[1].settings),"9001",
    "no stale alias means the current installation identity remains canonical");
  assert.equal(JSON.stringify(sharedOperational),before,
    "store validation never mutates an overlapping advisor or RO identity");
});
test("prewrite backup identity preflight blocks cross-brand and missing-brand whole-state restoration",()=>{
  const [dodge,bmw]=installs.map(i=>i.settings);
  const stored={records:[{ro:"SYN-301",advisor:"SYN-101",management:{owner:"",ownerAssignmentSource:"manager-cleared"}}]};
  const before=JSON.stringify(stored);
  assert.throws(()=>sandbox.checkBackup(dodge,bmw,true),/Needs Review/);
  assert.throws(()=>sandbox.checkBackup(bmw,dodge,true),/Needs Review/);
  assert.throws(()=>sandbox.checkBackup(dodge,store("Exampletown Motors","9001",""),true),/Needs Review/);
  assert.throws(()=>sandbox.checkBackup(store("Exampletown Motors","9001",""),bmw,true),/Needs Review/);
  assert.equal(sandbox.checkBackup(dodge,store(" exampletown  motors ","9001"," dodge "),true),true);
  assert.equal(JSON.stringify(stored),before,
    "failed ownership checks do not touch saved local manager authority");
});
