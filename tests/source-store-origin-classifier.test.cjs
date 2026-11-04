"use strict";
// #59-01 canonical source-origin contract. Synthetic stores and source files only.
const test=require("node:test"),assert=require("node:assert/strict");
const {SOURCE_DEFINITIONS,classifySourceStoreOrigin:assess}=require("../assets/freshness.js");
const dodge={name:"Exampletown Motors",code:"09001",brand:"Dodge"};
const bmw={name:"Exampletown Motors",code:"09001",brand:"BMW"};
const exact={...dodge},unmarked={};
const result=(family,configuredStore,sourceStore,verifiedAlias)=>
  assess({family,configuredStore,sourceStore,verifiedAlias});
test("all fourteen catalogued sources share one strict origin classification contract",()=>{
  const families=Object.keys(SOURCE_DEFINITIONS);
  assert.equal(families.length,14);
  for(const family of families){
    assert.equal(result(family,dodge,exact).status,"verified-source-store",family);
    assert.equal(result(family,dodge,unmarked).status,"configured-destination-only",family);
    assert.equal(result(family,bmw,exact).status,"store-conflict",family);
    assert.equal(result(family,dodge,{name:dodge.name,code:dodge.code}).status,
      "configured-destination-only",family+": partial identity is NOT verified");
  }
});
test("cross-brand identity conflict prevails over overlapping store numbers, advisors and ROs",()=>{
  const sameEmployees={advisor:"SYN-101",ro:"SYN-1001"};
  const before=JSON.stringify(sameEmployees);
  const family="openRo";
  assert.equal(result(family,bmw,dodge).status,"store-conflict");
  assert.equal(result(family,dodge,bmw).status,"store-conflict");
  assert.equal(result(family,dodge,{brand:"BMW"}).status,"store-conflict");
  assert.equal(JSON.stringify(sameEmployees),before);
});
test("missing store brand/code/name cannot authorize another installation",()=>{
  for(const invalid of [
    {...dodge,name:""},{...dodge,code:""},{...dodge,brand:""}
  ])assert.notEqual(result("sapr",invalid,dodge).status,"verified-source-store");
  for(const missing of [{code:dodge.code},{name:dodge.name},{brand:dodge.brand},{}])
    assert.equal(result("csi",dodge,missing).status,"configured-destination-only");
});
test("leading-zero store codes and source-supplied conflicts are not normalized away",()=>{
  assert.equal(result("appointmentActivity",dodge,{...dodge,code:"9001"}).status,"store-conflict");
  assert.equal(result("appointmentActivity",dodge,{...dodge,name:"Different Store"}).status,"store-conflict");
  assert.equal(result("appointmentActivity",dodge,{
    name:" exampletown  motors ",code:"09001",brand:" DODGE "
  }).status,"verified-source-store");
});
test("only an alias verified for the exact configured store, family and complete reported identity is valid",()=>{
  const vendor={name:"Vendor Dodge Exampletown",code:"V-09001",brand:"Dodge"};
  const alias={storeIdentityVerified:true,family:"mediaAsr",
    configuredStore:{...dodge},sourceStore:{...vendor}};
  assert.equal(result("mediaAsr",dodge,vendor,alias).status,"verified-source-store");
  assert.equal(result("mediaAsr",dodge,vendor,alias).reason,"verified-local-alias");
  assert.equal(result("mediaAsr",bmw,vendor,alias).status,"store-conflict");
  assert.equal(result("efficiency",dodge,vendor,alias).status,"store-conflict");
  assert.equal(result("mediaAsr",dodge,vendor,{...alias,storeIdentityVerified:false}).status,"store-conflict");
  assert.equal(result("mediaAsr",dodge,{...vendor,code:""},alias).status,"store-conflict");
  assert.equal(result("mediaAsr",dodge,vendor,{...alias,configuredStore:{...dodge,brand:"BMW"}}).status,"store-conflict");
});
test("unrecognized families cannot acquire source authority and results are immutable",()=>{
  const unknown=result("unlistedFamily",dodge,dodge);
  assert.equal(unknown.status,"store-conflict");
  assert.equal(unknown.reason,"unknown-source-family");
  const known=result("sor",dodge,dodge);
  assert.ok(Object.isFrozen(known));
  assert.ok(Object.isFrozen(known.evidence));
});
