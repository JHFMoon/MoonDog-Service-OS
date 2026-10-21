"use strict";
// Synthetic grouped Open RO source safety proof. No real dealer, RO, VIN or staff data.
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf("  function strictOpenRoDate(");
const end=app.indexOf("  async function scanFiles(",start);
assert.ok(start>=0&&end>start,"Grouped Open RO source validation moved; review the test");
const source=app.slice(start,end);
const roHeader=[null,"RO","TAG-NO","OPEN-DATE","RO-CNT","DAYS","CUSTOMERNAME","STATUS",
  "TYPES","PTS-SALE-AMT","CPLBRSALE","IPLBRSALE","WPLBRSALE"];
const item=(ro,opened=46300,status="WORKING")=>
  [null,ro,"TAG",opened,null,1,"Synthetic Customer",status,"C",0,100,0,0];
function example(){
  return [
    ["SVCADV : 101 (2 items)"],
    [null,"REPORT OF OPEN ROS BY ADVISOR - 4 Rows Returned"],
    roHeader,
    item(10001),
    item("WEB*99",null,""),
    ["SVCADV : 999 (1 items)"],
    [null,"REPORT OF OPEN ROS BY ADVISOR - 4 Rows Returned"],
    roHeader,
    item(10003),
    ["SVCADV : 102 (1 items)"],
    [null,"REPORT OF OPEN ROS BY ADVISOR - 4 Rows Returned"],
    roHeader,
    item(10002,46301,"PREASSIGNED")
  ];
}
function parser(rows,opts={}){
  let identityCalls=0;
  const book={SheetNames:["Synthetic"],Sheets:{Synthetic:{rows}}};
  const context=vm.createContext({
    XLSX:{utils:{sheet_to_json:s=>s.rows}},
    text:v=>v==null?"":String(v),
    norm:v=>String(v??"").toLowerCase().replace(/\s+/g," ").trim(),
    workbookDate:v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)?v:
      typeof v==="string"&&/^\d{1,2}\/\d{1,2}\/20\d{2}$/.test(v)?
        v.split("/").reverse().join("-"):null,
    validCoverageDate:v=>{
      const s=String(v??"");
      if(!/^20\d{2}-\d{2}-\d{2}$/.test(s))return"";
      const d=new Date(s+"T12:00:00Z");
      return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===s?s:"";
    },
    ADVISOR_NAMES:opts.names||{"101":"Synthetic Advisor One","102":"Synthetic Advisor Two"},
    advisorDisplayName:code=>"Synthetic Advisor "+code,
    ALIASES:{technician:[],technicianCode:[]},sourceFieldValue:()=>"",
    reconcileRecordSourceIdentity:()=>{identityCalls++;},
    stableId:row=>"synthetic-"+row.ro
  });
  vm.runInContext(source,context);
  return{read:()=>context.legacyReport(book),identityCalls:()=>identityCalls};
}
test("complete grouped source reconciles 4 rows; keeps tracked ROs, WEB pseudo row and untracked advisor isolated",()=>{
  const f=parser(example()),r=f.read();
  assert.equal(r.sourceRows,4);
  assert.equal(r.records.length,2);
  assert.equal(r.workloadRecords.length,3);
  assert.equal(r.nonRoRowsExcluded,1);
  assert.equal(r.untrackedAdvisorRowsExcluded,1);
  assert.equal(r.advisorSections,3);
  assert.equal(r.records[0].opened,"2026-10-05");
  assert.equal(r.records[1].advisorCode,"102");
  assert.ok(r.records.every(row=>row.advisorCode!=="999"));
  assert.equal(f.identityCalls(),2);
});
test("missing one item from declared section rejects before returning any population",()=>{
  const rows=example();rows.splice(3,1);
  assert.throws(()=>parser(rows).read(),/declared 2 rows but contained 1/);
});
test("contradictory global row totals reject instead of closing absent live ROs",()=>{
  const rows=example().map(row=>[...row]);
  rows.filter(row=>String(row[1]??"").includes("Rows Returned"))
    .forEach(row=>row[1]="REPORT OF OPEN ROS BY ADVISOR - 5 Rows Returned");
  assert.throws(()=>parser(rows).read(),/global and advisor counts/);
});
test("missing group item counts cannot silently produce incomplete source",()=>{
  const rows=example();rows[0]=["SVCADV : 101"];
  assert.throws(()=>parser(rows).read(),/section count is missing/);
});
test("duplicate RO appearing under two advisors fails closed",()=>{
  const rows=example();rows[12]=item(10001,46301);
  assert.throws(()=>parser(rows).read(),/duplicate RO/);
});
test("report with missing opening date or source status is rejected",()=>{
  const rows=example();rows[3]=item(10001,"not a date");
  assert.throws(()=>parser(rows).read(),/date or source status/);
  const rows2=example();rows2[3]=item(10001,46300,"");
  assert.throws(()=>parser(rows2).read(),/date or source status/);
});
test("duplicate advisor group, detail header drift, or absent global total fails",()=>{
  const rows=example();rows[9]=["SVCADV : 101 (1 items)"];
  assert.throws(()=>parser(rows).read(),/duplicate Open RO advisor section/);
  const rows2=example();rows2[2]=[null,"RO","TAG-NO","OPEN-DATE"];
  assert.throws(()=>parser(rows2).read(),/detail headers changed/);
  const rows3=example().filter(row=>!String(row[1]??"").includes("Rows Returned"));
  assert.throws(()=>parser(rows3).read(),/population total is missing/);
});
test("source must not promote a WEB pseudo-RO to an active RO record",()=>{
  const r=parser(example()).read();
  assert.ok(!r.records.some(row=>String(row.ro).startsWith("WEB*")));
  assert.equal(r.records.length+r.nonRoRowsExcluded+r.untrackedAdvisorRowsExcluded,r.sourceRows);
});
test("source remains syntactically valid and parser epoch reflects recognition revision",()=>{
  new vm.Script(app);
  assert.match(app,/strict-report-recognition-2026-10-21-ro-groups/);
});
