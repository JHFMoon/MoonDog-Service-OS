"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function section(start, end) {
  const a=app.indexOf(start), b=app.indexOf(end, a+start.length);
  assert.ok(a>=0 && b>a, "Production parser boundary missing: "+start);
  return app.slice(a,b);
}
const recognition = [
  section("  function strictOpenRoDate(", "  async function scanFiles("),
  section("  function parseOpenRoAgingByAsmWorkbook(", "  async function docxText("),
  section("  async function classifyImportFile(", "  async function moveToLearn(")
].join("\n");

const header=[null,"RO","TAG-NO","OPEN-DATE","RO-CNT","DAYS","CUSTOMERNAME",
  "STATUS","TYPES","PTS-SALE-AMT","CPLBRSALE","IPLBRSALE","WPLBRSALE"];
const detail=(ro,status="OPENED",open="2026-10-20")=>
  [null,ro,"SYNTHETIC-TAG",open,"1",1,"Synthetic name",status,"C",null,null,null,null];
const report=(change=()=>{})=>{
  const rows=[
    ["SVCADV : 101 (2 items)"],
    [null,"REPORT OF OPEN ROS BY ADVISOR - 3 Rows Returned"],
    header,
    detail("99001"),
    [null,"WEB*"],
    ["SVCADV : 202 (1 items)"],
    [null,"REPORT OF OPEN ROS BY ADVISOR - 3 Rows Returned"],
    header,
    detail("99002","WORKING")
  ];
  change(rows);
  return {SheetNames:["Synthetic Open ROs by ASM"],
    Sheets:{"Synthetic Open ROs by ASM":{rows}}};
};
function harness(book) {
  const XLSX={
    read:()=>book,
    utils:{sheet_to_json:sheet=>sheet.rows}
  };
  const text=v=>String(v??"");
  const ctx={
    XLSX,text,now:()=>"2026-10-21T12:00:00Z",
    norm:v=>text(v).trim().toLowerCase().replace(/\s+/g," "),
    validCoverageDate:v=>/^20\d{2}-\d{2}-\d{2}$/.test(String(v))?String(v):"",
    workbookDate:v=>typeof v==="string"?v:"",
    sourceFieldValue:()=>"",
    advisorDisplayName:code=>"Synthetic Advisor "+code,
    reconcileRecordSourceIdentity:()=>{},
    stableId:v=>"synthetic-"+v.ro,
    ADVISOR_NAMES:{"101":"Synthetic Advisor 101"},
    ALIASES:{technician:[],technicianCode:[]},
    workbookGrid:()=>({rows:book.Sheets[book.SheetNames[0]].rows}),
    workbookIsHandoff:()=>false,
    workbookHasReturnSchema:()=>false,
    workbookHasReturnIdentity:()=>false,
    parseCashClearingWorkbook:()=>null,
    parseCreditHoldsWorkbook:()=>null,
    parseEmptyKnownWorkbook:()=>null,
    parseCsiWorkbook:()=>{throw Error("no CSI source");},
    parseMenuSalesWorkbook:()=>{throw Error("no Menu source");},
    parsePerformanceWorkbook:()=>{throw Error("no SAPR source");},
    parseSorWorkbook:()=>{throw Error("no SOR source");},
    parseAppointmentActivityWorkbook:()=>{throw Error("no Appointment Activity source");},
    parseEfficiencyWorkbook:()=>{throw Error("no Efficiency source");},
    parseMediaAsrWorkbook:()=>{throw Error("no Media ASR source");},
    parseOpenRoSummaryWorkbook:()=>{throw Error("no aggregated WIP source");},
    parseSupplementalDocxReport:()=>null
  };
  vm.runInNewContext(recognition,ctx);
  const sourceFile={name:"synthetic-openro.xlsx"};
  return {
    classify:()=>ctx.classifyImportFile(sourceFile.name,sourceFile,new ArrayBuffer(2)),
    full:()=>ctx.legacyReport(book),
    aging:()=>ctx.parseOpenRoAgingByAsmWorkbook([],sourceFile.name)
  };
}

test("count-reconciled grouped report routes to primary Open RO, not supplemental aging",async()=>{
  const f=harness(report());
  const parsed=f.full();
  assert.equal(parsed.sourceRows,3);
  assert.equal(parsed.records.length,1);
  assert.equal(parsed.nonRoRowsExcluded,1);
  assert.equal(parsed.untrackedAdvisorRowsExcluded,1);
  assert.equal(parsed.verification,"group totals and global rows returned reconciled");
  assert.equal((await f.classify()),"open-ro");
  assert.equal(f.aging().family,"open-ro-advisor-aging",
    "The formerly shadowing supplemental detector still recognizes this report");
});

test("mismatched advisor population cannot promote to active Open ROs",async()=>{
  const f=harness(report(rows=>{rows[0][0]="SVCADV : 101 (3 items)";}));
  assert.throws(()=>f.full(),/declared 3 rows but contained 2/);
  assert.equal((await f.classify()),"supplemental-workbook");
});

test("duplicate RO identity cannot promote to active Open ROs",async()=>{
  const f=harness(report(rows=>{rows[8][1]="99001";}));
  assert.throws(()=>f.full(),/duplicate RO/);
  assert.equal((await f.classify()),"supplemental-workbook");
});

test("invalid grouped Open RO date cannot become active RO evidence",async()=>{
  const f=harness(report(rows=>{rows[3][3]="not-a-date";}));
  assert.throws(()=>f.full(),/date or source status is unreadable/);
  assert.equal((await f.classify()),"supplemental-workbook");
});

test("Service Daily Log appointment source is not misrouted as an Open RO roster",async()=>{
  const book={SheetNames:["Service Daily Log"],Sheets:{"Service Daily Log":{
    rows:[["Daily Summary"],[null,null,"SA","Time","Customer"],[null,null,"101","08:00","Synthetic"]]
  }}};
  assert.equal((await harness(book).classify()),"appointments");
});

test("parser epoch advanced and app remains syntax valid",()=>{
  new vm.Script(app);
  assert.match(app,/LEARNED_PARSER_REVISION = "strict-report-recognition-2026-10-22-xlsx-worker-compat"/);
});
