"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const section=(start,end)=>{
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"Production parser boundary missing: "+start);
  return app.slice(a,b);
};
const norm=value=>String(value??"").trim().toLowerCase().replace(/\s+/g," ");
const text=value=>String(value??"");
const validCoverageDate=value=>/^20\d{2}-\d{2}-\d{2}$/.test(value)?value:"";
const performanceNumber=value=>value==null||value===""?null:Number(value);
const arHeaders=[
  "B/U","Headquarters Id","Parent #","Customer #","Customer Name",
  "Actual Days Open","AN Store#","Full Store Name / Hyp","Market","AN Store Name",
  "Doc Type","Invoice Date","Invoice #","LU","Status","Invoice Amount (USD)",
  "Tax Amount","Amount Received (USD)","Open Amount (USD)","Invoice Reason",
  "Purchase Order","Manual Purchase Order","Last Note"
];
function arRow({store=101,customer="SYNTHETIC-CUSTOMER",invoice="FAKE-INVOICE",
  days=15,status="Attempt 1",open=105.20,invoiceAmount=200,received=94.8}={}){
  const row=Array(23).fill(null);
  for(const [heading,value] of Object.entries({
    "Customer #":customer,"Customer Name":"DO NOT SAVE THIS NAME",
    "Actual Days Open":days,"AN Store#":store,"Invoice Date":"2026-01-08",
    "Invoice #":invoice,"Status":status,"Invoice Amount (USD)":invoiceAmount,
    "Amount Received (USD)":received,"Open Amount (USD)":open,
    "Invoice Reason":"SENSITIVE INVOICE REASON","Last Note":"SENSITIVE CUSTOMER NOTE"
  }))row[arHeaders.indexOf(heading)]=value;
  return row;
}
function arHarness(rows,storeCode="101"){
  const book={SheetNames:["Summary","Trade AR Error Report"],
    Sheets:{Summary:{rows:[["Row Labels","Attempt 1","Attempt 2","Attempt 3","Grand Total"]]},
      "Trade AR Error Report":{rows}}};
  const XLSX={read:()=>book,utils:{sheet_to_json:sheet=>sheet.rows}};
  const ctx={XLSX,norm,text,now:()=>"2026-01-10T00:00:00Z",
    reportStoreCode:()=>storeCode,performanceNumber,
    strictOpenRoDate:value=>validCoverageDate(text(value)),
    validCoverageDate};
  vm.runInNewContext(section("  function parseTradeArErrorWorkbook(","  function parseOpenRoAgingByAsmWorkbook("),ctx);
  return{parse:()=>ctx.parseTradeArErrorWorkbook([], "Trade AR Error Report 01.09.2026.xlsx"),book,XLSX};
}

test("Trade AR takes only the configured store and retains no invoice/customer/note detail",()=>{
  const source=[arHeaders,arRow({invoice:"FAKE-1"}),
    arRow({invoice:"FAKE-2",days:100,status:"Attempt 3",open:-5.10,invoiceAmount:0,received:5.10}),
    arRow({store:202,invoice:"OTHER-STORE",open:1000000})];
  const result=arHarness(source).parse();
  assert.equal(result.family,"trade-ar-errors");
  assert.equal(result.metrics.invoiceCount,2);
  assert.equal(Math.round(result.metrics.openAmount*100),10010);
  assert.equal(result.metrics.aging.under30,1);
  assert.equal(result.metrics.aging.days90plus,1);
  assert.equal(result.metrics.attempts["Attempt 1"],1);
  assert.equal(result.metrics.attempts["Attempt 3"],1);
  assert.equal(result.validation.otherStoreRowsExcluded,1);
  assert.equal(result.validation.storeScopeVerified,true);
  assert.equal(result.validation.kpiPromotion,false);
  assert.equal(result.validation.customerAndInvoiceDetailsNotRetained,true);
  assert.equal(result.asOfDate,"2026-01-09");
  assert.equal(result.validation.asOfDateFromFilenameOnly,true);
  assert.doesNotMatch(JSON.stringify(result),
    /FAKE-1|OTHER-STORE|SYNTHETIC-CUSTOMER|DO NOT SAVE|SENSITIVE|1000000/);
});

