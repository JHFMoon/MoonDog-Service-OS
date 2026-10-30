"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const freshnessSource=fs.readFileSync(path.join(__dirname,"..","assets","freshness.js"),"utf8");
function source(start,end){const a=app.indexOf(start),b=app.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return app.slice(a,b);}
const layoutStart=app.indexOf("  function matchingAppointmentActivityReportLayout(");
const layoutEnd=app.indexOf("  function normalizedPerson(",layoutStart);
assert.ok(layoutStart>=0&&layoutEnd>layoutStart,"production appointment layout code exists");
const parser=app.slice(layoutStart,layoutEnd);
const rulesStart=app.indexOf("  function localReportLayoutRules()");
const rulesEnd=app.indexOf("  async function saveLocalReportLayout(",rulesStart);
assert.ok(rulesStart>=0&&rulesEnd>rulesStart,"production private layout rules accessor exists");
const layoutRules=app.slice(rulesStart,rulesEnd);
const importer=source("  async function importManagerSource(","  async function classifyImportFile(");
const comparator=source("  function comparableManagerSnapshot(","  async function importManagerSource(");
const columns=["S. No.","Store Code","Store Name","ASD Market","ASD","Interaction","Customer No.",
  "First Name","Last Name","VIN","Make","Model","Year","Contacted Date",
  "Appt Creation Date","Appt Set Date","Appt Time","Appt Notes"];
