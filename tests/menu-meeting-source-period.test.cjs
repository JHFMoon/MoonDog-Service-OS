"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function extract(first, last, label) {
  const start = app.indexOf(first);
  const end = app.indexOf(last, start + first.length);
  assert.ok(start >= 0 && end > start, "Missing production " + label);
  return app.slice(start, end);
}

const menuEvidence = extract("  function menuMeetingEvidence(metric)", "  function csiMetricEvidence(", "Menu Meeting evidence selector");
const meeting = extract("  function meetingAdvisorTv(code,latest,entity,goal,week,next,csi)", "  function renderMeetingArenaStore(", "Meeting advisor renderer");

function makeFixture(releaseWeek) {
  const snapshot = {
    releaseWeek,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-18",
    store: { presentation: 82, penetration: 44 },
    advisors: { A1: { presentation: 82, penetration: 44 } },
    importedAt: "synthetic"
  };
  const model = { operationalMetrics: { menu: { snapshots: { [releaseWeek]: snapshot } } } };
  const context = vm.createContext({
    model,
    text: value => String(value ?? ""),
    expectedMenuWeek: () => "2026-10-19",
    sourceExpectation: () => "required",
    latestOperationalSnapshot: source => source === "menu" ? snapshot : null,
    metricEvidence: evidence => ({
      ...evidence,
      verified: ["verified", "known-zero"].includes(evidence.status)
    }),
    virMeetingEvidence: () => ({ status: "missing-source", verified: false }),
    virObservationDate: () => "",
    csiMetricEvidence: () => ({ verified: false }),
    standard: key => ({ menuPresentation: 50, menuPenetration: 30 }[key] || 100),
    performanceFormat: (value, kind) => kind === "money" ? "$" + Math.round(value) : String(value),
    shortDate: value => String(value || ""),
    compactMoney: value => "$" + Math.round(value / 1000) + "K",
    meetingEscape: value => String(value ?? "")
  });
  vm.runInContext(menuEvidence + "\n" + meeting +
    "\nthis.menuMeetingEvidence = menuMeetingEvidence; this.meetingAdvisorTv = meetingAdvisorTv;", context);
  const latest = {
    periodStart: "2026-10-01",
    periodEnd: "2026-10-18",
    saprDaysCompleted: 5,
    saprTotalDays: 22,
    validation: { saprDaysVerified: true, finalTotalsVerified: true }
  };
  const entity = { totalGross: 10000, cpElr: 120, cpHours: 2, mediaViewed: 80, texting: 90 };
  const html = context.meetingAdvisorTv("A1", latest, entity, {}, { current: { missingDates: [] } }, {}, { responses: 0 });
  return { context, snapshot, html };
}

test("Meeting does not attribute a future Menu Sales report to an earlier SAPR period", () => {
  const { context, snapshot, html } = makeFixture("2026-10-19");
  assert.equal(context.menuMeetingEvidence("presentation").period, "2026-10-19");
  assert.equal(snapshot.releaseWeek > "2026-10-18", true);
  assert.doesNotMatch(html, /MENUS SHOWN|MENUS SOLD/);
  assert.doesNotMatch(html, /82%|44%/);
});

test("Meeting carries a dated prior Menu Sales observation with its source period", () => {
  const { context, html } = makeFixture("2026-10-12");
  const evidence = context.menuMeetingEvidence("presentation");
  assert.equal(evidence.period, "2026-10-12");
  assert.equal(evidence.status, "stale");
  assert.match(html, /MENUS SHOWN/);
  assert.match(html, /MENUS SOLD/);
  assert.match(html, /82%/);
  assert.match(html, /44%/);
  assert.match(html, /UPDATED 2026-10-12/);
});
