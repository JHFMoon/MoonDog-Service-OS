"use strict";

// #59-01 synthetic SAPR lineage: carry one verified report through durable read-back, Home, Performance, Meeting, and history
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const freshnessSource = fs.readFileSync(path.join(__dirname, "..", "assets", "freshness.js"), "utf8");
function extract(startToken, endToken, label) {
  const start = app.indexOf(startToken);
  const end = app.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0 && end > start, "Missing production " + label);
  return app.slice(start, end);
}

const historyWriter = extract("  async function addHistory(", "  function migrateOpenRoFieldIdentity(", "SAPR production history writer");
const importer = extract("  async function importPerformanceFile(", "  function performanceFormat(", "SAPR importer");
const entity = extract("  function performanceEntity(", "  function performanceDelta(", "SAPR entity selector");
const delta = extract("  function performanceDelta(", "  function trackerOpenCount(", "SAPR delta selector");
const plan = extract("  function performancePlan(", "  function currentCsiSurveys(", "SAPR working-day projection");
const performanceView = extract("  function renderPerformance() {", "  const renderPerformanceBase = renderPerformance;", "Performance view renderer");
const meeting = extract("  function meetingAdvisorTv(", "  function renderMeetingArenaStore(", "Meeting renderer");
const saprSnapshotSelector = extract("  function saprImportRank(", "  function verifiedSaprSnapshot(", "SAPR snapshot selector");
const sourceExpectation = extract("  function sourceExpectation(", "  function sourceAvailable(", "source expectation");
const csiReportedPeriod = extract("  function csiReportedPeriod(", "  function sourceFreshness(", "CSI report period");
const sourceFreshness = extract("  function sourceFreshness(", "  function sourceStatusLabel(", "Home source freshness");
const sourceStatusLabel = extract("  function sourceStatusLabel(", "  function advisorNextWin(", "Home source status");
const reportNeeds = extract("  function reportNeeds(", "  function latestSupplementalFamily(", "Home source health needs");
const homeRenderer = extract("  function renderOverviewIntelligence() {", "  const renderOverviewIntelligenceBase", "Home source health renderer");

function node() {
  return {
    textContent: "", value: "", innerHTML: "", className: "", children: [],
    replaceChildren(...values) { this.children = [...values]; },
    append(...values) { this.children.push(...values); },
    add(value) { this.children.push(value); },
    before() {}
  };
}
const syntheticSnapshot = {
  date: "2026-10-21",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-21",
  sourceFile: "synthetic-sapr.xlsx",
  saprDaysCompleted: 8,
  saprTotalDays: 22,
  validation: { advisorDetailSheets: 1, saprDaysVerified: true, finalTotalsVerified: true },
  store: {
    name: "Synthetic Store", totalGross: 2437, totalRO: 10, grossPerRo: 243.7, open: 2, aged: 1
  },
  advisors: {
    "SYN-01": {
      code: "SYN-01", name: "Synthetic Advisor", totalGross: 2437,
      totalRO: 10, grossPerRo: 243.7,
      laborMargin: 10, partsMargin: 20, open: 2, aged: 1
    }
  }
};