const serialDate=n=>new Date(Date.UTC(1899,11,30)+n*86400000).toISOString().slice(0,10);
const row=(store,created,appt,interaction="SERVICE_REMINDER")=>{
  const result=Array(18).fill(null);
  result[1]=store;result[5]=interaction;result[7]="Synthetic Private First";
  result[8]="Synthetic Private Last";result[9]="SYNTHETIC-ONLY-NOT-VIN";
  result[14]=created;result[15]=appt;result[17]="Synthetic note must not persist";
  return result;
};
function fixture(rows,opts={}){
  const sourceRows=[columns,...rows];
  const removedSources=[];
  let durable={};
  const model={operationalMetrics:{},settings:{}};
  const ctx={
    text:v=>String(v??""),
    norm:v=>String(v??"").trim().toLowerCase(),
    now:()=>"2026-10-20T12:00:00.000Z",
    localDateKey:()=>opts.localDate||"2026-10-20",
    isoCell:v=>typeof v==="string"&&/^20\d{2}-\d{2}-\d{2}$/.test(v)?v:"",
    reportStoreCode:()=>"9001",
    XLSX:{utils:{sheet_to_json:sheet=>sheet.rows}},
    workbookGrid:(_bytes,preferred)=>{
      const book=opts.book||{SheetNames:["Merged"],Sheets:{Merged:{rows:opts.workbookRows||sourceRows}}};
      const sheet=book.Sheets[preferred]||book.Sheets[book.SheetNames[0]];
      return{book,rows:sheet.rows};
    },
    model,
    structuredClone,
    OPERATIONAL_METRICS_PATH:["data","operational-metrics.json"],
    sourceFileHandle:async()=>({getFile:async()=>({lastModified:opts.lastModified??Date.UTC(2026,9,20),arrayBuffer:async()=>new Uint8Array([1]).buffer})}),
    sameByteContent:(left,right)=>Array.from(new Uint8Array(left)).join(",")===Array.from(new Uint8Array(right)).join(","),
    sourceLocations:new Map(),xlsxSourceDeleteGuards:new Map(),
    parseSorWorkbook:()=>opts.sorSnapshot?structuredClone(opts.sorSnapshot):null,parseEfficiencyWorkbook:()=>null,
    parseMediaAsrAdvisorWorkbook:()=>null,parseMediaAsrTechWorkbook:()=>null,
    parseOpenRoSummaryWorkbook:()=>null,
    dailyEvidenceDate:(_family,snapshot)=>snapshot?.sourceModifiedAt?.slice(0,10)||"2026-10-20",
    internalObservationDate:()=>opts.observationDate||"",
    pruneDatedSnapshots:s=>s,
    learnTechnicians:()=>{},
    advisorDisplayName:x=>String(x),
    writeJson:async(_path,value)=>{durable=structuredClone(value);},
    readJson:async()=>structuredClone(durable),
    addHistory:async()=>{},
    removeSourceEntry:async name=>removedSources.push(name),
    ensurePreviousMonthSummary:async()=>{},renderAll:()=>{}
  };
  const layoutBegin=app.indexOf("/* MoonDog Paste & Learn — inert");
  const layoutFinish=app.indexOf("})(globalThis);",layoutBegin);
  assert.ok(layoutBegin>=0&&layoutFinish>layoutBegin,"production declarative layout validator exists");
  const layoutEngine=app.slice(layoutBegin,layoutFinish+"))(globalThis);".length);
  const dispatcher=source("  async function processClassifiedCandidate(","\n  async function reconcileLearnedFiles(");
  vm.runInNewContext(layoutEngine+parser+layoutRules+comparator+importer+dispatcher,ctx);
  return{parse:()=>ctx.parseAppointmentActivityWorkbook([],"synthetic-appointments.xlsx"),
    retry:rule=>ctx.processClassifiedCandidate({name:"synthetic-appointments.xlsx",location:"learn"},"appointment-activity",new Uint8Array([1]).buffer,false,rule),
    import:(deleteAfterSuccess=false,name="synthetic-appointments.xlsx")=>ctx.importManagerSource(name,"appointment-activity",[],deleteAfterSuccess),
    importSor:(deleteAfterSuccess=false,name="synthetic-sor.xlsx")=>ctx.importManagerSource(name,"sor",[],deleteAfterSuccess),
    setSorSnapshot(value){opts.sorSnapshot=value;},setLastModified(value){opts.lastModified=value;},
    setRows(rows){sourceRows.splice(0,sourceRows.length,columns,...rows);},setDurable(value){durable=value;},removed:()=>removedSources.slice(),ctx,model,durable:()=>durable};
}
test("private Appointment Activity layout maps a renamed sheet, header row, aliases and reordered columns through the production parser",async()=>{
  const headers=["Narrative","Activity Date","Store","Scheduled Time","Created","Interaction Type","Appointment Day","Private Customer"];
  const rows=[
    ["Synthetic context","2026-10-20","9001","9:00 AM",46310,"SERVICE_REMINDER",46312,"Synthetic customer must not persist"],
    ["Synthetic context","2026-10-20","1002","10:00 AM",46311,"SERVICE_REMINDER",46311,"Synthetic other store"]
  ];
  const book={SheetNames:["Daily Activity Export"],Sheets:{"Daily Activity Export":{rows:[
    ["Synthetic Appointment Activity export"],headers,...rows
  ]}}};
  const f=fixture([], {book}),engine=f.ctx.MoonDogPasteLearn;
  const rule=engine.safeReportLayout({family:"appointment-activity",sheetName:"Daily Activity Export",headerRow:1,
    columns:{storeCode:"Store",interaction:"Interaction Type",contactedDate:"Activity Date",
      apptCreationDate:"Created",apptSetDate:"Appointment Day",apptTime:"Scheduled Time"}},[]);
  f.model.settings.future={reportLayoutRules:[rule]};
  const preview=f.parse();
  assert.equal(preview.storeCode,"9001");
  assert.equal(preview.rowCount,1);
  assert.equal(preview.dailyCounts[serialDate(46310)].rowCount,1);
  assert.equal(preview.leadTimeBuckets.days1to7,1);
  assert.doesNotMatch(JSON.stringify(preview),/Synthetic customer|Synthetic context/);
  await f.import();
  assert.equal(Object.values(f.durable().appointmentActivity.snapshots)[0].rowCount,1,
    "saved local mapping is used by the regular production import route");
  assert.doesNotMatch(JSON.stringify(f.durable()),/Synthetic customer|Synthetic context/);
});
test("multiple matching private Appointment Activity layouts fail closed",async()=>{
  const rows=[["Store","Type","Contact Date","Created","Appointment","Time"],
    ["9001","SERVICE_REMINDER","2026-10-20",46310,46310,"9:00 AM"],
    ["1002","SERVICE_REMINDER","2026-10-20",46311,46311,"10:00 AM"]];
  const book={SheetNames:["First","Second"],Sheets:{First:{rows},Second:{rows}}};
  const f=fixture([], {book}),engine=f.ctx.MoonDogPasteLearn;
  const fields={storeCode:"Store",interaction:"Type",contactedDate:"Contact Date",
    apptCreationDate:"Created",apptSetDate:"Appointment",apptTime:"Time"};
  const one=engine.safeReportLayout({family:"appointment-activity",sheetName:"First",headerRow:0,columns:fields},[]);
  const two=engine.safeReportLayout({family:"appointment-activity",sheetName:"Second",headerRow:0,columns:fields},[one]);
  f.model.settings.future={reportLayoutRules:[one,two]};
  assert.throws(()=>f.parse(),/more than one local Appointment Activity layout/);
  await f.retry(one);
  const saved=Object.values(f.durable().appointmentActivity.snapshots)[0];
  assert.equal(saved.rowCount,1,"explicit retry imports the selected approved layout");
  assert.equal(saved.periodStart,serialDate(46310));
});
test("vendor serial dates and ISO dates produce separate verified store days",()=>{
  const d1=serialDate(46310),d2=serialDate(46312);
  const f=fixture([
    row("9001",46310,46310),row("1002",46311,46311),
    row("9001",46312,46319,"REPAIR_BOOKING"),
    row("1002",46312,46312)
  ]);
  const snapshot=f.parse();
  assert.equal(snapshot.storeCode,"9001");
  assert.equal(snapshot.rowCount,2);
  assert.equal(snapshot.periodStart,d1);
  assert.equal(snapshot.periodEnd,d2);
  assert.equal(snapshot.dailyCounts[d1].rowCount,1);
  assert.equal(snapshot.dailyCounts[d2].rowCount,1);
  assert.equal(snapshot.dailyCounts[d2].byInteraction.REPAIR_BOOKING,1);
  assert.equal(snapshot.leadTimeBuckets.sameDay,1);
  assert.equal(snapshot.leadTimeBuckets.days1to7,1);
  assert.equal(snapshot.validation.noInferredZeroDays,true);
  assert.doesNotMatch(JSON.stringify(snapshot),/Synthetic Private|SYNTHETIC-ONLY|Synthetic note/);
});
test("Excel Date cells retain their UTC civil day rather than Pacific previous day",()=>{
  const workbookDay=new Date("2026-10-20T00:00:00.000Z");
  const f=fixture([row("9001",workbookDay,workbookDay),row("1002","2026-10-19","2026-10-19")]);
  const snapshot=f.parse();
  assert.equal(snapshot.periodStart,"2026-10-20");
  assert.equal(snapshot.periodEnd,"2026-10-20");
  assert.equal(snapshot.dailyCounts["2026-10-20"].rowCount,1);
  assert.equal(snapshot.dailyCounts["2026-10-19"],undefined);
  assert.equal(snapshot.leadTimeBuckets.sameDay,1);
  assert.doesNotMatch(JSON.stringify(snapshot),/Synthetic Private|SYNTHETIC-ONLY|Synthetic note/);
});
test("invalid Date objects fail closed without persisting partial daily counts",()=>{
  const f=fixture([row("9001",new Date(NaN),"2026-10-20"),row("1002","2026-10-20","2026-10-20")]);
  assert.throws(()=>f.parse(),/unreadable appointment creation date/);
});
test("other-store-only dates never become fabricated local zero rows",()=>{
  const skipped=serialDate(46311);
  const s=fixture([row("9001",46310,46310),row("1002",46311,46311),row("9001",46312,46312)]).parse();
  assert.equal(Object.hasOwn(s.dailyCounts,skipped),false);
  assert.equal(s.rowCount,2);
  assert.equal(Object.values(s.dailyCounts).reduce((n,d)=>n+d.rowCount,0),s.rowCount);
});
test("import persists individually scoped daily observations and one overall aggregate",async()=>{
  const one=serialDate(46310),two=serialDate(46312);
  const f=fixture([row("9001",46310,46310),row("1002",46311,46311),row("9001",46312,46319)]);
  await f.import();
  const family=f.durable().appointmentActivity;
  assert.ok(family,"Appointment Activity was not durably saved");
  assert.equal(Object.keys(family.snapshots).length,1);
  assert.equal(Object.keys(family.dailySnapshots).length,2);
  assert.equal(family.dailySnapshots[one].periodStart,one);
  assert.equal(family.dailySnapshots[one].periodEnd,one);
  assert.equal(family.dailySnapshots[one].rowCount,1);
  assert.deepEqual(Object.keys(family.dailySnapshots[one].byCreationDate),[one]);
  assert.equal(family.dailySnapshots[two].rowCount,1);
  assert.equal(family.dailySnapshots[two].leadTimeBuckets.days1to7,1);
  assert.equal(family.dailySnapshots[one].dailyCounts,undefined,"Per-day snapshots must not clone all other days");
  assert.equal(family.dailySnapshots[serialDate(46311)],undefined,"Do not manufacture zero activity");
  assert.equal(family.snapshots[two].rowCount,2);
});

