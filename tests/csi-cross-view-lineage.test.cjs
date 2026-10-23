"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function extract(source,first,last,label){
  const start=source.indexOf(first);
  const end=source.indexOf(last,start+first.length);
  assert.ok(start>=0&&end>start,"Missing production "+label);
  return source.slice(start,end);
}
const summary=extract(app,"  function npsSummary(","  async function importCsiFile(","CSI summary");
const evidence=extract(app,"  function csiMetricEvidence(","  const rawVirMeetingEvidence=virMeetingEvidence","CSI evidence");
const home=extract(app,"  function renderOverviewIntelligence() {","  const renderOverviewIntelligenceBase=renderOverviewIntelligence;","Home renderer");
const meeting=extract(app,"  function meetingAdvisorTv(","  function renderMeetingArenaStore(","Meeting renderer");

function node(){
  return {textContent:"",className:"",children:[],
    replaceChildren(...items){this.children=[...items];},
    append(...items){this.children.push(...items);},
    setAttribute(){},remove(){},
  };
}
function textContent(value){
  if(value==null)return "";
  return String(value.textContent||"")+" "+(value.children||[]).map(textContent).join(" ");
}

test("one synthetic CSI observation keeps the same reporting period and source evidence across Home and Meeting",()=>{
  const survey={id:"synthetic-survey-01",surveyDate:"2026-10-06",classification:"Promoter",score:10};
  const model={settings:{csiPeriodStart:"2026-10-01"},operationalMetrics:{
    csi:{surveys:{[survey.id]:survey},imports:[{scopeStart:"2026-10-01",scopeEnd:"2026-10-06",scopeVerified:true,
      importedAt:"2026-10-07T15:00:00Z",refreshDate:"2026-10-07"}],lastSuccessfulRefreshAt:"2026-10-07T15:00:00Z",
      lastSuccessfulRefreshDate:"2026-10-07"}
  }};
  const ui=Object.fromEntries(["moondogNeeds","nextAppointmentsSummary","nextAppointmentsCoverage","virSummary",
    "virCoverage","menuSummary","menuCoverage","csiSummary","csiCoverage"].map(key=>[key,node()]));
  const context=vm.createContext({
    model,ui,document:{createElement:()=>node()},
    npsSummary:undefined,
    currentCsiSurveys:()=>model.operationalMetrics.csi.surveys,
    latestCsiRefreshDate:()=>model.operationalMetrics.csi.lastSuccessfulRefreshDate,
    sourceFreshness:key=>({key,safeForCurrent:true,status:"current",sourceTimestamp:model.operationalMetrics.csi.lastSuccessfulRefreshAt,
      periodEnd:"2026-10-06"}),
    sourceStatusLabel:()=>"CURRENT",
    reportNeeds:()=>({csi:{label:"CSI",state:"CURRENT",reason:"verified scope",actions:[]}}),
    latestNextAppointmentsSnapshot:()=>null,latestVirObservation:()=>null,
    managerAttentionRequests:()=>[],trendCoverageAudit:()=>({}),
    renderAdminCloseoutAttention:()=>{},renderTrendCoverageSummary:()=>{},renderPreviousMonthTotals:()=>{},
    metricEvidence:input=>({...input,verified:true}),
    metricDependencyEvidence:(_dependencies,base)=>({...base,verified:true}),
    localDateKey:()=>"2026-10-07",shortDate:value=>value==="2026-10-06"?"Oct 6":String(value||""),
    latestOperationalSnapshot:()=>null,virObservationDate:()=>"2026-10-06",
    virMeetingEvidence:()=>({verified:false,status:"missing-source"}),
    menuMeetingEvidence:()=>({verified:false,status:"missing-source"}),
    standard:key=>key==="dealerNps"?90:100,
    performanceFormat:(value,kind)=>kind==="money"?"$"+String(Math.round(value)):String(value),
    compactMoney:value=>"$"+String(Math.round(value/1000))+"K",
    meetingEscape:value=>String(value),console
  });
  vm.runInContext(summary+"\n"+evidence+"\n"+home+"\n"+meeting+
    "\nthis.npsSummary=npsSummary;this.csiMetricEvidence=csiMetricEvidence;"+
    "this.renderHome=renderOverviewIntelligence;this.renderMeeting=meetingAdvisorTv;",context);

  context.renderHome();
  const summaryValue=context.npsSummary(model.operationalMetrics.csi.surveys);
  const lineage=context.csiMetricEvidence(summaryValue);
  const homeCoverage=ui.csiCoverage.textContent;
  const homeSummary=textContent(ui.csiSummary);
  const meetingPerformance={totalGross:10000};
  meetingPerformance["cp"+"Elr"]=200;
  meetingPerformance["cp"+"Hours"]=2;
  meetingPerformance["media"+"Viewed"]=80;
  meetingPerformance["text"+"ing"]=90;
  const meetingHtml=context.renderMeeting("synthetic",{
    periodEnd:"2026-10-06",saprDaysCompleted:5,saprTotalDays:22,
    validation:{saprDaysVerified:true,finalTotalsVerified:true}
  },meetingPerformance,
  {configured:false,remainingDays:10},{current:{missingDates:[]}},{label:"Synthetic next action"},
  summaryValue);

  assert.equal(summaryValue.responses,1);
  assert.equal(summaryValue.nps,100);
  assert.equal(lineage.period,"2026-10-01 through 2026-10-06");
  assert.equal(lineage.source,"Dealer Dashboard CSI");
  assert.match(homeCoverage,/2026-10-01 through 2026-10-06/);
  assert.match(homeCoverage,/refreshed 2026-10-07/);
  assert.match(homeCoverage,/verified Pulse responses/);
  assert.match(homeSummary,/100/);
  assert.match(meetingHtml,/CUSTOMER SCORE/);
  assert.match(meetingHtml,/>100<\/strong>/);
  assert.match(meetingHtml,/OCT 6/);
});
