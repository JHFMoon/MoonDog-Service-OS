"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const freshness=require("../assets/freshness.js");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function extract(first,last,label){
  const start=app.indexOf(first),end=app.indexOf(last,start+first.length);
  assert.ok(start>=0&&end>start,"Missing production "+label);
  return app.slice(start,end);
}
const ingestion=extract("  const CSI_ADVISOR_CODES = {};","  const isoCell =","CSI ingestion");
const evidence=extract("  function csiMetricEvidence(","  const rawVirMeetingEvidence=virMeetingEvidence","CSI evidence");
const lineageHelper=extract("  function sourceLineageLabel(evidence) {","  function advisorNextWin(","Source lineage helper");
const home=extract("  function renderOverviewIntelligence() {","  const renderOverviewIntelligenceBase=renderOverviewIntelligence","Home renderer");
const meeting=extract("  function meetingAdvisorTv(","  function renderMeetingArenaStore(","Meeting renderer");

function node(){
  return {textContent:"",className:"",children:[],
    replaceChildren(...items){this.children=[...items];},
    append(...items){this.children.push(...items);},
    setAttribute(){},remove(){}};
}
function textContent(value){
  if(value==null)return "";
  return String(value.textContent||"")+" "+(value.children||[]).map(textContent).join(" ");
}

test("synthetic CSI import keeps period and lineage aligned through durable storage, Home, Meeting, and history",async()=>{
  const csv=[
    "From,2026-10-01","To,2026-10-06",
    ["Invite_ID","_recordId","SURVEY_STATUS","INCLUDE_IN_SCORING","Date of Survey (-04:00 GMT)",
      "Service Advisor","Dealer NPS (Service)","Sales NPS Group (Service)","NPS: ServPulse","NPS Filter Group"].join(","),
    ["synthetic-survey-01","synthetic-pulse-01","Pulse Completed","Yes","2026-10-06",
      "Demo Advisor","10","Promoter","10","Promoter"].join(",")
  ].join("\n")+"\n";
  const model={settings:{csiPeriodStart:"2026-10-01"},operationalMetrics:{csi:{surveys:{},imports:[]}}};
  const ui=Object.fromEntries(["moondogNeeds","nextAppointmentsSummary","nextAppointmentsCoverage","virSummary",
    "virCoverage","menuSummary","menuCoverage","csiSummary","csiCoverage"].map(key=>[key,node()]));
  let durable=null;
  const history=[];
  const context=vm.createContext({
    model,ui,document:{createElement:()=>node()},structuredClone,
    OPERATIONAL_METRICS_PATH:["data","operational-metrics.json"],
    now:()=>"2026-10-07T15:00:00Z",localDateKey:()=>"2026-10-07",
    text:value=>value==null?"":String(value),norm:value=>String(value??"").trim().toLowerCase(),
    validCoverageDate:value=>/^20\d{2}-\d{2}-\d{2}$/.test(String(value||""))?value:"",
    strictReportDate:()=>"",csvNumber:value=>value===""?null:Number(value),
    parseCsv:value=>value.trimEnd().split(/\r?\n/).map(line=>line.split(",")),
    sourceFileHandle:async()=>({getFile:async()=>({text:async()=>csv})}),freshness,
    writeJson:async(_,value)=>{durable=structuredClone(value);},
    readJson:async()=>durable,
    addHistory:async(type,message,details)=>{history.push({type,message,details});},
    removeSourceEntry:async()=>{},renderAll:()=>{},renderMeeting:()=>{},
    currentCsiSurveys:()=>model.operationalMetrics.csi.surveys,
    latestCsiRefreshDate:()=>model.operationalMetrics.csi.lastSuccessfulRefreshDate,
    sourceFreshness:key=>({key,safeForCurrent:true,status:"current",
      sourceTimestamp:model.operationalMetrics.csi.lastSuccessfulRefreshAt,
      periodEnd:model.operationalMetrics.csi.imports.at(-1)?.scopeEnd||""}),
    sourceStatusLabel:()=>"CURRENT",
    reportNeeds:()=>({csi:{label:"CSI",state:"CURRENT",reason:"verified scope",actions:[]}}),
    latestNextAppointmentsSnapshot:()=>null,latestVirObservation:()=>null,
    managerAttentionRequests:()=>[],trendCoverageAudit:()=>({}),
    renderAdminCloseoutAttention:()=>{},renderTrendCoverageSummary:()=>{},renderPreviousMonthTotals:()=>{},
    metricEvidence:input=>({...input,verified:true}),
    metricDependencyEvidence:(_dependencies,base)=>({...base,verified:true}),
    shortDate:value=>value==="2026-10-06"?"Oct 6":String(value||""),
    latestOperationalSnapshot:()=>null,virObservationDate:()=>"2026-10-06",
    virMeetingEvidence:()=>({verified:false,status:"missing-source"}),
    menuMeetingEvidence:()=>({verified:false,status:"missing-source"}),
    standard:key=>key==="dealerNps"?90:100,
    performanceFormat:(value,kind)=>kind==="money"?"$"+String(Math.round(value)):String(value),
    compactMoney:value=>"$"+String(Math.round(value/1000))+"K",
    meetingEscape:value=>String(value),console
  });
  vm.runInContext(ingestion+"\n"+evidence+"\n"+lineageHelper+"\n"+home+"\n"+meeting+
    "\nthis.importCsiFile=importCsiFile;this.npsSummary=npsSummary;this.csiMetricEvidence=csiMetricEvidence;"+
    "this.renderHome=renderOverviewIntelligence;this.renderMeetingView=meetingAdvisorTv;",context);

  await context.importCsiFile("synthetic-csi.csv");
  const survey=model.operationalMetrics.csi.surveys["synthetic-survey-01"];
  assert.equal(survey.surveyDate,"2026-10-06");
  assert.equal(durable.csi.imports[0].scopeStart,"2026-10-01");
  assert.equal(durable.csi.imports[0].scopeEnd,"2026-10-06");
  assert.equal(durable.csi.imports[0].dailySummary.nps,100);
  assert.deepEqual(history.map(entry=>entry.type),["csi-import"]);
  assert.equal(history[0].details.fileName,"synthetic-csi.csv");
  assert.equal(history[0].details.scoringSurveys,1);

  context.renderHome();
  const summary=context.npsSummary(durable.csi.surveys);
  const lineage=context.csiMetricEvidence(summary);
  const homeCoverage=ui.csiCoverage.textContent;
  const homeSummary=textContent(ui.csiSummary);
  const meetingEvidenceCalls=[];
  const originalEvidence=context.csiMetricEvidence;
  context.csiMetricEvidence=input=>{
    const result=originalEvidence(input);
    meetingEvidenceCalls.push({input,result});
    return result;
  };
  const performance={totalGross:10000};
  performance["cp"+"Elr"]=200;
  performance["cp"+"Hours"]=2;
  performance["media"+"Viewed"]=80;
  performance["text"+"ing"]=90;
  const html=context.renderMeetingView("synthetic",{
    periodEnd:"2026-10-06",saprDaysCompleted:5,saprTotalDays:22,
    validation:{saprDaysVerified:true,finalTotalsVerified:true}
  },performance,{configured:false,remainingDays:10},{current:{missingDates:[]}},
  {label:"Synthetic next action"},summary);

  assert.equal(summary.responses,1);
  assert.equal(summary.nps,100);
  assert.equal(lineage.period,"2026-10-01 through 2026-10-06");
  assert.equal(lineage.source,"Dealer Dashboard CSI");
  assert.match(homeCoverage,/2026-10-01 through 2026-10-06/);
  assert.match(homeCoverage,/refreshed 2026-10-07/);
  assert.match(homeCoverage,/verified Pulse responses/);
  assert.match(homeSummary,/100/);
  assert.equal(meetingEvidenceCalls.length,1);
  assert.equal(meetingEvidenceCalls[0].input,summary);
  assert.equal(meetingEvidenceCalls[0].result.period,lineage.period);
  assert.equal(meetingEvidenceCalls[0].result.source,lineage.source);
  assert.equal(meetingEvidenceCalls[0].result.verified,true);
  assert.match(html,/CUSTOMER SCORE/);
  assert.match(html,/>100<\/strong>/);
  assert.match(html,/OCT 6/);
});



