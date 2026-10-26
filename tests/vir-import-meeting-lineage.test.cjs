"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function extract(startToken, endToken, label) {
  const start = app.indexOf(startToken);
  const end = app.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0 && end > start, "Missing production " + label);
  return app.slice(start, end);
}

const parser = extract("  const VIR_NAME_CODES = {};", "  function virObservationDate(", "VIR parser");
const storage = extract("  function virObservationDate(", "  function normalizeOperationalCoverage()", "VIR import and storage");
const metricEvidence = extract("  function metricEvidence({", "  function metricEvidenceText(", "Meeting metric evidence");
const completeness = extract("  function virCompletenessEvidence(", "  function virMeetingEvidence()", "Meeting VIR completeness");
const meetingEvidence = extract("  function virMeetingEvidence()", "  function virMeetingWindowComparison(", "Meeting VIR evidence");
const home = extract("  function renderOverviewIntelligence() {", "  const renderOverviewIntelligenceBase", "Home renderer");


test("synthetic VIR report keeps its observation date and values through durable import into Meeting evidence", async () => {
  const csv = [
    "Report Date,2026-10-22",
    "Advisor Name,Total ROs,VIR Printed/Emailed/Texted,VIR Use %",
    "Demo Advisor,4,3,75"
  ].join("\n") + "\n";
  const model = { operationalMetrics: { vir: { snapshots: {}, pending: {} } } };
  let durable = null;
  const history = [];
  const context = vm.createContext({
    ADVISOR_NAMES: { A1: "Demo Advisor" },
    structuredClone,
    model,
    sourceLocations: new Map([["synthetic-vir.csv", "root"]]),
    OPERATIONAL_METRICS_PATH: ["data", "operational-metrics.json"],
    text: value => String(value ?? ""),
    norm: value => String(value ?? "").trim().toLowerCase(),
    csvNumber: value => value === "" || value == null ? null : Number(value),
    parseCsv: value => value.trimEnd().split(/\r?\n/).map(line => line.split(",")),
    internalObservationDate: () => "2026-10-22",
    validAdvisorIdentity: (code, name) => code === "A1" && name === "Demo Advisor",
    now: () => "2026-10-20T19:00:00.000Z",
    localDateKey: value => value && typeof value.toISOString === "function" ? value.toISOString().slice(0, 10) : "2026-10-20",
    previousOperatingDateKey: () => "2026-10-19",
    sourceExpectation: () => "recommended",
    meetingVirRosterCodes: () => ["A1"],
    pruneDatedSnapshots: value => value,
    sourceFileHandle: async () => ({
      getFile: async () => ({
        lastModified: Date.parse("2026-10-20T19:00:00.000Z"),
        text: async () => csv
      })
    }),
    writeJson: async (_path, value) => { durable = structuredClone(value); },
    readJson: async () => structuredClone(durable),
    addHistory: async (type, message, details) => { history.push({ type, message, details }); },
    recordDiagnostic() {},
    renderOverviewIntelligence() {}
  });

  vm.runInContext(
    parser + "\nVIR_NAME_CODES[\"demo advisor\"] = \"A1\";\n" + storage + "\n" + metricEvidence + "\n" + completeness + "\n" + meetingEvidence +
    "\nthis.importVirFile=importVirFile; this.virMeetingEvidence=virMeetingEvidence;",
    context
  );

  await context.importVirFile("synthetic-vir.csv", false);
  const saved = Object.values(durable.vir.snapshots)[0];
  assert.ok(saved, "The imported VIR observation must be durably retained.");
  assert.equal(saved.reportDate, "2026-10-22");
  assert.equal(saved.sourceModifiedAt, "2026-10-20T19:00:00.000Z");
  assert.equal(saved.importedAt, "2026-10-20T19:00:00.000Z");
  assert.equal(saved.observationTimestamp, "2026-10-22T12:00:00-07:00");
  assert.equal(saved.coverageMethod, "vir-point-in-time");
  assert.equal(saved.validation.coverageBasis, "VIR source observation provenance");
  assert.equal(Object.hasOwn(saved, "effectiveDataThrough"), false);
  assert.equal(history[0].details.observationDate, "2026-10-22");

  const evidence = context.virMeetingEvidence();
  assert.equal(evidence.verified, true);
  assert.equal(evidence.source, "VIR");
  assert.equal(evidence.period, "Observed 2026-10-22");
  assert.equal(evidence.value, 75);
  assert.match(evidence.reconciliation, /PASS/);
});



