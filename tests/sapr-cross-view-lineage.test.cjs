"use strict";

// #59-01 synthetic SAPR lineage: carry one verified report through durable
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

const importer = extract("  async function importPerformanceFile(", "  function performanceFormat(", "SAPR importer");
const entity = extract("  function performanceEntity(", "  function performanceDelta(", "SAPR entity selector");
const delta = extract("  function performanceDelta(", "  function trackerOpenCount(", "SAPR delta selector");
const plan = extract("  function performancePlan(", "  function currentCsiSurveys(", "SAPR working-day projection");
const performanceView = extract("  function renderPerformance() {", "  const renderPerformanceBase = renderPerformance;", "Performance view renderer");
const meeting = extract("  function meetingAdvisorTv(", "  function renderMeetingArenaStore(", "Meeting renderer");

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
  validation: { saprDaysVerified: true, finalTotalsVerified: true },
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

test("one synthetic SAPR snapshot keeps its period and working-day basis across import, Performance, and Meeting", async () => {
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
  const context = vm.createContext({
    model, ui, structuredClone,
    PERFORMANCE_PATH: ["data", "performance.json"],
    dailyPickedSources: new Set(["synthetic-sapr.xlsx"]),
    now: () => "2026-10-22T12:00:00Z",
    parsePerformanceWorkbook: () => structuredClone(syntheticSnapshot),
    prunePerformanceSnapshots: snapshots => snapshots,
    writeJson: async (_path, value) => { durable = structuredClone(value); },
    readJson: async () => structuredClone(durable),
    addHistory: async () => {},
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
    importer, entity, delta, plan, performanceView, meeting,
    "this.api = { importPerformanceFile, performanceEntity, performancePlan, renderPerformance, meetingAdvisorTv };"
  ].join("\n"), context);

  await context.api.importPerformanceFile("synthetic-sapr.xlsx", false, new ArrayBuffer(8));

  assert.equal(JSON.stringify(durable.snapshots["2026-10-21"]), JSON.stringify(syntheticSnapshot),
    "the verified SAPR snapshot and its source period must survive durable read-back");
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
});
