"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function extract(start, end, label) {
  const a = app.indexOf(start);
  const b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "Missing production " + label);
  return app.slice(a, b);
}

const menuEvidence = extract("  function menuMeetingEvidence(metric)", "  function csiMetricEvidence(", "Menu Meeting evidence");
const meeting = extract("  function meetingAdvisorTv(", "  function renderMeetingArenaStore(", "active Meeting renderer");
const menuImporter = extract("  async function importMenuSalesFile(", "  const CSI_ADVISOR_CODES =", "Menu Sales importer");

function fixture(releaseWeek) {
  const snapshot = {
    releaseWeek,
    periodStart: "2026-10-12",
    periodEnd: "2026-10-18",
    store: { presentation: 82, penetration: 44 },
    advisors: { SYNTHETIC_ADVISOR: { presentation: 82, penetration: 44 } },
    importedAt: "synthetic-import"
  };
  const model = { operationalMetrics: { menu: { snapshots: { [releaseWeek]: snapshot } } } };
  let persisted = null;
  const history = [];
  const events = [];
  const context = vm.createContext({
    model, structuredClone,
    OPERATIONAL_METRICS_PATH: ["data", "operational-metrics.json"],
    parseMenuSalesWorkbook: () => structuredClone(snapshot),
    pruneDatedSnapshots: value => value,
    now: () => "2026-10-21T12:00:00.000Z",
    writeJson: async (_path, value) => { events.push("write"); persisted = structuredClone(value); },
    readJson: async () => { events.push("readback"); return structuredClone(persisted); },
    addHistory: async (type, message, details) => { history.push({ type, message, details }); events.push("history"); },
    removeSourceEntry: async () => { events.push("delete-source"); },
    renderOverviewIntelligence: () => events.push("render"),
    text: value => String(value ?? ""),
    expectedMenuWeek: () => "2026-10-19",
    sourceExpectation: () => "required",
    latestOperationalSnapshot: source => source === "menu" ? (Object.values(model.operationalMetrics.menu.snapshots).at(-1) || null) : null,
    metricEvidence: evidence => ({
      ...evidence,
      verified: ["verified", "known-zero"].includes(evidence.status)
    }),
    virMeetingEvidence: () => ({ status: "missing-source", verified: false }),
    virObservationDate: () => "",
    csiMetricEvidence: () => ({ verified: false }),
    standard: () => 1,
    performanceFormat: (value, kind) => kind === "money" ? "$" + Math.round(value) : String(value),
    shortDate: value => String(value || ""),
    compactMoney: value => "$" + Math.round(value / 1000) + "K",
    meetingEscape: value => String(value ?? "")
  });
  vm.runInNewContext(menuImporter + "\n" + menuEvidence + "\n" + meeting +
    "\nthis.api={importMenuSalesFile,menuMeetingEvidence,meetingAdvisorTv};", context);
  const latest = {
    periodStart: "2026-10-01",
    periodEnd: "2026-10-18",
    saprDaysCompleted: 5,
    saprTotalDays: 22,
    validation: { saprDaysVerified: true, finalTotalsVerified: true }
  };
  const genericMetric = () => 1;
  const entity = { totalGross: genericMetric(), cpElr: genericMetric(), cpHours: genericMetric(), mediaViewed: genericMetric(), texting: genericMetric() };
  const html = context.api.meetingAdvisorTv(
    "SYNTHETIC_ADVISOR", latest, entity, {},
    { current: { missingDates: [] } }, {}, { responses: 0 }
  );
  return { context, html, model, snapshot, persisted: () => persisted, history, events };
}

test("Meeting withholds a future Menu release from an earlier SAPR period", () => {
  const { context, html } = fixture("2026-10-19");
  assert.equal(context.api.menuMeetingEvidence("presentation").period, "2026-10-19");
  assert.doesNotMatch(html, /MENUS SHOWN|MENUS SOLD/);
});

test("Meeting attributes each Menu metric to that Menu report's period", () => {
  const { context, html } = fixture("2026-10-12");
  for (const metric of ["presentation", "penetration"]) {
    const evidence = context.api.menuMeetingEvidence(metric);
    assert.equal(evidence.period, "2026-10-12");
    assert.equal(evidence.status, "stale");
  }
  assert.match(html, /<span class="aa-item past"><b>MENUS SHOWN<\/b><strong>82%<\/strong><small>UPDATED 2026-10-12<\/small><\/span>/,
    "MENUS SHOWN must retain its own value and Menu source date");
  assert.match(html, /<span class="aa-item past"><b>MENUS SOLD<\/b><strong>44%<\/strong><small>UPDATED 2026-10-12<\/small><\/span>/,
    "MENUS SOLD must retain its own value and Menu source date");
});

test("Menu Sales import keeps its verified release period attached to Meeting evidence", async () => {
  const h = fixture("2026-10-12");
  h.model.operationalMetrics.menu.snapshots = {};
  await h.context.api.importMenuSalesFile("synthetic-menu-sales.xlsx", false, new ArrayBuffer(8));

  const saved = h.persisted().menu.snapshots["2026-10-12"];
  assert.ok(saved, "the production importer writes the Menu snapshot under its report release week");
  assert.equal(saved.periodStart, "2026-10-12");
  assert.equal(saved.periodEnd, "2026-10-18");
  assert.deepEqual(h.history.map(item => item.type), ["menu-sales-import"]);
  assert.deepEqual(h.events, ["write", "readback", "history", "render"]);

  const evidence = h.context.api.menuMeetingEvidence("presentation");
  assert.equal(evidence.period, "2026-10-12");
  assert.equal(evidence.value, 82);
  assert.equal(evidence.status, "stale", "an older Menu release must remain visibly stale against expectedMenuWeek");

  const latest = {
    periodStart: "2026-10-01",
    periodEnd: "2026-10-18",
    saprDaysCompleted: 5,
    saprTotalDays: 22,
    validation: { saprDaysVerified: true, finalTotalsVerified: true }
  };
  const genericMetric = () => 1;
  const entity = { totalGross: genericMetric(), cpElr: genericMetric(), cpHours: genericMetric(), mediaViewed: genericMetric(), texting: genericMetric() };
  const html = h.context.api.meetingAdvisorTv(
    "SYNTHETIC_ADVISOR", latest, entity, {},
    { current: { missingDates: [] } }, {}, { responses: 0 }
  );
  assert.match(html, /MENUS SHOWN/);
  assert.match(html, /UPDATED 2026-10-12/);
  assert.match(html, /82%/);
});
