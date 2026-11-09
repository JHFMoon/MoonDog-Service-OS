"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const from=app.indexOf("  // Guided Setup owns the installation identity.");
const to=app.indexOf("  const escapeSourceCode =",from);
assert.ok(from>=0&&to>from,"Expected centralized Guided Setup report store binding");
const selected=app.slice(from,to);
function resolve(name,code,reports={},family="appointmentActivity",brand=""){
  const context={model:{settings:{store:{name,code,brand}}},sourceAdapter:{reports}};
  vm.runInNewContext(selected,context);
  return context.reportStoreCode(family);
}
test("every report uses the configured Guided Setup store absent an explicit mapping",()=>{
  for(const name of ["Dodge Exampletown","BMW Exampletown"])
    for(const family of ["sor","appointmentActivity","mediaAsr","efficiency","openRoSummary","tradeAr"])
      assert.equal(resolve(name,name.startsWith("Dodge")?"9001":"7007",{},family),
        name.startsWith("Dodge")?"9001":"7007");
});
test("configured identical vendor code does not need a separate approval",()=>{
  assert.equal(resolve("Dodge Exampletown","9001",{sor:{storeCode:"9001"}},"sor"),"9001");
});
test("legacy or stale vendor overrides fail closed instead of selecting another store",()=>{
  assert.throws(()=>resolve("Dodge Exampletown","9001",
    {appointmentActivity:{storeCode:"7007"}}),/Needs Review/);
  assert.throws(()=>resolve("Dodge Exampletown","9001",
    {appointmentActivity:{storeCode:"7007",storeIdentityVerified:true,guidedSetupStoreCode:"9001",
      guidedSetupStoreName:"BMW Exampletown"}}),/Needs Review/);
  assert.throws(()=>resolve("BMW Exampletown","7007",
    {appointmentActivity:{storeCode:"9001",storeIdentityVerified:true,guidedSetupStoreCode:"9001",
      guidedSetupStoreName:"Dodge Exampletown"}}),/Needs Review/);
});
test("explicit verified vendor alias is valid only for that exact configured dealership",()=>{
  const reports={tradeAr:{storeCode:"1010",storeIdentityVerified:true,
    guidedSetupStoreCode:"9001",guidedSetupStoreName:"Dodge Exampletown",guidedSetupStoreBrand:"Dodge"}};
  assert.equal(resolve("Dodge Exampletown","9001",reports,"tradeAr","Dodge"),"1010");
  assert.throws(()=>resolve("BMW Exampletown","7007",reports,"tradeAr","BMW"),/Needs Review/);
});
test("vendor aliases are brand-specific and stale branded mappings fail closed",()=>{
  const mapped={storeCode:"1010",storeIdentityVerified:true,guidedSetupStoreCode:"9001",
    guidedSetupStoreName:"Exampletown Motors",guidedSetupStoreBrand:"Dodge"};
  assert.equal(resolve("Exampletown Motors","9001",{tradeAr:mapped},"tradeAr","  DODGE  "),"1010");
  assert.throws(()=>resolve("Exampletown Motors","9001",{tradeAr:mapped},"tradeAr","BMW"),/Needs Review/);
  assert.throws(()=>resolve("Exampletown Motors","9001",
    {tradeAr:{...mapped,guidedSetupStoreBrand:""}},"tradeAr","Dodge"),/Needs Review/);
  assert.throws(()=>resolve("Exampletown Motors","9001",{tradeAr:mapped},"tradeAr",""),/Needs Review/);
});
test("an unidentified install cannot validate a vendor alias with two blank brands",()=>{
  const alias={storeCode:"1010",storeIdentityVerified:true,
    guidedSetupStoreCode:"9001",guidedSetupStoreName:"Exampletown Motors",guidedSetupStoreBrand:""};
  assert.throws(()=>resolve("Exampletown Motors","9001",{tradeAr:alias},"tradeAr",""),/Needs Review/);
});
test("same-store vendor codes do not need alias-brand exceptions",()=>{
  assert.equal(resolve("Exampletown Motors","9001",
    {tradeAr:{storeCode:"9001",guidedSetupStoreBrand:"Other"}},"tradeAr","Dodge"),"9001");
});
test("no store code or name cannot establish identity",()=>{
  assert.throws(()=>resolve("BMW Exampletown",""),/Guided Setup/);
  assert.throws(()=>resolve("","7007"),/Guided Setup/);
});
test("source code includes no hardcoded dealer identity",()=>{
  assert.doesNotMatch(selected,/Dodge Exampletown|BMW Exampletown|Synthetic Motors|Exampletown Motors/i);
});