test("one synthetic SAPR snapshot keeps its period and working-day basis across import, Performance, Meeting, and production history", async () => {
  const model = { performance: { snapshots: {}, updatedAt: null } };
  let durable = null;
  const ui = Object.fromEntries([
    "performanceAdvisor", "performanceMetric", "performancePeriod", "performanceSource",
    "performanceKpis", "performanceTrendTitle", "performanceTrendNote",
    "performanceTrendCount", "performanceChanges", "performanceAdvisorNote",
    "performanceAdvisorTable"
  ].map(key => [key, node()]));
  ui.performanceAdvisor.value = "store";
  ui.performanceMetric.value = "totalGross";
  const chartPoints = [];
  const history = [];
  const persistenceEvents = [];
  const context = vm.createContext({
    model, ui, structuredClone,
    PERFORMANCE_PATH: ["data", "performance.json"],
    dailyPickedSources: new Set(["synthetic-sapr.xlsx"]),
    now: () => "2026-10-22T12:00:00Z",
    parsePerformanceWorkbook: () => structuredClone(syntheticSnapshot),
    prunePerformanceSnapshots: snapshots => snapshots,
    stamp: () => "2026-10-22T12-00-00Z",
    slug: value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    recordDiagnostic: () => {},
    writeJson: async (targetPath, value) => {
      const destination = targetPath.join("/");
      if (destination === "data/performance.json") {
        persistenceEvents.push("write");
        durable = structuredClone(value);
      } else if (destination.startsWith("data/history/")) {
        persistenceEvents.push("history");
        history.push(structuredClone(value));
      } else {
        throw new Error("Unexpected synthetic SAPR write target: " + destination);
      }
    },
    readJson: async targetPath => {
      assert.equal(targetPath.join("/"), "data/performance.json");
      persistenceEvents.push("readback");
      return structuredClone(durable);
    },
    status: () => {},
    renderPerformanceChart: points => { chartPoints.push(...points); },
    performanceMetricMeta: { totalGross: ["Total gross"] },
    performanceFormat: (value, kind) => {
      if (!Number.isFinite(value)) return "—";
      if (kind === "money") return "$" + Math.round(value);
      if (kind === "number") return value.toFixed(2);
      return String(Math.round(value));
    },
    advisorShownInSection: () => true,
    document: { createElement: () => node() },
    Option: function Option(label, value) { this.label = label; this.value = value; },
    performanceSetting: () => 30000,
    meetingSetting: () => 30000,
    configuredNumber: value => Number(value),
    lastDayOfMonth: month => month + "-31",
    localDateKey: () => "2026-10-22",
    businessTimeZone: () => "America/Los_Angeles",
    freshness: { timeParts: () => ({ hour: 12 }) },
    standard: key => key === "cpElr" ? 150 : key === "cpHoursPerRo" ? 1.8 : key === "mediaViewed" ? 80 : key === "texting" ? 90 : 0,
    shortDate: value => value === "2026-10-21" ? "Oct 21" : String(value || ""),
    compactMoney: value => "$" + Math.round(value / 1000) + "K",
    virMeetingEvidence: () => ({ verified: false, status: "missing-source" }),
    csiMetricEvidence: () => ({ verified: false, status: "missing-source" }),
    latestOperationalSnapshot: () => null,
    virObservationDate: () => "",
    menuMeetingEvidence: () => ({ verified: false, status: "missing-source" }),
    csiMetricEvidence: () => ({ verified: false, status: "missing-source" }),
    npsSummary: () => ({ responses: 0, nps: null }),
    currentCsiSurveys: () => ({}),
    meetingEscape: value => String(value),
    console
  });
  vm.runInContext([
    historyWriter, importer, entity, delta, plan, performanceView, meeting,
    "this.api = { importPerformanceFile, performanceEntity, performancePlan, renderPerformance, meetingAdvisorTv };"
  ].join("\n"), context);

  await context.api.importPerformanceFile("synthetic-sapr.xlsx", false, new ArrayBuffer(8));

  assert.equal(JSON.stringify(durable.snapshots["2026-10-21"]), JSON.stringify(syntheticSnapshot),
    "the verified SAPR snapshot and its source period must survive durable read-back");
  assert.deepEqual(persistenceEvents, ["write", "readback", "history"],
    "a SAPR import must enter durable audit history only after its snapshot is verified");
  assert.deepEqual(JSON.parse(JSON.stringify(history)), [{
    schemaVersion: 1,
    id: "2026-10-22T12-00-00Z-performance-import",
    at: "2026-10-22T12:00:00Z",
    type: "performance-import",
    summary: "Added performance snapshot for 2026-10-21",
    details: { date: "2026-10-21", periodStart: "2026-10-01", periodEnd: "2026-10-21", fileName: "synthetic-sapr.xlsx", advisors: 1, rawCopyRetained: false }
  }], "the actual production history writer must persist report date, exact source period, source identity, and copy policy only after durable performance read-back");
  assert.equal(ui.performancePeriod.textContent, "2026-10-01 through 2026-10-21",
    "Performance must show the exact imported reporting period");
  assert.match(ui.performanceSource.textContent, /synthetic-sapr\.xlsx/);
  assert.equal(JSON.stringify(chartPoints), JSON.stringify([{ date: "2026-10-21", value: 2437 }]),
    "Performance trend must use the same imported snapshot and report-end date");

  const persisted = durable.snapshots["2026-10-21"];
  const storeEntity = context.api.performanceEntity(persisted, "store");
  const projection = context.api.performancePlan(persisted, storeEntity, null);
  assert.equal(projection.completed, 8);
  assert.equal(projection.totalDays, 22);
  assert.equal(projection.pace, 6701.75);
  assert.equal(projection.source, "SAPR days worked");

  const meetingEntity = storeEntity;
  const meetingHtml = context.api.meetingAdvisorTv(
    "store", persisted, meetingEntity,
    { configured: true, target: 4500, roundedDaily: 100, remainingDays: 5, achieved: false },
    { current: { missingDates: [] } },
    { label: "Synthetic next win", measure: "Synthetic measure" },
    { responses: 0, nps: null }
  );
  assert.match(meetingHtml, /OCT 21/,
    "Meeting must display the SAPR report-end date, not the import date");
  assert.match(meetingHtml, /MONTH TO DATE/);
  assert.match(meetingHtml, /<div class="aa-money">\$2K<\/div>/,
    "Meeting must display the same imported synthetic gross used by Performance");
  assert.match(meetingHtml, /\$7K PROJECTED \(EST\.\)/,
    "Meeting forecast must use the imported gross and SAPR working-day denominator");

  const nextSynthetic = structuredClone(persisted);
  nextSynthetic.store.totalGross = 1217;
  nextSynthetic.saprDaysCompleted = 11;
  const nextEntity = context.api.performanceEntity(nextSynthetic, "store");
  const nextMeeting = context.api.meetingAdvisorTv(
    "store", nextSynthetic, nextEntity,
    { configured: true, target: 4500, roundedDaily: 100, remainingDays: 5, achieved: false },
    { current: { missingDates: [] } },
    { label: "Synthetic next win", measure: "Synthetic measure" },
    { responses: 0, nps: null }
  );
  assert.match(nextMeeting, /<div class="aa-money">\$1K<\/div>/,
    "Meeting gross must change with a different synthetic imported snapshot");
  assert.match(nextMeeting, /\$2K PROJECTED \(EST\.\)/,
    "Meeting forecast must change when gross and SAPR days-worked inputs change");

  const homeUi = {
    moondogNeeds: node(),
    nextAppointmentsSummary: node(),
    nextAppointmentsCoverage: node()
  };
  const homeModel = {
    state: { records: [] },
    settings: {
      setup: { sourceExpectations: { sapr: "recommended" } },
      store: { timeZone: "UTC" },
      meeting: {},
      advisors: {}
    },
    performance: { snapshots: structuredClone(durable.snapshots) },
    appointments: { days: {} },
    operationalMetrics: {
      nextAppointments: { snapshots: {} },
      vir: { snapshots: {} },
      menu: { snapshots: {} },
      csi: { surveys: {}, imports: [] },
      monthlySummaries: {}
    },
    recovery: {}
  };
  const homeContext = vm.createContext({
    model: homeModel,
    ui: homeUi,
    document: {
      createElement: () => node(),
      querySelector: () => ({ id: "view-overview" })
    },
    renderAdminCloseoutAttention: () => {},
    latestNextAppointmentsSnapshot: () => null,
    latestVirObservation: () => null,
    virObservationDate: () => "",
    currentCsiSurveys: () => ({}),
    latestCsiRefreshDate: () => "",
    managerAttentionRequests: () => [],
    trendCoverageAudit: () => ({}),
    renderTrendCoverageSummary: () => {},
    renderPreviousMonthTotals: () => {},
    latestOperationalSnapshot: () => null,
    dailyEvidenceDate: () => "",
    activeWorkloadSnapshot: () => null,
    validCoverageDate: () => "",
    reportCadenceDue: () => true
  });
  vm.runInContext(freshnessSource, homeContext);
  homeContext.freshness = homeContext.MoonDogFreshness;
  homeContext.businessTimeZone = () => "UTC";
  homeContext.localDateKey = (value = new Date()) => homeContext.freshness.dateKey(value, "UTC");
  vm.runInContext([
    saprSnapshotSelector,
    sourceExpectation,
    csiReportedPeriod,
    sourceFreshness,
    sourceStatusLabel,
    reportNeeds,
    homeRenderer,
    "this.renderOverviewIntelligence = renderOverviewIntelligence;"
  ].join("\n"), homeContext);
  homeContext.renderOverviewIntelligence();
  const homeHealth = homeUi.moondogNeeds.children
    .map(function collectText(item) {
      return [item.textContent || "", ...(item.children || []).map(collectText)].join(" ");
    })
    .join(" ");
  assert.match(homeHealth, /SAPR: .*Report period: 2026-10-01 through 2026-10-21/,
    "the real Home health renderer must show the same SAPR report end date as the durable snapshot");
  assert.doesNotMatch(homeHealth, /SAPR: .*Report period: 2026-10-01 through 2026-10-22 · Last imported:/,
    "the import date must not replace the report's authorized coverage period");

});
