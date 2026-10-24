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
    standard: () => 1,
    performanceFormat: (value, kind) => kind === "money" ? "$" + Math.round(value) : String(value),
    shortDate: value => String(value || ""),
    compactMoney: value => "$" + Math.round(value / 1000) + "K",
    meetingEscape: value => String(value ?? "")
  });
  vm.runInNewContext(menuEvidence + "\n" + meeting +
    "\nthis.api={menuMeetingEvidence,meetingAdvisorTv};", context);
  const latest = {
    periodStart: "2026-10-01",
    periodEnd: "2026-10-18",
    saprDaysCompleted: 5,
    saprTotalDays: 22,
    validation: { saprDaysVerified: true, finalTotalsVerified: true }
  };
  const entity = { totalGross: 10000, cpElr: 120, cpHours: 2, mediaViewed: 80, texting: 90 };
  const html = context.api.meetingAdvisorTv(
    "SYNTHETIC_ADVISOR", latest, entity, {},
    { current: { missingDates: [] } }, {}, { responses: 0 }
  );
  return { context, html };
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