test("shared report comparison ignores derived metadata and canonicalizes maps for every guarded family",()=>{
  const f=fixture([]);
  const saved={period:"2026-10",coverageDate:"2026-10-20",sourceFile:"old.xlsx",importedAt:"2026-10-20T10:00:00Z",sourceModifiedAt:"2026-10-20T09:00:00Z",updatedAt:"first",rowCount:2,byInteraction:{SERVICE_REMINDER:1,REPAIR_BOOKING:1},byCreationDate:{"2026-10-19":1,"2026-10-20":1}};
  const reimported={period:"2026-10",coverageDate:"2026-10-21",sourceFile:"new (1).xlsx",importedAt:"2026-10-21T10:00:00Z",sourceModifiedAt:"2026-10-21T09:00:00Z",updatedAt:"second",rowCount:2,byInteraction:{REPAIR_BOOKING:1,SERVICE_REMINDER:1},byCreationDate:{"2026-10-20":1,"2026-10-19":1}};
  assert.equal(f.ctx.comparableManagerSnapshot(saved),f.ctx.comparableManagerSnapshot(reimported));
  assert.notEqual(f.ctx.comparableManagerSnapshot(saved),f.ctx.comparableManagerSnapshot({...reimported,rowCount:3}),"genuinely different report contents remain conflicting");
  const beforeLearning={periodStart:"2026-10-01",periodEnd:"2026-10-20",store:{clockHours:120,efficiency:0.9},technicians:[{name:"Synthetic Tech",number:null,clockHours:40}],unresolved:[{sourceName:"Synthetic Tech",reason:"No unique learned technician number"}]};
  const afterLearning={periodStart:"2026-10-01",periodEnd:"2026-10-20",store:{clockHours:120,efficiency:0.9},technicians:[{name:"Synthetic Tech",number:"9001",clockHours:40}],unresolved:[]};
  assert.equal(f.ctx.comparableManagerSnapshot(beforeLearning,"efficiency"),f.ctx.comparableManagerSnapshot(afterLearning,"efficiency"),"directory learning must not make unchanged Efficiency content conflict");
  assert.notEqual(f.ctx.comparableManagerSnapshot(beforeLearning,"efficiency"),f.ctx.comparableManagerSnapshot({...afterLearning,store:{clockHours:121,efficiency:0.9}},"efficiency"),"changed Efficiency measurements remain a conflict");
  const advisorBefore={periodEnd:"2026-10-20",advisors:{"101":{code:"101",name:"Display One",sourceName:"Source Name",gross:2500}}};
  const advisorAfter={...advisorBefore,advisors:{"101":{code:"101",name:"Display Two",sourceName:"Source Name",gross:2500}}};
  assert.equal(f.ctx.comparableManagerSnapshot(advisorBefore,"efficiency"),f.ctx.comparableManagerSnapshot(advisorAfter,"efficiency"),"configured display labels are not report content");
  assert.equal(f.ctx.comparableManagerSnapshot(advisorBefore,"openRoSummary"),f.ctx.comparableManagerSnapshot(advisorAfter,"openRoSummary"),"Open RO summary labels follow current settings and are not report content");
  assert.notEqual(f.ctx.comparableManagerSnapshot(advisorBefore,"efficiency"),f.ctx.comparableManagerSnapshot({...advisorAfter,advisors:{"101":{...advisorAfter.advisors["101"],gross:2600}}},"efficiency"),"advisor report measurements remain conflict-sensitive");
  assert.equal(f.ctx.managerConflictObservationDate("sor",{period:"2026-10",sourceModifiedAt:"2026-10-19T12:00:00Z"},[]),"2026-10-19","SOR conflict date follows the source modification date when there is no observation cell");
  assert.equal(f.ctx.managerConflictObservationDate("sor",{period:"2026-10",coverageDate:"2026-10-19"},[]),"2026-10-19","daily SOR conflicts are keyed by observation day");
});
test("conflicting same-period import preserves the saved source and leaves the new file for review",async()=>{
  const f=fixture([row("9001","2026-10-20","2026-10-20"),row("1002","2026-10-19","2026-10-19")]);
  await f.import(false);
  const before=f.durable();
  const period=f.parse().periodEnd;
  const prior=JSON.parse(JSON.stringify(before.appointmentActivity.snapshots[period]));
  f.setRows([row("9001","2026-10-20","2026-10-20","REPAIR_BOOKING"),row("1002","2026-10-19","2026-10-19")]);
  await assert.rejects(f.import(true),new RegExp("Conflicting appointment-activity report for period "+period+" is already saved"));
  assert.deepEqual(JSON.parse(JSON.stringify(f.durable())),JSON.parse(JSON.stringify(before)),"conflict must be rejected before durable data is overwritten");
  assert.deepEqual(JSON.parse(JSON.stringify(f.model.operationalMetrics.appointmentActivity.snapshots[period])),prior);
  assert.deepEqual(f.removed(),[],"the conflicting source must remain available for review");
});

