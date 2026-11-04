"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const stateStart=app.indexOf("  function hasExistingOperationalStateForRestore(");
const start=app.indexOf("  function verifyBackupStoreOwnership(");
const restoreStart=app.indexOf("  async function restoreSelectedBackup()",start);
const nextFunction=app.indexOf("  function latestImportSummary()",restoreStart);
assert.ok(start>=0&&restoreStart>start&&nextFunction>restoreStart,
  "Expected production identity preflight and restore operations");
assert.ok(stateStart>=0&&stateStart<start,"Expected live Workspace state predicate before identity validation");
const stateSource=app.slice(stateStart,start);
function hasExistingState(model){
  const context={model};
  vm.runInNewContext(stateSource+"\nglobalThis.hasState=hasExistingOperationalStateForRestore;",context);
  return context.hasState();
}
const context={};
vm.runInNewContext(app.slice(start,restoreStart)+"\nglobalThis.verifyStoreBackup=verifyBackupStoreOwnership;",context);
const verify=context.verifyStoreBackup;
const configured=(name,code,brand="")=>({store:{name,code,brand}});
const dodge=configured("Dodge Exampletown","9001","CDJR");
const bmw=configured("BMW Exampletown","7007","BMW");
const blank=configured("","");
const recoveredDodge=configured("  dodge  Exampletown ","9001","CDJR");

test("a whole-state restore for the same Guided Setup store is permitted",()=>{
  assert.equal(verify(dodge,dodge),true);
  assert.equal(verify(dodge,recoveredDodge),true);
});
test("another dealership's backup cannot replace the configured installation",()=>{
  assert.throws(()=>verify(dodge,bmw),/Needs Review/);
  assert.throws(()=>verify(bmw,dodge),/Needs Review/);
  assert.throws(()=>verify(configured("Dodge Exampletown","9001"),
    configured("Dodge Exampletown","7007")),/Needs Review/);
  assert.throws(()=>verify(configured("Dodge Exampletown","9001"),
    configured("BMW Exampletown","9001")),/Needs Review/);
  assert.throws(()=>verify(configured("Example Auto Mall","9001","Dodge"),
    configured("Example Auto Mall","9001","BMW")),/Needs Review/,
    "Matching store numbers and names must not override a verified brand conflict");
});
test("missing or partial destination and source identities fail closed",()=>{
  assert.throws(()=>verify(dodge,blank),/Needs Review/);
  assert.throws(()=>verify(dodge,configured("Dodge Exampletown","")),/Needs Review/);
  assert.throws(()=>verify(configured("Dodge Exampletown",""),dodge),/Needs Review/);
  assert.throws(()=>verify(configured("","9001"),dodge),/Needs Review/);
});
test("fresh installation can recover an identified store but not an unidentified legacy backup",()=>{
  assert.equal(verify(blank,dodge),true);
  assert.equal(verify(blank,bmw),true);
  assert.throws(()=>verify(blank,blank),/Needs Review/);
  assert.throws(()=>verify(blank,configured("BMW Exampletown","")) ,/Needs Review/);
  assert.throws(()=>verify(blank,configured("","7007")),/Needs Review/);
});
test("identity preflight happens before confirmation, safety backup or write authority",()=>{
  const restore=app.slice(restoreStart,nextFunction);
  const identity=restore.indexOf("verifyBackupStoreOwnership(");
  const confirmation=restore.indexOf("if(!confirm(");
  const safetyBackup=restore.indexOf("writeValidatedBackup(");
  const writeBegin=restore.indexOf("writeAuthority.beginRestore(");
  assert.ok(identity>=0&&confirmation>identity&&safetyBackup>confirmation&&writeBegin>safetyBackup,
    "Dealership identity must be checked before starting a restore or its write flow");
});

test("blank identity never adopts foreign backup over an already populated Workspace",()=>{
  assert.equal(verify(blank,dodge,false),true);
  assert.throws(()=>verify(blank,dodge,true),/existing operational data has no configured dealership identity/);
  assert.throws(()=>verify(blank,bmw,true),/existing operational data has no configured dealership identity/);
  const restore=app.slice(restoreStart,nextFunction);
  assert.match(restore,/verifyBackupStoreOwnership\(model\.settings,selected\.values\["data\/settings\.json"\],hasExistingOperationalStateForRestore\(\)\)/);
});
test("real Workspace state predicate distinguishes clean from populated local store",()=>{
  assert.equal(hasExistingState({state:{records:[]},performance:{snapshots:{}},operationalMetrics:{}}),false);
  assert.equal(hasExistingState({state:{records:[{id:"synthetic-ro"}]}}),true);
  assert.equal(hasExistingState({state:{closedRecords:[{id:"synthetic-closed"}]}}),true);
  assert.equal(hasExistingState({state:{source:{fileName:"synthetic.xlsx"}}}),true);
  assert.equal(hasExistingState({performance:{snapshots:{october:{value:1}}}}),true);
  assert.equal(hasExistingState({appointments:{days:{"2026-10-01":{}}}}),true);
  assert.equal(hasExistingState({operationalMetrics:{csi:{surveys:{"SYN-1":{}}}}}),true);
  assert.equal(hasExistingState({operationalMetrics:{menu:{snapshots:{week:{}}}}}),true);
  assert.equal(hasExistingState({assignNext:{days:{"2026-11-04":{}}}}),true,
    "Unidentified current workload is not equivalent to an empty installation");
  assert.equal(hasExistingState({operationalMetrics:{mediaAsrTech:{dailySnapshots:{"2026-11-04":{}}}}}),true,
    "A retained reference-family day cannot be silently reassigned to another store");
  assert.equal(hasExistingState({operationalMetrics:{csi:{imports:[{importedAt:"2026-11-04"}]}}}),true,
    "Durable source-import history counts as preexisting operational state");
});