test("Trade AR rejects absent store, bad schema, duplicate identity and corrupt scoped money",()=>{
  assert.throws(()=>arHarness([arHeaders,arRow({store:202})]).parse(),/configured AN Store#/);
  const badHeaders=arHeaders.slice();badHeaders[18]="Wrong Balance Column";
  assert.throws(()=>arHarness([badHeaders,arRow()]).parse(),/detail columns/);
  assert.throws(()=>arHarness([arHeaders,arRow(),arRow()]).parse(),/duplicate Trade AR/);
  assert.throws(()=>arHarness([arHeaders,arRow({open:"not an amount"})]).parse(),/money is unreadable/);
  assert.throws(()=>arHarness([arHeaders,arRow({store:null})]).parse(),/unscoped/);
});

test("Trade AR classifier recognizes the exact sheet and leaves malformed imports to review",async()=>{
  const {book,XLSX}=arHarness([arHeaders,arRow()]);
  const ctx={XLSX,prepareXlsxWorkbook:async()=>book,
    workbookIsHandoff:()=>false,workbookHasReturnSchema:()=>false,
    workbookHasReturnIdentity:()=>false};
  vm.runInNewContext(section("  async function classifyImportFile(","  async function moveToLearn("),ctx);
  assert.equal(await ctx.classifyImportFile("AR.xlsx",{name:"AR.xlsx"},new ArrayBuffer(1)),
    "supplemental-workbook");
});

function groupedBook(sectionCount){
  const rows=[],header=[null,"RO","TAG-NO","OPEN-DATE","RO-CNT","DAYS",
    "CUSTOMERNAME","STATUS","TYPES","PTS-SALE-AMT","CPLBRSALE","IPLBRSALE","WPLBRSALE"];
  const total=sectionCount+1; // one non-vehicle WEB* row is counted by the export
  for(let index=0;index<sectionCount;index++){
    const advisor=index===0?"101":String(201+index);
    rows.push(["SVCADV : "+advisor+" ("+(index===0?2:1)+" items)"]);
    rows.push([null,"REPORT OF OPEN ROS BY ADVISOR - "+total+" Rows Returned"]);
    rows.push(header);
    rows.push([null,String(90000000+index), "FAKE-TAG","2026-01-08",null,index,
      "FAKE CUSTOMER",index%2?"READY TO POST":"PREASSIGNED","C"]);
    if(index===0)rows.push([null,"WEB*"]);
  }
  return{SheetNames:["Synthetic grouped Open ROs"],
    Sheets:{"Synthetic grouped Open ROs":{rows}}};
}
test("four synthetic grouped Open RO export shapes reconcile including WEB* and varying advisor sections",()=>{
  const ctx={text,norm,now:()=>"2026-01-10T00:00:00Z",
    workbookDate:value=>validCoverageDate(text(value)),validCoverageDate,
    reconcileRecordSourceIdentity:()=>{},advisorDisplayName:code=>"Synthetic Advisor "+code,
    sourceFieldValue:()=>"",stableId:value=>"FAKE-"+value.ro,
    ADVISOR_NAMES:{"101":"Synthetic Advisor 101"},ALIASES:{technician:[],technicianCode:[]}};
  vm.runInNewContext(section("  function strictOpenRoDate(","  async function scanFiles("),ctx);
  for(const sectionCount of [8,9,10,9]){
    const book=groupedBook(sectionCount);
    ctx.XLSX={utils:{sheet_to_json:sheet=>sheet.rows}};
    const result=ctx.legacyReport(book);
    assert.equal(result.advisorSections,sectionCount);
    assert.equal(result.sourceRows,sectionCount+1);
    assert.equal(result.nonRoRowsExcluded,1);
    assert.equal(result.records.length,1);
    assert.equal(result.untrackedAdvisorRowsExcluded,sectionCount-1);
    assert.equal(result.verification,"group totals and global rows returned reconciled");
    assert.equal(result.records[0].sourceStatus,"PREASSIGNED");
  }
});

test("application remains valid JavaScript and source boundaries remain supplemental for AR",()=>{
  new vm.Script(app);
  assert.match(app,/parseTradeArErrorWorkbook\(bytes,fileName\)/);
  assert.match(app,/if \(book\.SheetNames\.includes\("Trade AR Error Report"\)\)/);
});