test("future-dated rows do not suppress earlier verified daily snapshots",async()=>{
  const f=fixture([
    row("9001","2026-10-19","2026-10-19"),
    row("1002","2026-10-20","2026-10-20"),
    row("9001","2026-10-21","2026-10-21")
  ]);
  await f.import();
  const saved=f.durable().appointmentActivity;
  assert.equal(saved.snapshots["2026-10-21"].rowCount,2,"Report aggregate retains all verified configured-store days");
  assert.deepEqual(Object.keys(saved.dailySnapshots),["2026-10-19"]);
  assert.equal(saved.dailySnapshots["2026-10-19"].rowCount,1);
  assert.equal(saved.dailySnapshots["2026-10-21"],undefined,"Future daily observations must not be promoted early");
});
test("invalid selected-store dates are rejected rather than yielding partial totals",()=>{
  const f=fixture([row("9001",46310,46310),row("9001","bad date",46312),row("1002",46311,46311)]);
  assert.throws(()=>f.parse(),/unreadable appointment creation date/);
});
test("ambiguous source population without verified configured store fails closed",()=>{
  const f=fixture([row("1002",46310,46310),row("1003",46311,46311)]);
  assert.throws(()=>f.parse(),/store filtering could not be verified/);
});
test("source parser epoch is advanced only in verified app code",()=>{
  new vm.Script(app);
  assert.match(app,/const LEARNED_PARSER_REVISION = "strict-report-recognition-2026-10-29-auto-grouped-openro-v6"/);
});

