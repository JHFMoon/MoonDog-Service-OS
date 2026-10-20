"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const segment=(first,last)=>{const start=app.indexOf(first),end=app.indexOf(last,start+first.length);assert.ok(start>=0&&end>start,first+" / "+last);return app.slice(start,end);};
const text=value=>value==null?"":String(value);
const norm=value=>text(value).toLowerCase().replace(/\s+/g," ").trim();
const validCoverageDate=value=>/^20\d{2}-\d{2}-\d{2}$/.test(text(value))?text(value):"";
const strictReportDate=value=>{const m=text(value).match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);return m?m[3]+"-"+m[1].padStart(2,"0")+"-"+m[2].padStart(2,"0"):"";};
const csvNumber=value=>{const n=Number(text(value).replace(/[$,%\s,]/g,""));return text(value).trim()&&Number.isFinite(n)?n:null;};
const usDateToIso=strictReportDate;
function appointmentParser(rows) {
 const context={text,norm,validCoverageDate,strictReportDate,reportStoreCode:()=>"101",workbookGrid:()=>({rows}),now:()=>"2026-10-20T15:00:00Z"};
 vm.runInNewContext(segment("  function activityDateCell(","  function normalizedPerson(")+"\nthis.parse=parseAppointmentActivityWorkbook;",context);
 return context.parse(new Uint8Array([1]),"synthetic.xlsx");
}
const appointmentHeader=["S. No.","Store Code","Store Name","ASD Market","ASD","Interaction","Customer No.","First Name","Last Name","VIN","Make","Model","Year","Contacted Date","Appt Creation Date","Appt Set Date","Appt Time","Appt Notes","Remarks"];
const appointmentRow=(store,day,interaction="NEXT_SERVICE")=>[1,store,"Synthetic Store","TEST","TEST",interaction,"","","","","","","",day,day,day,"10:00","",""];
test("Appointment Activity partitions dates, filters only the configured store, and retains no identities",()=>{
 const snapshot=appointmentParser([appointmentHeader,appointmentRow("101",46310),appointmentRow("999",46310),appointmentRow("101",46311,"MAINTENANCE"),appointmentRow("999",46312)]);
 assert.equal(snapshot.rowCount,2);
 assert.equal(snapshot.periodStart,"2026-10-15");
 assert.equal(snapshot.periodEnd,"2026-10-17");
 assert.equal(snapshot.dailyCounts["2026-10-15"].rowCount,1);
 assert.equal(snapshot.dailyCounts["2026-10-16"].byInteraction.MAINTENANCE,1);
 assert.equal(snapshot.dailyCounts["2026-10-17"].rowCount,null);
 assert.equal(snapshot.validation.sourceStores,2);
 assert.equal(snapshot.validation.piiRowsNotRetained,4);
 assert.ok(!JSON.stringify(snapshot).includes("Synthetic Store"));
});
test("An otherwise valid multi-store report with no store rows is retained as unverified, never fabricated zero",()=>{
 const snapshot=appointmentParser([appointmentHeader,appointmentRow("999",46310),appointmentRow("888",46310)]);
 assert.equal(snapshot.rowCount,null);
 assert.equal(snapshot.scopeVerified,false);
 assert.equal(snapshot.validation.noStoreRows,true);
 assert.equal(snapshot.dailyCounts["2026-10-15"].rowCount,null);
});
test("Appointment Activity rejects structurally incomplete reports",()=>{
 assert.throws(()=>appointmentParser([appointmentHeader.slice(0,-4),appointmentRow("999",46310),appointmentRow("888",46310)]),/Appointment Activity/);
});
function menuParser(report,parameters){
 const book={Sheets:{"HyperBi Report":{rows:report},Parameters:{rows:parameters}}};
 const context={XLSX:{read:()=>book,utils:{sheet_to_json:s=>s.rows}},text,norm,csvNumber,configuredAdvisors:()=>[{number:"101"},{number:"102"}],advisorDisplayName:code=>"Advisor "+code,usDateToIso,validCoverageDate,mondayFor:()=> "2026-10-19",now:()=> "2026-10-20T15:00:00Z"};
 vm.runInNewContext(segment("  function parseMenuSalesWorkbook(","  async function importMenuSalesFile(")+"\nthis.parse=parseMenuSalesWorkbook;",context);
 return context.parse(new Uint8Array([1]),"menu-synthetic.xlsx");
}
const menuHead=["Account","Advisor \n Code","Advisor","ROs","% Presented","Sold","% Penetration","Menu $","Menu A la carte $","Total $","$/Menu","Hrs/Menu","# Prepaid"];
const menuRows=()=>[
 menuHead,
 ["SYNTHETIC ACCOUNT","101","Advisor One",10,0.8,2,0.2,100,0,100,50,1.0,0],
 ["SYNTHETIC ACCOUNT","102","Advisor Two",5,0.6,1,0.2,50,0,50,50,1.0,0],
 ["SYNTHETIC ACCOUNT",null,null,15,0.7333,3,0.2,150,0,150,50,1.0,0],
 ["OTHER ACCOUNT","999","Other",15,0.8,3,0.2,10,0,10,1,1.0,0]
];
const menuParameters=[[],["Ran Date/Time:","10/19/2026, 10:08 AM"],["Report:","MENU SALES - VMA+DMS (AutoNation)"],["Date range:","10/1/2026 - 10/18/2026"]];
test("Menu Sales identifies the account from configured codes, preserves presentation separately from penetration, and verifies rates",()=>{
 const snapshot=menuParser(menuRows(),menuParameters);
 assert.equal(snapshot.advisors["101"].presentation,80);
 assert.equal(snapshot.advisors["101"].penetration,20);
 assert.equal(snapshot.store.roCount,15);
 assert.equal(snapshot.periodEnd,"2026-10-18");
 assert.equal(snapshot.releaseWeek,"2026-10-19");
 assert.equal(snapshot.validation.storeReconciliationVerified,true);
});
test("Menu Sales rejects contradictions between sold units and penetration",()=>{
 const rows=menuRows();rows[1][6]=0.5;
 assert.throws(()=>menuParser(rows,menuParameters),/reconcile/);
});
function legacyParser(rows) {
 const book={SheetNames:["Synthetic Open RO"],Sheets:{"Synthetic Open RO":{rows}}};
 const context={XLSX:{utils:{sheet_to_json:s=>s.rows}},text,norm,validCoverageDate,strictReportDate,ADVISOR_NAMES:{"101":"Advisor One"},model:{settings:{advisors:{"102":{name:"Advisor Two"}}}},ALIASES:{technician:[],technicianCode:[]},sourceFieldValue:()=>"",reconcileRecordSourceIdentity:()=>{},stableId:item=>"ID-"+item.ro};
 vm.runInNewContext(segment("  function activityDateCell(","  function parseAppointmentActivityWorkbook(")+segment("  function legacyReport(","  async function scanFiles(")+"\nthis.parse=legacyReport;",context);
 return context.parse(book);
}
const roHeader=[null,"RO","TAG-NO","OPEN-DATE","RO-CNT","DAYS","CUSTOMERNAME","STATUS","TYPES","PTS-SALE-AMT","CPLBRSALE","IPLBRSALE","WPLBRSALE"];
const roRows=()=>[
 ["SVCADV : 101 (2 items)"],
 [null,"REPORT OF OPEN ROS BY ADVISOR    - 3  Rows Returned"],
 roHeader,
 [null,10001,"T01",46300,null,14,"","WORKING","C",0,100,0,0],
 [null,"WEB*99999","T02",null,null,null,null,null],
 ["SVCADV : 102 (1 items)"],
 [null,"REPORT OF OPEN ROS BY ADVISOR    - 3  Rows Returned"],
 roHeader,
 [null,10002,"T03",46301,null,13,"","PREASSIGNED","W",0,0,0,50]
];
test("Open RO advisor report reconciles declared 3 rows while excluding one WEB marker from 2 actionable ROs",()=>{
 const parsed=legacyParser(roRows());
 assert.equal(parsed.sourceRows,3);
 assert.equal(parsed.nonRoRowsExcluded,1);
 assert.equal(parsed.records.length,2);
 assert.equal(parsed.advisorSections,2);
 assert.equal(parsed.records[0].opened,"2026-10-05");
 assert.equal(parsed.records[1].advisorCode,"102");
 assert.equal(parsed.workloadRecords.length,2);
});
test("Open RO incomplete section cannot replace the active population",()=>{
 const rows=roRows();rows.splice(3,1);
 assert.throws(()=>legacyParser(rows),/expected 2 items/);
});
test("Open RO duplicate repair-order identities are rejected before mutation",()=>{
 const rows=roRows();rows[8][1]=10001;
 assert.throws(()=>legacyParser(rows),/duplicate RO/);
});
assert.match(app,/const LEARNED_PARSER_REVISION = "appointment-menu-openro-2026-10-20"/);
assert.match(app,/Appointment\.\?Activity/);
assert.match(app,/family==="appointmentActivity"&&snapshot\.dailyCounts/);
assert.match(app,/model\.operationalMetrics=prior;throw error/);
new vm.Script(app);
