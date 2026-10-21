"use strict";
// Issue #309: full synthetic Menu Sales parser + workbook identity + classifier.
// No production store names, customer/employee identifiers or report bytes.
const test=require("node:test");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const fs=require("node:fs");
const path=require("node:path");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function extract(start,end){
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"Source boundary moved; review before updating: "+start);
  return app.slice(a,b);
}
const guardSource=extract("  function workbookIsHandoff(","  function workbookDate(");
const menuSource=extract("  function menuSalesAccountKey(","  async function importMenuSalesFile(");
const classifierSource=extract("  async function classifyImportFile(","  async function moveToLearn(");
const headers=["Account","Advisor \n Code","Advisor","ROs","% Presented","Sold",
  "% Penetration","Menu $","Menu A la carte $","Total $","$/Menu","Hrs/Menu",
  "# Prepaid","L1","L2","L3","MALAC"];
const thisAccount="Synthetic Chrysler Dodge Jeep Ram City";
const otherAccount="Unrelated Synthetic Dealer";
const originalParams=[
  ["Ran Date/Time:","10/19/2026, 10:08 AM CDT"],
  ["Report:","MENU SALES - VMA+DMS (Synthetic)"],
  ["Date range:","10/1/2026 - 10/18/2026"]
];
function row(account,code,name,ro=10,p=.8,sold=3,penetration=.3){
  return[account,code,name,ro,p,sold,penetration,260,0,260,86.67,2.5,1,0,0,0,0];
}
function fixture(opts={}){
  const reportRows=opts.rows||[
    row(otherAccount,"4001","Synthetic Other A",10,.2,1,.1),
    row(otherAccount,"4002","Synthetic Other B",20,.3,2,.1),
    row(otherAccount,null,"49",30,.3,3,.1),
    row(thisAccount,"9001","Synthetic Advisor One",15,.8,6,.4),
    row(thisAccount,"9002","Synthetic Advisor Two",10,.9,5,.5),
    row(thisAccount,null,"49",25,.84,11,.44)
  ];
  const workbook={
    SheetNames:["HyperBi Report","Parameters"],
    Sheets:{"HyperBi Report":{rows:[headers,...reportRows],Q1:{v:"MALAC"}},
      Parameters:{rows:opts.params||originalParams}},
    Props:{Keywords:""},Custprops:{}
  };
  const calls={menu:0,other:0};
  const fail=()=>{calls.other++;throw Error("Synthetic nonmatch");};
  const ctx={
    XLSX:{read:()=>workbook,utils:{sheet_to_json:s=>s.rows||[]}},
    text:v=>v==null?"":String(v),
    norm:v=>String(v??"").trim().toLowerCase().replace(/\s+/g," "),
    csvNumber:v=>v==null||v===""?null:Number(String(v).replace(/[$,%\s,]/g,"")),
    RETURN_ID_HEADER:"__MoonDog RO ID",RETURN_ISSUANCE_CELL:"Q1",
    model:{settings:{store:{name:opts.storeName||"Synthetic CDJR City"},storeName:opts.storeName||"Synthetic CDJR City"}},
    sourceAdapter:{reports:{}},configuredAdvisors:()=>(
      opts.codes||["4001","4002","9001","9002"]).map(number=>({number})),
    validAdvisorIdentity:(code,name="")=>/^\d+$/.test(String(code))&&!/^0+$/.test(String(code))&&!/^(unknown|not found|total)/i.test(name),
    advisorDisplayName:code=>"Synthetic Advisor "+code,
    usDateToIso:s=>String(s).replace(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/,(_,m,d,y)=>y+"-"+m.padStart(2,"0")+"-"+d.padStart(2,"0")),
    mondayFor:()=> "2026-10-19",now:()=> "2026-10-20T12:00:00Z",
    parseCsiWorkbook:fail,parsePerformanceWorkbook:fail,parseSorWorkbook:fail,
    parseAppointmentActivityWorkbook:fail,parseEfficiencyWorkbook:fail,
    parseMediaAsrWorkbook:fail,parseOpenRoSummaryWorkbook:fail,parseSupplementalWorkbook:fail,
    legacyReport:()=>null,findTable:()=>null
  };
  vm.runInNewContext(guardSource+menuSource+classifierSource,ctx);
  const parse=()=>{calls.menu++;return ctx.parseMenuSalesWorkbook(new ArrayBuffer(1),"Synthetic Menu Sales.xlsx");};
  const classify=()=>ctx.classifyImportFile("Synthetic Menu Sales.xlsx",{text:async()=>""},new ArrayBuffer(1));
  return{parse,classify,calls};
}
test("real Menu Sales parser selects configured account and excludes other-store advisor rows",()=>{
  const f=fixture();
  const result=f.parse();
  assert.equal(result.account,thisAccount);
  assert.equal(result.store.roCount,25);
  assert.equal(result.store.presentation,84);
  assert.equal(result.periodStart,"2026-10-01");
  assert.equal(result.periodEnd,"2026-10-18");
  assert.equal(result.validation.storeIdentityMethod,"configured-store-name");
  assert.equal(result.validation.configuredAdvisorMatches,2);
  assert.deepEqual(Object.keys(result.advisors).sort(),["9001","9002"]);
  assert.equal(result.advisors["9001"].penetration,40);
  assert.equal(result.advisors["9002"].roCount,10);
});
test("a verified store-level aggregate remains valid without configured advisor numbers",()=>{
  const result=fixture({codes:[]}).parse();
  assert.equal(result.store.roCount,25);
  assert.equal(Object.keys(result.advisors).length,0);
  assert.equal(result.validation.unmatchedSourceAdvisorRows,2);
});
test("ambiguous multistore identity fails closed",()=>{
  const duplicate=[
    row(thisAccount,"9001","Synthetic Advisor",10),row(thisAccount,null,"49",10),
    row("Synthetic CDJR City","9002","Synthetic Advisor",10),row("Synthetic CDJR City",null,"49",10)
  ];
  assert.throws(()=>fixture({rows:duplicate}).parse(),/matched multiple accounts/);
});
test("invalid required date range fails before a Menu Sales snapshot is returned",()=>{
  const f=fixture({params:[["Ran Date/Time:","10/19/2026"],["Report:","MENU SALES - VMA+DMS (Synthetic)"]]});
  assert.throws(()=>f.parse(),/reporting period/);
});
test("full classifier must route a valid 17-column report to the real Menu Sales parser",async()=>{
  const f=fixture();
  assert.equal(await f.classify(),"menu-sales");
});