test("identical report reimport ignores derived metadata, filename, and map insertion order",async()=>{
  const f=fixture([
    row("9001","2026-10-20","2026-10-20","SERVICE_REMINDER"),
    row("9001","2026-10-19","2026-10-19","REPAIR_BOOKING"),
    row("1002","2026-10-19","2026-10-19")
  ]);
  await f.import(false);
  const snapshots=f.durable().appointmentActivity.snapshots;
  const key=Object.keys(snapshots)[0],original=JSON.parse(JSON.stringify(snapshots[key]));
  // Derived coverage/provenance may drift; a browser may also rename a
  // duplicate download, and equivalent object maps may arrive in another order.
  const saved=f.durable();
  saved.appointmentActivity.snapshots[key].coverageDate="2026-10-18";
  saved.appointmentActivity.snapshots[key].sourceModifiedAt="2026-10-18T00:00:00.000Z";
  saved.appointmentActivity.snapshots[key].sourceFile="older-download.xlsx";
  saved.appointmentActivity.snapshots[key].importedAt="2026-10-18T00:00:00.000Z";
  f.setDurable(saved);
  Object.assign(f.model.operationalMetrics.appointmentActivity.snapshots[key],saved.appointmentActivity.snapshots[key]);
  f.setRows([
    row("9001","2026-10-19","2026-10-19","REPAIR_BOOKING"),
    row("1002","2026-10-19","2026-10-19"),
    row("9001","2026-10-20","2026-10-20","SERVICE_REMINDER")
  ]);
  await f.import(true,"synthetic-appointments (1).xlsx");
  const reimported=f.durable().appointmentActivity.snapshots[key];
  assert.equal(reimported.coverageDate,key,"coverage metadata is normalized to the canonical report period");
  assert.equal(reimported.sourceFile,"synthetic-appointments (1).xlsx");
  assert.equal(reimported.rowCount,original.rowCount);
  assert.equal(reimported.periodStart,original.periodStart);
  assert.equal(reimported.periodEnd,original.periodEnd);
  assert.deepEqual(JSON.parse(JSON.stringify(reimported.byInteraction)),original.byInteraction);
  assert.deepEqual(JSON.parse(JSON.stringify(reimported.byCreationDate)),original.byCreationDate);
  assert.deepEqual(f.removed(),["synthetic-appointments (1).xlsx"]);
});


