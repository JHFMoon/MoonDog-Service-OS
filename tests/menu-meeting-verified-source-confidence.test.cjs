"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");
const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");

function extract(from, to) {
  const start = app.indexOf(from), end = app.indexOf(to, start);
  assert.ok(start >= 0 && end > start, "Missing actual production function: " + from);
  return app.slice(start, end);
}
const validator = extract("  function verifiedMenuTrendReleases(", "  function trendCoverageAudit(");
const sourceEvidence = extract("  function sourceFreshness(", "  function metricDependencyEvidence(");
const meetingEvidence = extract("  function menuMeetingEvidence(metric)", "  function csiMetricEvidence(");
const metricEvidence = extract("  function metricEvidence({", "  function metricEvidenceText(");
assert.match(sourceEvidence, /verifiedMenuTrendReleases\(\{ retained: item \}, today\)/,
  "Home source freshness and monthly trend must share the same verified period rule");
assert.match(meetingEvidence, /sourceFreshness\("menu",\{item:snapshot\}\)/,
  "Meeting must consume the actual Home source-confidence contract");
const TODAY = "2026-11-02";
function report(extra = {}) {
  return {
    releaseWeek: TODAY,
    ranDate: TODAY,
    periodStart: "2026-10-01",
    periodEnd: "2026-11-01",
    sourceFile: "synthetic-menu.xlsx",
    importedAt: "2026-11-02T22:00:00.000Z",
    store: {presentation: 75, penetration: 30},
    ...extra
  };
}
function harness(item, availability = "recommended") {
  const model = {operationalMetrics: {menu: {snapshots: item ? {[String(item.releaseWeek)]: item} : {}}}};
  const before = JSON.stringify(model);
  const ctx = vm.createContext({
    model, freshness, businessTimeZone: () => "America/Los_Angeles",
    localDateKey: () => TODAY,
    sourceExpectation: () => availability,
    latestOperationalSnapshot: key => key === "menu" ? item : null,
    expectedMenuWeek: () => freshness.mondayFor(TODAY)
  });
  vm.runInContext(validator + "\n" + sourceEvidence + "\n" + metricEvidence + "\n" + meetingEvidence
    + "\nthis.getSource=sourceFreshness;this.getMetric=menuMeetingEvidence;this.validReleases=verifiedMenuTrendReleases;", ctx);
  const getSource = () => ctx.getSource("menu", {today: TODAY, item});
  const getMetric = key => ctx.getMetric(key);
  const checkReadOnly = () => assert.equal(JSON.stringify(model), before, "Source confidence cannot alter retained source");
  return {getSource, getMetric, validReleases: ctx.validReleases, checkReadOnly};
}
test("verified Monday report with dated, ordered source period is current in Home and Meeting", () => {
  const f = harness(report());
  const source = f.getSource(), metric = f.getMetric("presentation");
  assert.equal(source.status, "current");
  assert.equal(source.reportPeriodVerified, true);
  assert.equal(source.safeForCurrent, true);
  assert.equal(metric.status, "verified");
  assert.equal(metric.value, 75);
  assert.equal(metric.period, TODAY);
  assert.equal(f.validReleases({one: report()}, TODAY).has(TODAY), true);
  f.checkReadOnly();
});

test("verified current zero remains known zero, not missing or invalid", () => {
  const f = harness(report({store:{presentation:0, penetration:0}}));
  assert.equal(f.getMetric("presentation").status, "known-zero");
  assert.equal(f.getMetric("presentation").value, 0);
  assert.equal(f.getMetric("penetration").value, 0);
  f.checkReadOnly();
});

test("missing source report period or release date cannot claim current metrics", () => {
  for (const item of [
    report({periodStart: ""}),
    report({periodEnd: ""}),
    report({releaseWeek: ""})
  ]) {
    const f = harness(item);
    const source = f.getSource(), metric = f.getMetric("presentation");
    assert.equal(source.status, "invalid");
    assert.equal(source.safeForCurrent, false);
    assert.equal(source.reportPeriodVerified, false);
    assert.equal(metric.status, "missing-period");
    assert.equal(metric.value, null);
    f.checkReadOnly();
  }
});

test("reversed, impossible and non-Monday releases fail closed in every view", () => {
  for (const item of [
    report({periodStart: "2026-11-01", periodEnd: "2026-10-01"}),
    report({periodStart: "2026-02-30"}),
    report({releaseWeek: "2026-11-03"})
  ]) {
    const f = harness(item);
    assert.equal(f.getSource().status, "invalid");
    assert.equal(f.getMetric("penetration").status, "missing-period");
    assert.equal(f.getMetric("penetration").value, null);
    f.checkReadOnly();
  }
});

test("future weekly releases and future run dates cannot be current source evidence", () => {
  for (const item of [
    report({releaseWeek: "2026-11-09", ranDate: "2026-11-09"}),
    report({ranDate: "2026-11-03"})
  ]) {
    const f = harness(item);
    assert.equal(f.getSource().safeForCurrent, false);
    assert.equal(f.getSource().reportPeriodVerified, false);
    assert.equal(f.getMetric("presentation").status, "missing-period");
    assert.equal(f.validReleases({one:item}, TODAY).size, 0);
    f.checkReadOnly();
  }
});

test("current week release with contradictory source run week remains unverified", () => {
  const item = report({ranDate: "2026-10-28"});
  const f = harness(item);
  assert.equal(f.getSource().status, "invalid");
  assert.equal(f.getMetric("presentation").status, "missing-period");
  f.checkReadOnly();
});

test("valid prior Monday keeps stale status and optional legacy run-date compatibility", () => {
  const item = report({releaseWeek:"2026-10-26", periodEnd:"2026-10-25", ranDate: undefined});
  const f = harness(item);
  const source=f.getSource(), metric=f.getMetric("presentation");
  assert.equal(source.status, "stale");
  assert.equal(source.reportPeriodVerified, true);
  assert.equal(source.safeForCurrent, false);
  assert.equal(metric.status, "stale");
  assert.equal(metric.value, null);
  assert.equal(metric.lastVerifiedValue, 75);
  f.checkReadOnly();
});

test("supported period with unknown metric remains a parser error, not a fabricated zero", () => {
  const f = harness(report({store:{presentation: null, penetration:30}}));
  const metric=f.getMetric("presentation");
  assert.equal(metric.status, "parser-error");
  assert.equal(metric.value, null);
  f.checkReadOnly();
});

test("not-used, unavailable and missing source states preserve explicit source controls", () => {
  assert.equal(harness(report(), "not-used").getMetric("presentation").status, "not-used");
  assert.equal(harness(report(), "temporarily-unavailable").getMetric("presentation").status, "temporarily-unavailable");
  assert.equal(harness(null).getMetric("presentation").status, "missing-source");
});
