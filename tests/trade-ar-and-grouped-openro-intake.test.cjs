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
function arHarness(rows,storeCode="101",formats={},layoutRules=[],bookOverride=null){
  const tradeSheet={rows,"!ref":"A1:W"+rows.length};
  const columnName=index=>{let name="";for(let n=index+1;n;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;};
  const encodeCell=({r,c})=>columnName(c)+(r+1);
  for(const [position,format] of Object.entries(formats)){
    const [row,column]=position.split(":").map(Number);
    tradeSheet[encodeCell({r:row,c:column})]={v:rows[row]?.[column],z:format,w:format.includes("%")?"10%":""};
  }
  let readOptions=null;
  const book=bookOverride||{SheetNames:["Summary","Trade AR Error Report"],
    Sheets:{Summary:{rows:[["Row Labels","Attempt 1","Attempt 2","Attempt 3","Grand Total"]]},
      "Trade AR Error Report":tradeSheet}};
  const XLSX={read:(_bytes,options)=>{readOptions=options;return book;},
    utils:{sheet_to_json:sheet=>sheet.rows,decode_range:()=>({s:{r:0,c:0}}),encode_cell:encodeCell}};
  const learnStart=app.indexOf("/* MoonDog Paste & Learn — inert"),learnEnd=app.indexOf("})(globalThis);",learnStart),learnContext={};
  vm.runInNewContext(app.slice(learnStart,learnEnd+15),learnContext);
  const ctx={XLSX,norm,text,now:()=>"2026-01-10T00:00:00Z",MoonDogPasteLearn:learnContext.MoonDogPasteLearn,
    reportStoreCode:()=>storeCode,model:{settings:{future:{reportLayoutRules:layoutRules}}},
    strictOpenRoDate:value=>validCoverageDate(text(value)),
    validCoverageDate};
  vm.runInNewContext(section("  function tradeArMoneyCents(","  function parseTradeArErrorWorkbook("),ctx);
  vm.runInNewContext(section("  function matchingTradeArReportLayout(","  function parseOpenRoAgingByAsmWorkbook("),ctx);
  return{parse:(override=null)=>ctx.parseTradeArErrorWorkbook([], "Trade AR Error Report 01.09.2026.xlsx",override),
    parseMoney:ctx.tradeArMoneyCents,parseDays:ctx.tradeArAgingDays,book,XLSX,ctx,
    getReadOptions:()=>readOptions};
}

test("Trade AR takes only the configured store and retains no invoice/customer/note detail",()=>{
  const source=[arHeaders,arRow({invoice:"FAKE-1",open:"$105.20",invoiceAmount:"$200.00",received:"$94.80"}),
    arRow({invoice:"FAKE-2",days:100,status:"Attempt 3",open:-5.10,invoiceAmount:0,received:5.10}),
    arRow({store:202,invoice:"OTHER-STORE",open:1000000})];
  const harness=arHarness(source);
  const result=harness.parse();
  assert.equal(result.family,"trade-ar-errors");
  assert.equal(harness.getReadOptions().cellNF,true);
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

test("Trade AR production numeric parsers accept only explicit decimal money and integer aging formats",()=>{
  const harness=arHarness([arHeaders,arRow()]);
  assert.equal(harness.parseMoney(200),20000);
  assert.equal(harness.parseMoney("$1,234.56"),123456);
  assert.equal(harness.parseMoney("-$5.10"),-510);
  assert.equal(harness.parseMoney("(5.10)"),-510);
  for(const value of [""," ","$","10%","1,2","$1,2","1.234","1e3","USD 5",null,undefined])
    assert.equal(harness.parseMoney(value),null,JSON.stringify(value)+" must be rejected");
  assert.equal(harness.parseDays(15),15);
  assert.equal(harness.parseDays("1,000"),1000);
  for(const value of [""," ","$1","1%","1,2","1.5","-1","1e2",null,undefined])
    assert.equal(harness.parseDays(value),null,JSON.stringify(value)+" must be rejected");
});

test("Trade AR fails closed on malformed scoped values without changing saved totals or deleting source",async()=>{
  const invalidMoney=[""," ","$","10%","1,2","$1,2","1.234","1e3","USD 5",null];
  const invalidDays=[""," ","$1","1%","1,2","1.5","-1","1e2",null];
  async function assertPreserved(rows,formats={}){
    const harness=arHarness(rows,"101",formats),originalSnapshot={family:"trade-ar-errors",metrics:{openAmount:77.25}};
    const model={operationalMetrics:{supplementalReports:{snapshots:{existing:structuredClone(originalSnapshot)}}}};
    const before=JSON.stringify(model.operationalMetrics);
    let sourcePresent=true,deleteCalls=0,writeCalls=0;
    const ctx=harness.ctx;
    ctx.model=model;
    ctx.prepareXlsxWorkbook=async()=>{};
    ctx.parseSupplementalWorkbook=(bytes,name)=>ctx.parseTradeArErrorWorkbook(bytes,name);
    ctx.sourceLocations=new Map();
    ctx.sourceFileHandle=async()=>({getFile:async()=>({lastModified:0})});
    ctx.supplementalSnapshotKey=()=> "new";
    ctx.pruneSupplementalSnapshots=snapshots=>snapshots;
    ctx.writeJson=async()=>{writeCalls++;};
    ctx.readJson=async()=>null;
    ctx.addHistory=async()=>{};
    ctx.removeSourceEntry=async()=>{deleteCalls++;sourcePresent=false;};
    vm.runInNewContext(section("  async function importSupplementalSource(","  async function processClassifiedCandidate("),ctx);
    await assert.rejects(()=>ctx.importSupplementalSource(
      {name:"synthetic-trade-ar.xlsx",location:"inbox"},"supplemental-workbook",new ArrayBuffer(1),true),
      /Trade AR aging, date, or money is unreadable|percentage-formatted Trade AR values are ambiguous/);
    assert.equal(JSON.stringify(model.operationalMetrics),before);
    assert.equal(sourcePresent,true);
    assert.equal(deleteCalls,0);
    assert.equal(writeCalls,0);
  }
  for(const field of ["invoiceAmount","received","open"])
    for(const value of invalidMoney)
      await assertPreserved([arHeaders,arRow(),arRow({[field]:value})]);
  for(const value of invalidDays)
    await assertPreserved([arHeaders,arRow(),arRow({days:value})]);
  for(const field of ["invoiceAmount","received","open"]){
    const column={invoiceAmount:15,received:17,open:18}[field];
    await assertPreserved([arHeaders,arRow(),arRow({[field]:0.1})],{["2:"+column]:"0.00%"});
  }
  await assertPreserved([arHeaders,arRow(),arRow({days:1})],{"2:5":"0%"});
});

test("Trade AR rejects absent store, bad schema and duplicate scoped identity",()=>{
  assert.throws(()=>arHarness([arHeaders,arRow({store:202})]).parse(),/configured AN Store#/);
  const badHeaders=arHeaders.slice();badHeaders[18]="Wrong Balance Column";
  assert.throws(()=>arHarness([badHeaders,arRow()]).parse(),/detail columns/);
  assert.throws(()=>arHarness([arHeaders,arRow(),arRow()]).parse(),/duplicate Trade AR/);
  assert.throws(()=>arHarness([arHeaders,arRow({store:null})]).parse(),/unscoped/);
});

test("Trade AR classifier recognizes the exact sheet and leaves malformed imports to review",async()=>{
  const {book,XLSX}=arHarness([arHeaders,arRow()]);
  const ctx={XLSX,prepareXlsxWorkbook:async()=>book,matchingTradeArReportLayout:()=>null,
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
  assert.match(app,/book\.SheetNames\.includes\("Trade AR Error Report"\).*matchingTradeArReportLayout\(book\)/);
});


test("layout teaching reuses production handoff and Supervisor Workbook identity guards",()=>{
  const workbookGuards=section("  function workbookIsHandoff(","  function workbookDate(");
  const layoutGuard=section("  function assertTradeArLayoutSource(","  function matchingTradeArReportLayout(");
  const context={text:value=>String(value??""),RETURN_ID_HEADER:"__MoonDog RO ID",RETURN_ISSUANCE_CELL:"Q1",
    XLSX:{utils:{sheet_to_json:sheet=>sheet.rows||[]}}};
  vm.runInNewContext(workbookGuards+layoutGuard,context);
  const ordinary={SheetNames:["Detail"],Sheets:{Detail:{rows:[["Trade AR"]]}},Props:{Keywords:""},Custprops:{}};
  assert.doesNotThrow(()=>context.assertTradeArLayoutSource(ordinary,"synthetic.xlsx"));
  assert.throws(()=>context.assertTradeArLayoutSource({...ordinary,Props:{Keywords:"MoonDog Advisor Handoff Snapshot"}},"synthetic.xlsx"),/outbound only/);
  const schema={SheetNames:["Detail"],Sheets:{Detail:{rows:[["__MoonDog RO ID","Next action","Commitment date"]]}},Props:{Keywords:""},Custprops:{}};
  assert.throws(()=>context.assertTradeArLayoutSource(schema,"synthetic.xlsx"),/Update RO import/);
  const identity={SheetNames:["Detail"],Sheets:{Detail:{rows:[["Trade AR"]],Q1:{v:"123e4567-e89b-42d3-a456-426614174000"}}},Props:{Keywords:""},Custprops:{}};
  assert.throws(()=>context.assertTradeArLayoutSource(identity,"synthetic.xlsx"),/damaged Supervisor Workbook/);
});

test("local report layout teaching stores only allowlisted declarative fields",()=>{
  const begin=app.indexOf("/* MoonDog Paste & Learn — inert"),end=app.indexOf("})(globalThis);",begin);
  assert.ok(begin>=0&&end>begin);
  const source=app.slice(begin,end+14),cx={};vm.runInNewContext(source,cx);
  const engine=cx.MoonDogPasteLearn;
  const columns={store:"Store",customer:"Client",invoice:"Reference",invoiceDate:"Bill date",
    days:"Days",status:"Attempt",invoiceAmount:"Billed",received:"Paid",open:"Balance"};
  const rule=engine.safeReportLayout({family:"trade-ar-errors",sheetName:"Receivables",headerRow:2,columns},[]);
  assert.equal(rule.writeEnabled,false);assert.equal(rule.approved,true);assert.equal(rule.headerRow,2);
  const exactName=engine.safeReportLayout({family:"trade-ar-errors",sheetName:"AR  Detail",headerRow:0,columns},[]);
  const collapsedName=engine.safeReportLayout({family:"trade-ar-errors",sheetName:"AR Detail",headerRow:0,columns},[]);
  assert.equal(exactName.sheetName,"AR  Detail");
  assert.notEqual(exactName.id,collapsedName.id,"distinct exact worksheet names keep distinct local mappings");
  assert.deepEqual(Object.keys(rule.columns),["store","customer","invoice","invoiceDate","days","status","invoiceAmount","received","open"]);
  assert.equal(JSON.stringify(rule).includes("FAKE"),false);
  assert.throws(()=>engine.safeReportLayout({family:"open-ro",sheetName:"Unsafe",headerRow:0,columns},[]),/supported report family/);
  assert.throws(()=>engine.safeReportLayout({family:"trade-ar-errors",sheetName:"Receivables",headerRow:31,columns},[]),/header row/);
  assert.throws(()=>engine.safeReportLayout({family:"trade-ar-errors",sheetName:"Receivables",headerRow:0,
    columns:{...columns,open:"Paid"}},[]),/different source column/);
});

test("taught Trade AR sheet, header row, aliases and reordered columns reuse strict production validation",()=>{
  const begin=app.indexOf("/* MoonDog Paste & Learn — inert"),end=app.indexOf("})(globalThis);",begin);
  const engineContext={};vm.runInNewContext(app.slice(begin,end+14),engineContext);
  const mappings={store:"Location",customer:"Client Id",invoice:"Document Ref",invoiceDate:"Bill Date",
    days:"Age Days",status:"Follow-up Attempt",invoiceAmount:"Billed USD",received:"Paid USD",open:"Balance USD"};
  const rule=engineContext.MoonDogPasteLearn.safeReportLayout({family:"trade-ar-errors",
    sheetName:"Receivables Detail",headerRow:2,columns:mappings},[]);
  const fieldOrder=["invoice","store","days","customer","open","status","invoiceDate","received","invoiceAmount"];
  const values=source=>({
    store:source[arHeaders.indexOf("AN Store#")],customer:source[arHeaders.indexOf("Customer #")],
    invoice:source[arHeaders.indexOf("Invoice #")],invoiceDate:source[arHeaders.indexOf("Invoice Date")],
    days:source[arHeaders.indexOf("Actual Days Open")],status:source[arHeaders.indexOf("Status")],
    invoiceAmount:source[arHeaders.indexOf("Invoice Amount (USD)")],received:source[arHeaders.indexOf("Amount Received (USD)")],
    open:source[arHeaders.indexOf("Open Amount (USD)")]
  });
  const headers=fieldOrder.map(field=>mappings[field]);
  const reordered=source=>{const row=values(source);return fieldOrder.map(field=>row[field]);};
  const layoutRows=[["Synthetic report title"],[],headers,reordered(arRow({invoice:"FAKE-LAYOUT-1"})),
    reordered(arRow({invoice:"FAKE-LAYOUT-2",days:100,open:5}))];
  const book={SheetNames:["Cover","Receivables Detail"],Sheets:{
    Cover:{rows:[["Synthetic Cover"]]},
    "Receivables Detail":{rows:layoutRows,"!ref":"A1:I5"}
  }};
  const result=arHarness([], "101", {}, [rule], book).parse();
  assert.equal(result.metrics.invoiceCount,2);
  assert.equal(result.metrics.aging.under30,1);
  assert.equal(result.metrics.aging.days90plus,1);
  assert.equal(result.validation.otherStoreRowsExcluded,0);
  assert.equal(result.validation.learnedLayoutVersion,1);
  assert.equal(JSON.stringify(result).includes("FAKE-LAYOUT-1"),false);
});

test("learned worksheet percent formats are checked on that worksheet when a named Trade AR sheet is also present",()=>{
  const begin=app.indexOf("/* MoonDog Paste & Learn — inert"),end=app.indexOf("})(globalThis);",begin);
  const engineContext={};vm.runInNewContext(app.slice(begin,end+14),engineContext);
  const mappings={store:"Location",customer:"Client Id",invoice:"Document Ref",invoiceDate:"Bill Date",
    days:"Age Days",status:"Follow-up Attempt",invoiceAmount:"Billed USD",received:"Paid USD",open:"Balance USD"};
  const rule=engineContext.MoonDogPasteLearn.safeReportLayout({family:"trade-ar-errors",
    sheetName:"Receivables Detail",headerRow:2,columns:mappings},[]);
  const fieldOrder=["invoice","store","days","customer","open","status","invoiceDate","received","invoiceAmount"];
  const values=source=>Object.fromEntries(Object.entries({store:"AN Store#",customer:"Customer #",invoice:"Invoice #",
    invoiceDate:"Invoice Date",days:"Actual Days Open",status:"Status",invoiceAmount:"Invoice Amount (USD)",
    received:"Amount Received (USD)",open:"Open Amount (USD)"}).map(([key,heading])=>[key,source[arHeaders.indexOf(heading)]]));
  const source=arRow({invoice:"FAKE-MIXED-SHEET",open:5});
  const mapped=values(source),rows=[["Report"],[],fieldOrder.map(field=>mappings[field]),fieldOrder.map(field=>mapped[field])];
  const learned={rows,"!ref":"A1:I4",E4:{v:5,z:"0%",w:"10%"}};
  const mixed={SheetNames:["Trade AR Error Report","Receivables Detail"],Sheets:{
    "Trade AR Error Report":{rows:[["This named sheet is not a valid detail table"]]},
    "Receivables Detail":learned
  }};
  assert.throws(()=>arHarness([],"101",{},[rule],mixed).parse(),/percentage-formatted/);
});

test("explicit layout preview validates the selected sheet even when a valid canonical Trade AR sheet is also present",()=>{
  const begin=app.indexOf("/* MoonDog Paste & Learn — inert"),end=app.indexOf("})(globalThis);",begin);
  const engineContext={};vm.runInNewContext(app.slice(begin,end+14),engineContext);
  const mappings={store:"Location",customer:"Client Id",invoice:"Document Ref",invoiceDate:"Bill Date",
    days:"Age Days",status:"Follow-up Attempt",invoiceAmount:"Billed USD",received:"Paid USD",open:"Balance USD"};
  const rule=engineContext.MoonDogPasteLearn.safeReportLayout({family:"trade-ar-errors",
    sheetName:"Receivables  Detail",headerRow:2,columns:mappings},[]);
  const fieldOrder=["invoice","store","days","customer","open","status","invoiceDate","received","invoiceAmount"];
  const fields={store:"AN Store#",customer:"Customer #",invoice:"Invoice #",invoiceDate:"Invoice Date",
    days:"Actual Days Open",status:"Status",invoiceAmount:"Invoice Amount (USD)",
    received:"Amount Received (USD)",open:"Open Amount (USD)"};
  const raw=arRow({invoice:"FAKE-BUILTIN"});raw[arHeaders.indexOf("Invoice Date")]="invalid synthetic date";
  const mapped=fieldOrder.map(field=>{
    const builtInField=Object.keys(fields).find(key=>key===field);
    return raw[arHeaders.indexOf(fields[builtInField])];
  });
  const mixed={SheetNames:["Trade AR Error Report","Receivables  Detail"],Sheets:{
    "Trade AR Error Report":{rows:[arHeaders,arRow({invoice:"FAKE-CANONICAL"})]},
    "Receivables  Detail":{rows:[["Report"],[],fieldOrder.map(field=>mappings[field]),mapped],"!ref":"A1:I4"}
  }};
  assert.throws(()=>arHarness([],"101",{},[rule],mixed).parse(rule),
    /Trade AR aging, date, or money is unreadable/);
});

test("explicit taught retry imports the approved aggregate from the selected sheet, not built-in fallback data",()=>{
  const begin=app.indexOf("/* MoonDog Paste & Learn — inert"),end=app.indexOf("})(globalThis);",begin);
  const engineContext={};vm.runInNewContext(app.slice(begin,end+14),engineContext);
  const mappings={store:"Location",customer:"Client Id",invoice:"Document Ref",invoiceDate:"Bill Date",
    days:"Age Days",status:"Follow-up Attempt",invoiceAmount:"Billed USD",received:"Paid USD",open:"Balance USD"};
  const rule=engineContext.MoonDogPasteLearn.safeReportLayout({family:"trade-ar-errors",
    sheetName:"Receivables Detail",headerRow:2,columns:mappings},[]);
  const fieldOrder=["invoice","store","days","customer","open","status","invoiceDate","received","invoiceAmount"];
  const fields={store:"AN Store#",customer:"Customer #",invoice:"Invoice #",invoiceDate:"Invoice Date",
    days:"Actual Days Open",status:"Status",invoiceAmount:"Invoice Amount (USD)",
    received:"Amount Received (USD)",open:"Open Amount (USD)"};
  const toMapped=source=>{const row=Object.fromEntries(Object.entries(fields).map(([key,heading])=>[key,source[arHeaders.indexOf(heading)]]));return fieldOrder.map(field=>row[field]);};
  const mixed={SheetNames:["Trade AR Error Report","Receivables Detail"],Sheets:{
    "Trade AR Error Report":{rows:[arHeaders,arRow({invoice:"FAKE-CANONICAL",open:10})]},
    "Receivables Detail":{rows:[["Report"],[],fieldOrder.map(field=>mappings[field]),toMapped(arRow({invoice:"FAKE-SELECTED",open:999}))],"!ref":"A1:I4"}
  }};
  const harness=arHarness([],"101",{},[rule],mixed);
  const supplemental=section("  function parseSupplementalWorkbook(","  async function docxText(");
  const importContext={parseTradeArErrorWorkbook:harness.ctx.parseTradeArErrorWorkbook,
    parseOpenRoAgingByAsmWorkbook:()=>null,parseCashClearingWorkbook:()=>null,parseCreditHoldsWorkbook:()=>null,
    parseEmptyKnownWorkbook:()=>null};
  vm.runInNewContext(supplemental,importContext);
  const selected=importContext.parseSupplementalWorkbook([],"synthetic-report.xlsx",rule);
  const standard=importContext.parseSupplementalWorkbook([],"synthetic-report.xlsx");
  assert.equal(selected.metrics.openAmount,999);
  assert.equal(standard.metrics.openAmount,10,"ordinary import retains built-in canonical-sheet precedence");
  const retryAt=app.indexOf(`await processClassifiedCandidate(candidate,"supplemental-workbook"`),savedRuleAt=app.indexOf(",false,savedRule);",retryAt);
  assert.ok(retryAt>=0&&savedRuleAt>retryAt,"explicit retry passes the approved layout into production intake");
  assert.match(app,/importSupplementalSource\(candidate,kind,bytes,deleteAfterSuccess,layoutOverride\)/);
  assert.match(app,/parseSupplementalWorkbook\(bytes,candidate\.name,layoutOverride\)/);
});

test("successful taught retry clears only the matching local failure record after verified persistence",async()=>{
  const helper=section("  async function resolveLearnedFailureRecords(","  async function scanFailedLearnedSources(");
  let durable=null,failWrite=false;
  const context={AUTO_IMPORT_PATH:["data","auto-import.json"],structuredClone,
    now:()=>"2026-10-28T00:00:00Z",
    model:{autoImport:{seen:{
      failed:{fileName:"known.xlsx",storedAs:"known.xlsx",importFailed:true,failedAt:"2026-10-27"},
      unrelated:{fileName:"other.xlsx",storedAs:"other.xlsx",importFailed:true}
    }}},
    writeJson:async(_path,value)=>{if(failWrite)throw Error("synthetic metadata write failure");durable=JSON.parse(JSON.stringify(value));},
    readJson:async()=>durable};
  vm.runInNewContext(helper,context);
  await context.resolveLearnedFailureRecords("known.xlsx","Files To Learn/known.xlsx|20|123","supplemental-workbook");
  assert.equal(context.model.autoImport.seen.failed.importFailed,false);
  assert.equal(context.model.autoImport.seen.failed.failureResolvedAt,"2026-10-28T00:00:00Z");
  assert.equal(context.model.autoImport.seen.unrelated.importFailed,true);
  assert.equal(context.model.autoImport.seen["Files To Learn/known.xlsx|20|123"].kind,"supplemental-workbook");
  assert.deepEqual(JSON.parse(JSON.stringify(durable)),JSON.parse(JSON.stringify(context.model.autoImport)));
  failWrite=true;
  const before=JSON.stringify(context.model.autoImport);
  await assert.rejects(context.resolveLearnedFailureRecords("known.xlsx","retry|21|124","supplemental-workbook"),/synthetic metadata write failure/);
  assert.equal(JSON.stringify(context.model.autoImport),before,"failed read/write metadata proof rolls back approval state");
});

test("layout preview is local, uses production Trade AR validation, saves mappings in Workspace settings and retries retained source",()=>{
  assert.match(app,/Teach a known report layout/);
  assert.match(app,/Preview and validate/);
  assert.match(app,/saveLocalReportLayout/);
  assert.match(app,/updateLocalFuture\(future=>/);
  assert.match(app,/Retry this report/);
  assert.match(app,/await sha256\(currentBytes\)!==previewProof/);
  assert.match(app,/processClassifiedCandidate\(candidate,"supplemental-workbook"/);
  assert.match(app,/select\.addEventListener\("change",\(\)=>\{candidateRule=null;previewProof=null;savedRule=null;save\.disabled=true;retry\.disabled=true/);
  const validateAt=app.indexOf(`validate.addEventListener("click",()=>run(async()=>{`),resetAt=app.indexOf("candidateRule=null;previewProof=null;savedRule=null;save.disabled=true;retry.disabled=true;",validateAt),candidateAt=app.indexOf("const nextRule=engine.safeReportLayout",resetAt);
  assert.ok(validateAt>=0&&resetAt>validateAt&&candidateAt>resetAt,"failed revalidation must clear old approval before parsing");
  assert.match(app,/resolveLearnedFailureRecords\(source\.name,candidate\.signature,"supplemental-workbook"\)/);
  assert.match(app,/removeSourceEntryWithByteGuard\(source\.name,currentBytes/);
  assert.match(app,/assertTradeArLayoutSource\(previewBook,source\.name\)/);
  assert.match(app,/assertTradeArLayoutSource\(retryBook,source\.name\)/);
  const retryHandlerAt=app.indexOf(`retry.addEventListener("click",()=>run(async()=>{`),
    approvedAt=app.indexOf("const approvedRule=savedRule,approvedProof=previewProof",retryHandlerAt),
    controlsLockedAt=app.indexOf("controls.forEach(control=>control.disabled=true)",retryHandlerAt),
    firstAwaitAt=app.indexOf("await source.handle.getFile()",retryHandlerAt),
    importedAt=app.indexOf("false,approvedRule)",retryHandlerAt);
  assert.ok(retryHandlerAt>=0&&approvedAt>retryHandlerAt&&controlsLockedAt>approvedAt
    &&firstAwaitAt>controlsLockedAt&&importedAt>firstAwaitAt,
    "retry locks controls and carries the pre-await approved layout through persistence");
});