test("future SOR conflicts fall back to the matching monthly snapshot before any mutation",async()=>{
  const original={period:"2026-10",date:"2026-10-23",store:{gross:100},advisors:{}};
  const f=fixture([],{localDate:"2026-10-22",lastModified:Date.UTC(2026,9,23),sorSnapshot:original});
  await f.importSor(false,"synthetic-sor.xlsx");
  const before=f.durable();
  assert.equal(before.sor.dailySnapshots?.["2026-10-23"],undefined,"future source coverage intentionally has no daily projection yet");
  assert.ok(before.sor.snapshots["2026-10"],"future SOR report is retained under its monthly key");
  f.setSorSnapshot({...original,store:{gross:200}});
  await assert.rejects(f.importSor(true,"synthetic-conflicting-sor.xlsx"),/Conflicting sor report for period 2026-10-23 is already saved/);
  assert.deepEqual(JSON.parse(JSON.stringify(f.durable())),JSON.parse(JSON.stringify(before)),"monthly prior and operational data remain unchanged");
  assert.deepEqual(f.removed(),[],"conflicting future SOR source remains available for review");
});


test("identical SOR reimport normalizes derived dates and provenance while changed same-day content remains protected",async()=>{
  const original={period:"2026-10",date:"2026-10-20",store:{gross:100,clockHours:10},advisors:{
    "101":{name:"Synthetic Advisor One",gross:60},
    "102":{name:"Synthetic Advisor Two",gross:40}
  }};
  const reordered={period:"2026-10",date:"2026-10-20",store:{gross:100,clockHours:10},advisors:{
    "102":{name:"Synthetic Advisor Two",gross:40},
    "101":{name:"Synthetic Advisor One",gross:60}
  }};
  const f=fixture([],{localDate:"2026-10-22",lastModified:Date.UTC(2026,9,20),
    observationDate:"2026-10-20",sorSnapshot:original});
  await f.importSor(false,"synthetic-sor.xlsx");
  const saved=structuredClone(f.durable());
  for(const snapshot of [saved.sor.snapshots["2026-10"],saved.sor.dailySnapshots["2026-10-20"]]){
    snapshot.coverageDate="2026-10-19";
    snapshot.sourceModifiedAt="2026-10-19T08:00:00.000Z";
    snapshot.importedAt="2026-10-19T08:05:00.000Z";
    snapshot.sourceFile="older-synthetic-copy.xlsx";
    snapshot.updatedAt="older-derived-metadata";
  }
  f.setDurable(saved);
  f.model.operationalMetrics=structuredClone(saved);
  f.setLastModified(Date.UTC(2026,9,21));
  f.setSorSnapshot(reordered);
  await f.importSor(true,"synthetic-sor (1).xlsx");
  const after=f.durable().sor;
  assert.equal(after.snapshots["2026-10"].coverageDate,"2026-10-20");
  assert.equal(after.dailySnapshots["2026-10-20"].coverageDate,"2026-10-20");
  assert.equal(after.snapshots["2026-10"].sourceModifiedAt,"2026-10-21T00:00:00.000Z");
  assert.deepEqual(after.snapshots["2026-10"].advisors,reordered.advisors);
  assert.deepEqual(f.removed(),["synthetic-sor (1).xlsx"]);

  const beforeConflict=structuredClone(f.durable());
  f.setSorSnapshot({...reordered,store:{...reordered.store,gross:101}});
  await assert.rejects(
    f.importSor(true,"synthetic-conflicting-sor.xlsx"),
    /Conflicting sor report for period 2026-10-20 is already saved/
  );
  assert.deepEqual(JSON.parse(JSON.stringify(f.durable())),JSON.parse(JSON.stringify(beforeConflict)),
    "changed same-day SOR values must fail before mutating monthly or daily snapshots");
  assert.deepEqual(f.removed(),["synthetic-sor (1).xlsx"],
    "the genuine conflict remains available for review");
});

