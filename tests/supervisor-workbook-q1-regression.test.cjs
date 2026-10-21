"use strict";
// Security regression for #309. This test intentionally exposes the current
// third-party Q1 false positive; do not merge it until the trusted guard is
// correctly reviewed and corrected. All workbook fixtures are synthetic.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf("  function workbookIsHandoff(");
const end=app.indexOf("  function workbookDate(",start);
assert.ok(start>=0&&end>start,"Trusted workbook identity guards were relocated; review required");
const guardSource=app.slice(start,end);
const realLookingSyntheticId="123e4567-e89b-42d3-a456-426614174000";
function sheet(headers,q1){
  return{Q1:q1==null?undefined:{t:"s",v:q1},headers};
}
function book({headers=["Account","Advisor Code","Advisor","ROs"],q1="",keywords="",custprops=null}={}){
  return{SheetNames:["HyperBi Report","Parameters"],
    Sheets:{"HyperBi Report":sheet(headers,q1),Parameters:sheet(["Report:","MENU SALES"],"")},
    Props:{Keywords:keywords},Custprops:custprops};
}
function guardFor(value){
  const ctx=vm.createContext({
    text:v=>String(v??""),
    RETURN_ID_HEADER:"__MoonDog RO ID",
    RETURN_ISSUANCE_CELL:"Q1",
    XLSX:{utils:{sheet_to_json:s=>[s.headers||[]]}}
  });
  vm.runInContext(guardSource,ctx);
  return {
    handoff:ctx.workbookIsHandoff(value,"synthetic-menu.xlsx"),
    hasReturnSchema:ctx.workbookHasReturnSchema(value),
    hasReturnIdentity:ctx.workbookHasReturnIdentity(value)
  };
}
test("17-column third-party Menu Sales Q1 is ordinary header, not Supervisor identity (#309)",()=>{
  const headers=["Account","Advisor Code","Advisor","ROs","% Presented","Sold","% Penetration",
    "Menu $","Total $","$/Menu","Hrs/Menu","# Prepaid","X","Y","Z","Other Metric","MALAC"];
  const result=guardFor(book({headers,q1:"MALAC"}));
  assert.equal(result.handoff,false);
  assert.equal(result.hasReturnSchema,false);
  assert.equal(result.hasReturnIdentity,false,
    "Normal third-party column Q1 is not a valid MoonDog issuance marker");
});
test("ordinary third-party workbook without Q1 remains available for approved source parsing",()=>{
  assert.equal(guardFor(book()).hasReturnIdentity,false);
});
test("genuine supervisor UUIDv4 issuance in Q1 remains protected",()=>{
  assert.equal(guardFor(book({q1:realLookingSyntheticId})).hasReturnIdentity,true);
});
test("outbound handoff marker remains protected even if renamed",()=>{
  const result=guardFor(book({q1:"MoonDog outbound handoff"}));
  assert.equal(result.handoff,true);
  assert.equal(result.hasReturnIdentity,true);
});
test("explicit MoonDog return metadata remains protected",()=>{
  assert.equal(guardFor(book({keywords:"Service Operations Open RO Round Trip"})).hasReturnIdentity,true);
  assert.equal(guardFor(book({custprops:{MoonDogSupervisorIssuanceV1:realLookingSyntheticId}})).hasReturnIdentity,true);
});
test("protected field headers or workflow update columns remain protected",()=>{
  assert.equal(guardFor(book({headers:["Account","__MoonDog Last Update","ROs"]})).hasReturnIdentity,true);
  assert.equal(guardFor(book({headers:["RO","Next action","Commitment date"]})).hasReturnIdentity,true);
  assert.equal(guardFor(book({headers:["RO","Customer communication","Update note"]})).hasReturnIdentity,true);
});
test("complete returned workbook schema still uses return-workbook checks",()=>{
  const result=guardFor(book({headers:["__MoonDog RO ID","Next action","Commitment date"],
    q1:realLookingSyntheticId}));
  assert.equal(result.hasReturnSchema,true);
});
test("no private report values or dealership identifiers are added to the test",()=>{
  assert.doesNotMatch(guardSource,/MoonDog malicious bypass|skip supervisor guard/i);
  assert.doesNotMatch(fs.readFileSync(__filename,"utf8"),/ROSEVILLE|MEDFORD|FREMONT|HAYWARD/i);
});