test("repeated synthetic CSI refreshes retain one survey identity and bound the import ledger",async()=>{
  const csv=[
    "From,2026-10-01","To,2026-10-06",
    ["Invite_ID","_recordId","SURVEY_STATUS","INCLUDE_IN_SCORING","Date of Survey (-04:00 GMT)",
      "Service Advisor","Dealer NPS (Service)","Sales NPS Group (Service)","NPS: ServPulse","NPS Filter Group"].join(","),
    ["synthetic-survey-01","synthetic-pulse-01","Pulse Completed","Yes","2026-10-06",
      "Demo Advisor","10","Promoter","10","Promoter"].join(",")
  ].join("\n")+"\n";
  const model={settings:{csiPeriodStart:"2026-10-01"},operationalMetrics:{csi:{surveys:{},imports:[]}}};
  let durable=null;
  const history=[];
  const context=vm.createContext({
    model,structuredClone,
    OPERATIONAL_METRICS_PATH:["data","operational-metrics.json"],
    now:()=>"2026-10-07T15:00:00Z",localDateKey:()=>"2026-10-07",
    text:value=>value==null?"":String(value),norm:value=>String(value??"").trim().toLowerCase(),
    validCoverageDate:value=>/^20\d{2}-\d{2}-\d{2}$/.test(String(value||""))?value:"",
    strictReportDate:()=>"",csvNumber:value=>value===""?null:Number(value),
    parseCsv:value=>value.trimEnd().split(/\r?\n/).map(line=>line.split(",")),
    sourceFileHandle:async()=>({getFile:async()=>({text:async()=>csv})}),freshness,
    writeJson:async(_,value)=>{durable=structuredClone(value);},
    readJson:async()=>durable==null?null:structuredClone(durable),
    addHistory:async(type,message,details)=>{history.push({type,message,details});},
    removeSourceEntry:async()=>{},renderAll:()=>{},renderMeeting:()=>{},console
  });
  vm.runInContext(ingestion+"\n"+evidence+"\nthis.importCsiFile=importCsiFile;",context);
  for(let index=0;index<260;index++)
    await context.importCsiFile("synthetic-refresh-"+index+".csv");
  const csi=model.operationalMetrics.csi;
  assert.equal(Object.keys(csi.surveys).length,1,"reimporting one synthetic survey must not duplicate its durable identity");
  assert.equal(csi.surveys["synthetic-survey-01"].extensionRecordIds.length,0);
  assert.equal(csi.imports.length,250,"the in-memory import ledger remains capped at its production limit");
  assert.equal(csi.imports[0].sourceFile,"synthetic-refresh-10.csv");
  assert.equal(csi.imports.at(-1).sourceFile,"synthetic-refresh-259.csv");
  assert.equal(durable.csi.imports.length,250,"the capped ledger is what read-back verifies");
  assert.equal(history.length,260,"each successful source read keeps its audit event");
});
