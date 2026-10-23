"use strict";
// Issue #309: synthetic end-to-end classification boundary.
// Deliberately red until the protected Q1 return identity false positive is fixed.
// No real dealer names, advisor identities, or report files.
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function extract(begin,end){
  const a=app.indexOf(begin),b=app.indexOf(end,a+begin.length);
  assert.ok(a>=0&&b>a,"Source recognizer moved: "+begin);
  return app.slice(a,b);
}
const guards=extract("  function workbookIsHandoff(","  function workbookDate(");
const classification=extract("  async function classifyImportFile(","  async function moveToLearn(");
const uuid="123e4567-e89b-42d3-a456-426614174000";
function fixture(marker="MALAC"){
  const headers=["Account","Advisor \n Code","Advisor","ROs","% Presented","Sold",
    "% Penetration","Menu $","Menu A la carte $","Total $","$/Menu","Hrs/Menu",
    "# Prepaid","L1","L2","L3",marker];
  const report={Q1:{v:marker},rows:[headers,
    ["Synthetic Dealer","204","Synthetic Advisor",10,.8,4,.4,125,0,125,31.25,1.2,0,1,2,3,4],
    ["Synthetic Dealer",null,"49",10,.8,4,.4,125,0,125,31.25,1.2,0,1,2,3,4]]};
  const workbook={
    SheetNames:["HyperBi Report","Parameters"],
    Sheets:{"HyperBi Report":report,Parameters:{rows:[["Report:","MENU SALES - VMA+DMS"]]}},
    Props:{Keywords:""},Custprops:{}
  };
  const calls={menu:0,other:0};
  const fail=()=>{calls.other++;throw Error("not matched");};
  const env={
    XLSX:{read:()=>workbook,utils:{sheet_to_json:sheet=>sheet.rows||[]}},
    text:value=>String(value??""),
    RETURN_ID_HEADER:"__MoonDog RO ID",
    RETURN_ISSUANCE_CELL:"Q1",
    parseCsiWorkbook:fail,
    parseMenuSalesWorkbook:()=>{calls.menu++;return{verified:true};},
    parsePerformanceWorkbook:fail,
    parseSorWorkbook:fail,
    parseAppointmentActivityWorkbook:fail,
    parseEfficiencyWorkbook:fail,
    parseMediaAsrWorkbook:fail,
    parseOpenRoSummaryWorkbook:fail,
    parseSupplementalWorkbook:fail,
    parseCsv:fail,
    parseNextAppointmentsCsv:fail,
    parseAppointmentsCreatedSummaryCsv:fail,
    parseVirCsv:fail,
    parseCsiCsv:fail,
    parseCdkRepairOrdersDocx:fail,
    parseSupplementalDocxReport:fail,
    parsePdf:fail,
    legacyReport:()=>null,
    findTable:()=>null,
    referenceOnlyDocumentType:()=>null
  };
  vm.runInNewContext(guards+classification,env);
  const classify=()=>env.classifyImportFile("Synthetic Menu Sales.xlsx",{text:async()=>""},new Uint8Array([1,2]).buffer);
  return{classify,calls};
}
test("synthetic 17-column vendor Menu Sales reaches its parser without Supervisor quarantine",async()=>{
  const f=fixture("MALAC");
  assert.equal(await f.classify(),"menu-sales");
  assert.equal(f.calls.menu,1);
});
test("a true UUIDv4 Q1 issuance is still quarantined before any report parser",async()=>{
  const f=fixture(uuid);
  await assert.rejects(f.classify(),/Needs Review: damaged Supervisor Workbook/);
  assert.equal(f.calls.menu,0);
});
test("an outbound handoff Q1 is rejected before any report parser",async()=>{
  const f=fixture("MoonDog outbound handoff");
  await assert.rejects(f.classify(),/outbound only/);
  assert.equal(f.calls.menu,0);
});