test("one synthetic VIR observation keeps its durable lineage consistent in Home, Meeting, and import history",async()=>{
  const csv=[
    "Report Date,2026-10-22",
    "Advisor Name,Total ROs,VIR Printed/Emailed/Texted,VIR Use %",
    "Demo Advisor,4,3,75"
  ].join("\n")+"\n";
  const model={settings:{},operationalMetrics:{vir:{snapshots:{},pending:{}}}};
  let durable=null;
  const history=[];
  const makeNode=()=>({
    textContent:"",className:"",children:[],
    replaceChildren(...items){this.children=[...items];},
    append(...items){this.children.push(...items);}
  });
  const ui=Object.fromEntries([
    "moondogNeeds","nextAppointmentsSummary","nextAppointmentsCoverage",
    "virSummary","virCoverage","menuSummary","menuCoverage","csiSummary","csiCoverage"
  ].map(key=>[key,makeNode()]));
  const context=vm.createContext({
    ADVISOR_NAMES:{A1:"Demo Advisor"},
    structuredClone,model,ui,
    sourceLocations:new Map([["synthetic-vir.csv","root"]]),
    OPERATIONAL_METRICS_PATH:["data","operational-metrics.json"],
    text:value=>String(value??""),
    norm:value=>String(value??"").trim().toLowerCase(),
    csvNumber:value=>value===""||value==null?null:Number(value),
    parseCsv:value=>value.trimEnd().split(/\r?\n/).map(line=>line.split(",")),
    internalObservationDate:()=>"2026-10-22",
    validAdvisorIdentity:(code,name)=>code==="A1"&&name==="Demo Advisor",
    now:()=>"2026-10-20T19:00:00.000Z",
    localDateKey:value=>value&&typeof value.toISOString==="function"?value.toISOString().slice(0,10):"2026-10-20",
    previousOperatingDateKey:()=>"2026-10-19",
    sourceExpectation:()=>"recommended",
    meetingVirRosterCodes:()=>["A1"],
    pruneDatedSnapshots:value=>value,
    sourceFileHandle:async()=>({getFile:async()=>({
      lastModified:Date.parse("2026-10-20T19:00:00.000Z"),text:async()=>csv
    })}),
    writeJson:async(_path,value)=>{durable=structuredClone(value);},
    readJson:async()=>structuredClone(durable),
    addHistory:async(type,message,details)=>{history.push({type,message,details});},
    recordDiagnostic(){},
    renderAdminCloseoutAttention(){},
    latestNextAppointmentsSnapshot:()=>null,
    currentCsiSurveys:()=>({}),
    latestCsiRefreshDate:()=>"not-recorded",
    npsSummary:()=>({responses:0,nps:0,promoters:0,detractors:0}),
    managerAttentionRequests:()=>[],
    trendCoverageAudit:()=>({}),
    reportNeeds:()=>({}),
    sourceFreshness:()=>({}),
    sourceStatusLabel:()=>"CURRENT",
    renderTrendCoverageSummary(){},
    renderPreviousMonthTotals(){},
    standard:key=>key==="vir"?80:NaN,
    performanceFormat:value=>String(value)+"%",
    shortDate:value=>String(value||""),
    document:{createElement:makeNode}
  });
  vm.runInContext(
    parser+"\nVIR_NAME_CODES[\"demo advisor\"]=\"A1\";\n"+storage+"\n"+metricEvidence+"\n"+completeness+"\n"+meetingEvidence+"\n"+home+
    "\nthis.importVirFile=importVirFile;this.virMeetingEvidence=virMeetingEvidence;this.renderHome=renderOverviewIntelligence;",
    context
  );
  await context.importVirFile("synthetic-vir.csv",false);
  context.model.operationalMetrics=structuredClone(durable);
  context.renderHome();

  const rendered=node=>String(node.textContent||"")+" "+(node.children||[]).map(rendered).join(" ");
  const snapshot=Object.values(durable.vir.snapshots)[0];
  const meeting=context.virMeetingEvidence();
  assert.ok(snapshot,"the production import leaves a retained durable observation");
  assert.equal(snapshot.reportDate,"2026-10-22");
  assert.equal(snapshot.sourceModifiedAt,"2026-10-20T19:00:00.000Z");
  assert.equal(snapshot.importedAt,"2026-10-20T19:00:00.000Z");
  assert.equal(snapshot.observationTimestamp,"2026-10-22T12:00:00-07:00");
  assert.equal(meeting.verified,true);
  assert.equal(meeting.period,"Observed 2026-10-22");
  assert.equal(meeting.value,75);
  assert.match(rendered(ui.virSummary),/Store VIR\s+75\.0%/,
    "Home renders the same utilization retained by the imported observation");
  assert.equal(ui.virCoverage.textContent,
    "Latest point-in-time observation · 2026-10-22 · "+snapshot.deliveryHeader,
    "Home shows the actual source observation date, rather than file or import time");
  assert.equal(history[0].details.observationDate,"2026-10-22",
    "the import audit retains the same report date shown by Home and Meeting");
});