test("overlapping Appointment Activity exports keep one daily projection per date",async()=>{
  const f=fixture([
    row("9001","2026-10-19","2026-10-19","SERVICE_REMINDER"),
    row("9001","2026-10-20","2026-10-20","REPAIR_BOOKING"),
    row("1002","2026-10-20","2026-10-20")
  ],{localDate:"2026-10-22"});
  await f.import(false,"synthetic-appointments-early.xlsx");
  assert.deepEqual(Object.keys(f.durable().appointmentActivity.dailySnapshots).sort(),
    ["2026-10-19","2026-10-20"]);

  f.setRows([
    row("9001","2026-10-20","2026-10-20","REPAIR_BOOKING"),
    row("9001","2026-10-21","2026-10-22","SERVICE_REMINDER"),
    row("1002","2026-10-21","2026-10-21")
  ]);
  await f.import(false,"synthetic-appointments-later.xlsx");

  const family=f.durable().appointmentActivity;
  assert.deepEqual(Object.keys(family.snapshots).sort(),["2026-10-20","2026-10-21"],
    "the distinct source reports remain available as separate snapshots");
  assert.deepEqual(Object.keys(family.dailySnapshots).sort(),
    ["2026-10-19","2026-10-20","2026-10-21"]);
  assert.equal(family.dailySnapshots["2026-10-20"].rowCount,1,
    "the overlap day remains one day-level observation instead of being added twice");
  assert.equal(family.dailySnapshots["2026-10-20"].sourceFile,"synthetic-appointments-later.xlsx");
  assert.equal(Object.values(family.dailySnapshots).reduce((sum,snapshot)=>sum+snapshot.rowCount,0),3);
  assert.equal(Object.values(family.snapshots).reduce((sum,snapshot)=>sum+snapshot.rowCount,0),4,
    "report totals overlap and must not be treated as unique appointment totals");
  assert.doesNotMatch(JSON.stringify(family),/SYNTHETIC-ONLY-NOT-VIN|Synthetic Private|Synthetic note/,
    "row-level customer-like fields are never retained");
});


