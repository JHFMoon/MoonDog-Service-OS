"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf("  function menuSalesAccountKey(");
const end=app.indexOf("  async function importMenuSalesFile(",start);
assert.ok(start>=0&&end>start,"menu sales importer section missing");
const parser=app.slice(start,end);
const header=["Account","Advisor \n Code","Advisor","ROs","% Presented","Sold",
  "% Penetration","Menu $","Menu A la carte $","Total $","$/Menu","Hrs/Menu","# Prepaid"];
const row=(account,code,name,ro=10,pres=.8,sold=3,penetration=.3)=>[
  account,code,name,ro,pres,sold,penetration,250,0,250,83.33,2.5,1
];
const params=[
  ["Ran Date/Time:","10/19/2026, 10:08 AM CDT"],
  ["Report:","MENU SALES - VMA+DMS (AutoNation)"],
  ["Date range:","10/1/2026 - 10/18/2026"]
];
const cdjr="AutoNation CDJR Exampletown";
const other="Different Brand Exampletown";
function prepare({name="AutoNation Chrysler Dodge Jeep Ram Exampletown",
  ids=[],rows=[],parameters=params}={}){
  const model={settings:{store:{name},storeName:name}};
  const sourceAdapter={reports:{}};
  const XLSX={read:()=>({Sheets:{"HyperBi Report":{rows:[header,...rows]},Parameters:{rows:parameters}}}),
    utils:{sheet_to_json:(sheet)=>sheet.rows}};
  const norm=v=>String(v??"").trim().toLowerCase().replace(/\s+/g," ");
  const text=v=>v==null?"":String(v);
  const csvNumber=v=>v==null||v===""?null:Number(String(v).replace(/[$,%\s,]/g,""));
  const configuredAdvisors=()=>ids.map(id=>({number:id,name:"Synthetic Advisor"}));
  const validAdvisorIdentity=(code,label="")=>/^\d+$/.test(text(code))&&!/^0+$/.test(text(code))&&!/^(unknown|not found|total)/i.test(label);
  const ctx={model,sourceAdapter,XLSX,norm,text,csvNumber,configuredAdvisors,validAdvisorIdentity,
    advisorDisplayName:code=>"Synthetic advisor "+code,
    usDateToIso:value=>value.replace(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/,(_,m,d,y)=>y+"-"+m.padStart(2,"0")+"-"+d.padStart(2,"0")),
    mondayFor:date=>"2026-10-19",
    now:()=>"2026-10-20T12:00:00Z"
  };
  vm.runInNewContext(parser,ctx);
  return ctx;
}
function reportRows(){
  return [
    row(other,"1001","Other Synthetic"),row(other,"1002","Other Synthetic"),
    row(other,"1003","Other Synthetic"),row(other,null,"40",100),
    row(cdjr,"3001","Example Synthetic",20,.65,4,.20),
    row(cdjr,"3002","Example Synthetic",25,.75,10,.40),
    row(cdjr,null,"7",45,.7,14,14/45),
    row("All Accounts",null,"49",145,.7,14,.3)
  ];
}
test("exact configured dealership name beats cross-store advisor code overlap",()=>{
  const {parseMenuSalesWorkbook}=prepare({ids:["1001","1002","1003","3001"],rows:reportRows()});
  const result=parseMenuSalesWorkbook([],"synthetic-menu.xlsx");
  assert.equal(result.account,cdjr);
  assert.equal(result.store.roCount,45);
  assert.equal(result.store.presentation,70);
  assert.equal(result.validation.storeIdentityMethod,"configured-store-name");
  assert.equal(result.validation.configuredAdvisorMatches,1);
  assert.equal(result.validation.unmatchedSourceAdvisorRows,1);
  assert.equal(Object.keys(result.advisors).length,1);
  assert.equal(result.advisors["3001"].roCount,20);
  assert.equal(result.releaseWeek,"2026-10-19");
});
test("verified account summary is useful even when no advisor IDs are configured",()=>{
  const {parseMenuSalesWorkbook}=prepare({ids:[],rows:reportRows()});
  const result=parseMenuSalesWorkbook([],"synthetic-menu.xlsx");
  assert.equal(result.store.roCount,45);
  assert.equal(Object.keys(result.advisors).length,0);
  assert.equal(result.validation.unmatchedSourceAdvisorRows,2);
  assert.equal(result.validation.storeIdentityMethod,"configured-store-name");
});
test("advisor code fallback requires at least two unique matches in a single account",()=>{
  const {parseMenuSalesWorkbook}=prepare({name:"Unmatched configured name",ids:["3001","3002"],rows:reportRows()});
  const result=parseMenuSalesWorkbook([],"synthetic-menu.xlsx");
  assert.equal(result.validation.storeIdentityMethod,"configured-advisor-codes");
  assert.equal(result.validation.configuredAdvisorMatches,2);
});
test("unrecognized dealership and ambiguous advisor codes fail closed",()=>{
  const {parseMenuSalesWorkbook}=prepare({name:"Different dealership",ids:["3001"],rows:reportRows()});
  assert.throws(()=>parseMenuSalesWorkbook([],"synthetic-menu.xlsx"),/could not be verified/);
});
test("incomplete selected store totals are rejected, without using another dealership",()=>{
  const rows=reportRows().map(row=>[...row]);
  const store=rows.find(row=>row[0]===cdjr&&!row[1]);
  store[4]=null;
  const {parseMenuSalesWorkbook}=prepare({ids:["3001","3002"],rows});
  assert.throws(()=>parseMenuSalesWorkbook([],"synthetic-menu.xlsx"),/incomplete core values/);
});
test("missing mandatory date range cannot create a report snapshot",()=>{
  const {parseMenuSalesWorkbook}=prepare({ids:[],rows:reportRows(),parameters:[
    ["Ran Date/Time:","10/19/2026"],
    ["Report:","MENU SALES - VMA+DMS"]
  ]});
  assert.throws(()=>parseMenuSalesWorkbook([],"synthetic-menu.xlsx"),/reporting period/);
});
test("bundle remains syntactically valid and menu identity is not hardcoded to one dealer",()=>{
  new vm.Script(app);
  assert.match(app,/menu-sales-v2-store-identity/);
  assert.match(app,/strict-report-recognition-2026-10-21-menu/);
  assert.doesNotMatch(parser,/ROSEVILLE|HAYWARD|FREMONT|SAN JOSE/i);
});
