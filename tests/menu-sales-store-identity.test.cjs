"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const freshness=require("../assets/freshness.js");
const { hydrateWorkspace, backupFunctions }=require("./helpers/workspace-source-roundtrip.cjs");
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
  code="9001",brand="",ids=[],rows=[],parameters=params,reportConfig={}}={}){
  const model={settings:{store:{name,code,brand},storeName:name}};
  const sourceAdapter={reports:reportConfig};
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
test("overlapping advisor codes never identify another dealership",()=>{
  const {parseMenuSalesWorkbook}=prepare({name:"Unmatched configured name",ids:["3001","3002"],rows:reportRows()});
  assert.throws(()=>parseMenuSalesWorkbook([],"synthetic-menu.xlsx"),/could not be verified against Guided Setup/);
});
test("an explicit vendor account alias must be bound to Guided Setup name and code",()=>{
  const config={menuSales:{accountName:cdjr,storeIdentityVerified:true,
    guidedSetupStoreCode:"9001",guidedSetupStoreName:"BMW Exampletown",guidedSetupStoreBrand:"BMW"}};
  const bad=prepare({name:"BMW Exampletown",brand:"BMW",ids:["3001","3002"],rows:reportRows(),
    reportConfig:{menuSales:{...config.menuSales,guidedSetupStoreCode:"1010"}}});
  assert.throws(()=>bad.parseMenuSalesWorkbook([],"synthetic-menu.xlsx"),/alias is not verified/);
  const good=prepare({name:"BMW Exampletown",brand:"BMW",ids:["3001","3002"],rows:reportRows(),reportConfig:config});
  const selected=good.parseMenuSalesWorkbook([],"synthetic-menu.xlsx");
  assert.equal(selected.account,cdjr);
  assert.equal(selected.validation.storeIdentityMethod,"configured-store-name");
});
test("Menu Sales vendor account aliases reject branded dealership identity drift",()=>{
  const alias={accountName:cdjr,storeIdentityVerified:true,
    guidedSetupStoreName:"Exampletown Motors",guidedSetupStoreCode:"9001",guidedSetupStoreBrand:"Dodge"};
  const setup=brand=>prepare({name:"Exampletown Motors",code:"9001",brand,
    ids:["3001"],rows:reportRows(),reportConfig:{menuSales:alias}});
  assert.equal(setup("dODGE").parseMenuSalesWorkbook([],"synthetic-menu.xlsx").account,cdjr);
  assert.throws(()=>setup("BMW").parseMenuSalesWorkbook([],"synthetic-menu.xlsx"),/alias is not verified/);
  assert.throws(()=>setup("").parseMenuSalesWorkbook([],"synthetic-menu.xlsx"),/alias is not verified/);
  const missingBrand=prepare({name:"Exampletown Motors",code:"9001",brand:"Dodge",
    ids:["3001"],rows:reportRows(),reportConfig:{menuSales:{...alias,guidedSetupStoreBrand:""}}});
  assert.throws(()=>missingBrand.parseMenuSalesWorkbook([],"synthetic-menu.xlsx"),/alias is not verified/);
});
test("two blank brands are never valid Menu Sales vendor alias proof",()=>{
  const alias={accountName:cdjr,storeIdentityVerified:true,
    guidedSetupStoreCode:"9001",guidedSetupStoreName:"Exampletown Motors",guidedSetupStoreBrand:""};
  const candidate=prepare({name:"Exampletown Motors",code:"9001",brand:"",
    ids:["3001"],rows:reportRows(),reportConfig:{menuSales:alias}});
  assert.throws(()=>candidate.parseMenuSalesWorkbook([],"synthetic-menu.xlsx"),/alias is not verified/);
});
test("same workbook does not select another dealership's rows on a fresh store",()=>{
  const dodge=prepare({name:"AutoNation Chrysler Dodge Jeep Ram Exampletown",code:"9001",ids:["3001"],rows:reportRows()});
  const bmw=prepare({name:"Different Brand Exampletown",code:"7007",ids:["3001","1001"],rows:reportRows()});
  assert.equal(dodge.parseMenuSalesWorkbook([],"synthetic-menu.xlsx").account,cdjr);
  assert.equal(bmw.parseMenuSalesWorkbook([],"synthetic-menu.xlsx").account,other);
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
  assert.match(app,/menu-sales-v3-local-layout-store-identity/);
  assert.match(app,/strict-report-recognition-2026-11-04-efficiency-store-sections-v12/);
  assert.doesNotMatch(parser,/ROSEVILLE|HAYWARD|FREMONT|SAN JOSE/i);
});

test("Menu Sales keeps source scope and report period aligned across history, backup, Home and Meeting", async () => {
  const context=prepare({ids:["1001","3001"],rows:reportRows()});
  const model=context.model;
  model.settings.schemaVersion=4;
  Object.assign(model,{
    root:{},state:{records:[{id:"shared-ro"}],closedRecords:[]},
    appointments:{days:{}},performance:{snapshots:{}},assignNext:{days:{}},
    autoImport:{seen:{}},operationalMetrics:{csi:{},menu:{snapshots:{}}},meetingCycle:{metrics:{}},
  });
  let durable;
  const history=[];
  Object.assign(context,{
    structuredClone,freshness,localDateKey:()=>"2026-10-20",
    OPERATIONAL_METRICS_PATH:["data","operational-metrics.json"],
    pruneDatedSnapshots:value=>value,
    writeJson:async(_path,value)=>{durable=JSON.stringify(value);},
    readJson:async()=>JSON.parse(durable),
    addHistory:async(type,summary,details)=>history.push({type,summary,details}),renderOverviewIntelligence:()=>{},
    sourceExpectation:()=>"recommended",businessTimeZone:()=>"America/Los_Angeles",
    expectedMenuWeek:()=>"2026-10-19",metricEvidence:value=>value,
  });
  const section=(first,last)=>{
    const start=app.indexOf(first),end=app.indexOf(last,start+first.length);
    assert.ok(start>=0&&end>start,first);
    return app.slice(start,end);
  };
  const importMenu=vm.runInNewContext(
    section("  async function importMenuSalesFile(","  const CSI_ADVISOR_CODES =")+"\nimportMenuSalesFile",context);
  await importMenu("synthetic-menu.xlsx",false,new Uint8Array([1]));
  assert.deepEqual(history.map(entry=>entry.type),["menu-sales-import"]);
  assert.deepEqual(JSON.parse(JSON.stringify(history[0].details)),{fileName:"synthetic-menu.xlsx",periodStart:"2026-10-01",
    periodEnd:"2026-10-18",advisors:1},
  "import history attributes the saved source to the same validated report interval");
  const archive=backupFunctions(app,model,"2026-10-20");
  const {bytes}=await archive.createBackupBytes("Synthetic Menu Sales");
  const {values}=await archive.validateBackupBytes(bytes);
  assert.equal(JSON.stringify(values["data/operational-metrics.json"]),durable);
  const files=new Map(Object.entries(values).map(([name,value])=>[name,JSON.stringify(value)]));
  const restored=await hydrateWorkspace(app,files,{});
  const snapshot=restored.operationalMetrics.menu.snapshots["2026-10-19"];
  assert.equal(snapshot.account,cdjr);
  assert.equal(snapshot.advisors["1001"],undefined);
  assert.equal(snapshot.advisors["3001"].roCount,20);
  restored.settings={csiPeriodStart:"2026-10-01",setup:{sourceExpectations:{}}};
  context.model=restored;
  context.latestOperationalSnapshot=()=>snapshot;
  const homeUi=Object.fromEntries([
    "moondogNeeds","nextAppointmentsSummary","nextAppointmentsCoverage",
    "virSummary","virCoverage","menuSummary","menuCoverage","csiSummary","csiCoverage"
  ].map(name=>[name,{textContent:"",children:[],append(...items){this.children.push(...items);},
    replaceChildren(...items){this.children=[...items];}}]));
  const homeContext=vm.createContext({
    ui:homeUi,model:restored,freshness,localDateKey:()=>"2026-10-20",
    businessTimeZone:()=>"America/Los_Angeles",expectedMenuWeek:()=>"2026-10-19",
    sourceExpectation:()=>"recommended",text:value=>String(value??""),
    document:{createElement:()=>({textContent:"",children:[],append(...items){this.children.push(...items);},
      replaceChildren(...items){this.children=[...items];}})},
    latestNextAppointmentsSnapshot:()=>null,latestVirObservation:()=>null,
    renderAdminCloseoutAttention:()=>{},renderTrendCoverageSummary:()=>{},
    renderPreviousMonthTotals:()=>{},managerAttentionRequests:()=>[],
    trendCoverageAudit:()=>({}),currentCsiSurveys:()=>({}),latestCsiRefreshDate:()=>"",
    npsSummary:()=>({responses:0}),reportNeeds:()=>({}),sourceLineageLabel:()=>"synthetic lineage",
    standard:()=>NaN,performanceFormat:value=>String(value),shortDate:value=>String(value||"—")
  });
  const freshnessHelpers=section("  function sourceFreshness(","  function metricDependencyEvidence(");
  const metricHelpers=section("  function metricEvidence({","  function metricEvidenceText(");
  const snapshotHelpers=section("  function latestOperationalSnapshot(","  function csiReportedPeriod(");
  const menuHelpers=section("  function verifiedMenuTrendReleases(","  function trendCoverageAudit(")+
    section("  function menuMeetingEvidence(metric)","  function csiMetricEvidence(");
  const homeRenderer=section("  function renderOverviewIntelligence() {",
    "  const renderOverviewIntelligenceBase=renderOverviewIntelligence;");
  vm.runInContext(freshnessHelpers+metricHelpers+snapshotHelpers+menuHelpers+homeRenderer+
    "\nthis.renderActualHome=renderOverviewIntelligence;",homeContext);
  homeContext.renderActualHome();
  const nodeText=node=>[node.textContent,...(node.children||[]).map(nodeText)].filter(Boolean).join(" ");
  const homeMenuText=nodeText(homeUi.menuSummary);
  assert.match(homeMenuText,/Presentation/);
  assert.match(homeMenuText,/70\.0%/,"Home must render the retained configured-store total");
  assert.match(homeUi.menuCoverage.textContent,/2026-10-01 through 2026-10-18 · release week 2026-10-19/,
    "Home must use the same report period and release week saved by the importer");
  assert.equal(JSON.stringify(restored.operationalMetrics.menu.snapshots["2026-10-19"]),JSON.stringify(snapshot),
    "rendering Home leaves the hydrated source authority unchanged");
  const meeting=vm.runInNewContext(
    section("  function verifiedMenuTrendReleases(","\n  function ")+
    section("  function sourceFreshness(","  function metricDependencyEvidence(")+
    section("  function menuMeetingEvidence(","  function csiMetricEvidence(")+
    "\nmenuMeetingEvidence",context);
  const metric=meeting("presentation");
  assert.equal(metric.value,70);
  assert.equal(metric.period,"2026-10-19");
  assert.equal(metric.status,"verified");
});

test("overlapping synthetic stores retain separate Menu Sales and manager state through backup and reopen", async () => {
  const rows=reportRows();
  rows.splice(3,0,row(other,"3001","Overlapping Synthetic Advisor",10,.25,0,0));
  const installs=[
    prepare({name:"AutoNation Chrysler Dodge Jeep Ram Exampletown",code:"9001",brand:"Dodge",
      ids:["3001"],rows}),
    prepare({name:other,code:"7007",brand:"BMW",ids:["3001","1001"],rows})
  ];
  async function importAndRestore(context,index){
    const model=context.model;
    model.settings.schemaVersion=4;
    Object.assign(model,{
      root:{},state:{records:[{id:"shared-ro",ro:"SYN-301",advisorCode:"SYN-101",
        management:{owner:"Synthetic Manager "+index,status:"Waiting Parts",
          note:"Synthetic follow-up "+index,updatedAt:"2026-10-20T12:00:00Z"}}],closedRecords:[]},
      appointments:{days:{}},performance:{snapshots:{}},assignNext:{days:{}},
      autoImport:{seen:{}},operationalMetrics:{csi:{},menu:{snapshots:{}}},
      meetingCycle:{metrics:{}}
    });
    const durable=new Map(),history=[];
    Object.assign(context,{
      structuredClone,freshness,localDateKey:()=>"2026-10-20",
      OPERATIONAL_METRICS_PATH:["data","operational-metrics.json"],
      pruneDatedSnapshots:value=>value,
      writeJson:async(file,value)=>durable.set(file.join("/"),JSON.stringify(value)),
      readJson:async file=>{
        const saved=durable.get(file.join("/"));
        return saved===undefined?null:JSON.parse(saved);
      },
      addHistory:async(type,summary,details)=>history.push({type,summary,details}),
      renderOverviewIntelligence:()=>{},sourceExpectation:()=>"recommended",
      businessTimeZone:()=>"America/Los_Angeles",expectedMenuWeek:()=>"2026-10-19",
      metricEvidence:value=>value
    });
    const importSource=app.slice(
      app.indexOf("  async function importMenuSalesFile("),
      app.indexOf("  const CSI_ADVISOR_CODES =",app.indexOf("  async function importMenuSalesFile("))
    );
    const importMenu=vm.runInNewContext(importSource+"\nimportMenuSalesFile",context);
    await importMenu("synthetic-menu.xlsx",false,new Uint8Array([1]));
    const archive=backupFunctions(app,model,"2026-10-20");
    const {bytes}=await archive.createBackupBytes("Synthetic store "+index);
    const {values}=await archive.validateBackupBytes(bytes);
    const files=new Map(Object.entries(values).map(([name,value])=>[name,JSON.stringify(value)]));
    const restored=await hydrateWorkspace(app,files,{});
    return {model,restored,values,archive,history};
  }
  const [first,second]=await Promise.all(installs.map(importAndRestore));
  const firstSnapshot=first.restored.operationalMetrics.menu.snapshots["2026-10-19"];
  const secondSnapshot=second.restored.operationalMetrics.menu.snapshots["2026-10-19"];
  assert.equal(firstSnapshot.account,cdjr);
  assert.equal(secondSnapshot.account,other);
  assert.equal(firstSnapshot.advisors["3001"].roCount,20);
  assert.equal(firstSnapshot.advisors["3001"].sold,4);
  assert.equal(secondSnapshot.advisors["3001"].roCount,10);
  assert.equal(secondSnapshot.advisors["3001"].sold,0,
    "a verified zero remains zero in the second store's saved source");
  assert.equal(secondSnapshot.advisors["3001"].penetration,0);
  assert.equal(first.values["data/settings.json"].store.brand,"Dodge");
  assert.equal(second.values["data/settings.json"].store.brand,"BMW");
  assert.equal(first.restored.state.records[0].management.note,"Synthetic follow-up 0");
  assert.equal(second.restored.state.records[0].management.note,"Synthetic follow-up 1");
  assert.equal(first.history.length,1);
  assert.equal(second.history.length,1);
  const liveStateBeforeRejectedRestore=JSON.stringify(first.restored.state);
  assert.throws(()=>first.archive.verifyBackupStoreOwnership(
    first.model.settings,second.values["data/settings.json"],true),/Needs Review/);
  assert.equal(JSON.stringify(first.restored.state),liveStateBeforeRejectedRestore);
  assert.equal(first.archive.verifyBackupStoreOwnership(
    first.model.settings,first.values["data/settings.json"],true),true);

  const sourceFreshness=app.slice(
    app.indexOf("  function sourceFreshness("),
    app.indexOf("  function metricDependencyEvidence(",app.indexOf("  function sourceFreshness("))
  );
  const evidenceContext=vm.createContext({
    freshness,model:first.restored,sourceExpectation:()=>"recommended",
    businessTimeZone:()=>"America/Los_Angeles",localDateKey:()=>"2026-10-20"
  });
  const missing=vm.runInContext(sourceFreshness+
    "\nsourceFreshness('menu',{item:null,today:'2026-10-20'})",evidenceContext);
  assert.equal(missing.status,"missing");
  assert.equal(missing.loaded,false);
  assert.equal(missing.reportPeriodVerified,false,
    "an absent source in an independently reopened store cannot become verified zero");
});