test("verified Appointment Activity period and aggregate remain aligned in the Home source card after durable reload",async()=>{
  const f=fixture([
    row("9001","2026-10-19","2026-10-20","SERVICE_REMINDER"),
    row("9001","2026-10-20","2026-10-21","REPAIR_BOOKING"),
    row("1002","2026-10-19","2026-10-19")
  ]);
  await f.import();
  const durable=structuredClone(f.durable());
  assert.equal(durable.appointmentActivity.snapshots["2026-10-20"].rowCount,2);

  const grid={children:[],replaceChildren(...items){this.children=[...items];},append(item){this.children.push(item);}};
  f.ctx.model.operationalMetrics=durable;
  f.ctx.ui={managerSourceGrid:grid};
  f.ctx.document={createElement:()=>({className:"",textContent:"",children:[],append(...items){this.children.push(...items);}})};
  f.ctx.businessTimeZone=()=>"UTC";
  // Other Home source families are intentionally absent from this fixture.
  f.ctx.latestOperationalSnapshot=()=>null;
  vm.runInContext(freshnessSource,f.ctx);
  f.ctx.freshness=f.ctx.MoonDogFreshness;
  const productionLineage=source("  function sourceExpectation(key)","  function sourceAvailable(")+
    source("  function sourceFreshness(key, options = {}) {","  function metricDependencyEvidence(")+
    source("  function sourceStatusLabel(evidence)","  // Source coverage and local import time describe DIFFERENT facts.")+
    source("  function sourceLineageLabel(evidence) {","  function advisorNextWin(");
  const managerRenderer=source("  function latestFamily(family) {","  function renderAll() {");
  vm.runInContext(productionLineage+managerRenderer,f.ctx);
  const activity=durable.appointmentActivity.snapshots["2026-10-20"];
  const evidence=f.ctx.sourceFreshness("appointmentActivity",{item:activity});
  assert.equal(evidence.reportPeriodVerified,true,"production freshness must verify the saved report period");
  assert.equal(evidence.periodStart,"2026-10-19");
  assert.equal(evidence.periodEnd,"2026-10-20");
  assert.equal(evidence.importTimestamp,activity.importedAt,"production lineage uses the durable import timestamp");
  f.ctx.renderManagerIntelligence();

  const text=node=>[node.textContent,...(node.children||[]).map(text)].filter(Boolean).join(" ");
  const card=grid.children.find(item=>text(item).includes("APPOINTMENT ACTIVITY"));
  assert.ok(card,"Home must render the Appointment Activity source card from reloaded operational metrics");
  assert.match(text(card),/2 configured-store records/);
  assert.match(text(card),/2026-10-19 through 2026-10-20 · aggregate only/);
  assert.match(text(card),/Report period: 2026-10-19 through 2026-10-20 · Last imported: 2026-10-20 12:00 UTC/,
    "Home lineage is produced by the real freshness and lineage selectors");
  assert.doesNotMatch(text(card),/Synthetic Private|SYNTHETIC-ONLY-NOT-VIN|Synthetic note/,
    "the Home source lineage remains aggregate-only and excludes customer-like report cells");
});
