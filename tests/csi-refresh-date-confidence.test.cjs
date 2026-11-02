"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  function latestCsiRefreshDate() {");
const end = app.indexOf("  function latestOperationalSnapshot(", start);
assert.ok(start >= 0 && end > start, "actual production CSI freshness presentation function exists");
const production = app.slice(start, end);

function latest(csi, today = "2026-10-20") {
  const model = {operationalMetrics: {csi}};
  const ctx = vm.createContext({
    model, freshness, Date,
    localDateKey: (value) => value instanceof Date ? value.toISOString().slice(0, 10) : today
  });
  vm.runInContext(production + "\nthis.latest=latestCsiRefreshDate;", ctx);
  const original = JSON.stringify(model);
  const result = ctx.latest();
  assert.equal(JSON.stringify(model), original, "read-only freshness display must not mutate imported source history");
  return result;
}

test("CSI refresh is derived from durable imports, not an unbacked aggregate date", () => {
  assert.equal(latest({lastSuccessfulRefreshDate:"2026-10-20",
    imports:[{refreshDate:"2026-10-19"}]}), "2026-10-19",
    "a saved newer metadata date cannot promote an older source to current");
  assert.equal(latest({lastSuccessfulRefreshDate:"2026-10-20",
    imports:[{refreshDate:"2026-10-20"}]}), "2026-10-20");
  assert.equal(latest({lastSuccessfulRefreshDate:"2026-10-20", imports:[]}), "",
    "orphaned refresh metadata is not a verified source");
  assert.equal(latest({lastSuccessfulRefreshDate:"2026-10-20"}), "");
});

test("impossible and future persisted CSI dates never certify a source refresh", () => {
  for (const invalid of ["2026-02-30", "2026-02-29", "2026-04-31", "2026-13-01",
    "2026-00-10", "2026-10-00", "2026-11-01", "2026-1-20", "not-a-date"]) {
    assert.equal(latest({lastSuccessfulRefreshDate:invalid,
      imports:[{refreshDate:"2026-10-19"}]}), "2026-10-19", invalid);
  }
});

test("invalid or future explicit import refresh date cannot borrow its import timestamp", () => {
  for (const invalid of ["2026-02-30", "2026-10-21", "2026-13-01"]) {
    assert.equal(latest({imports:[{refreshDate:invalid,
      importedAt:"2026-10-20T14:00:00.000Z"}]}), "", invalid);
  }
});

test("valid timestamp-only legacy import retains observation fallback; invalid timestamps fail closed", () => {
  assert.equal(latest({imports:[{importedAt:"2026-10-19T14:00:00.000Z"}]}), "2026-10-19");
  assert.equal(latest({imports:[{importedAt:"2026-10-21T14:00:00.000Z"}]}), "",
    "future imported timestamp is not an observed source refresh");
  for (const invalid of ["2026-02-30T14:00:00.000Z", "2026-10-19T25:00:00.000Z",
    "not-a-date", "", null, undefined]) {
    assert.equal(latest({imports:[{importedAt:invalid}]}), "", String(invalid));
  }
});

test("latest valid dated source wins while absent sources remain unknown rather than today's date", () => {
  assert.equal(latest({imports:[
    {refreshDate:"2026-10-17"}, {refreshDate:"2026-10-19"},
    {refreshDate:"2026-10-21"}, {refreshDate:"2026-02-30"}
  ]}), "2026-10-19");
  assert.equal(latest({imports:[{}, {refreshDate:""}, {importedAt:null}]}), "");
  assert.equal(latest({}), "");
});

function zeroEvidence(csi, source, surveys = {}) {
  const model = {operationalMetrics: {csi}};
  const ctx = vm.createContext({
    model, freshness, Date,
    localDateKey: (value) => value instanceof Date ? value.toISOString().slice(0, 10) : "2026-10-20",
    sourceFreshness: key => {
      assert.equal(key, "csi");
      return source;
    },
    currentCsiSurveys: () => surveys
  });
  vm.runInContext(production + "\nthis.zeroEvidence=verifiedCsiNoResponses;", ctx);
  const before = JSON.stringify(model);
  const result = ctx.zeroEvidence();
  assert.equal(JSON.stringify(model), before, "source confidence checks must not mutate CSI records");
  return result;
}

test("Meeting's NO RESPONSES label requires durable current CSI, verified report period and zero surveys", () => {
  assert.ok(app.includes('item.key === "dealerNps" && verifiedCsiNoResponses()'),
    "actual production Meeting source-health panel must use verified zero-response predicate");
  const trusted = {safeForCurrent:true, reportPeriodVerified:true};
  const importsToday = {imports:[{refreshDate:"2026-10-20", scopeVerified:true, scopeEnd:"2026-10-19", rows:0}]};
  assert.equal(zeroEvidence(importsToday, trusted), true,
    "current, report-verified zero-response source retains NO RESPONSES");
  assert.equal(zeroEvidence({imports:[],lastSuccessfulRefreshDate:"2026-10-20"}, trusted), false,
    "orphaned metadata must not manufacture verified zero");
  assert.equal(zeroEvidence({imports:[{refreshDate:"2026-10-19"}],
    lastSuccessfulRefreshDate:"2026-10-20"}, trusted), false,
    "stale source dates must not borrow newer aggregate metadata");
  assert.equal(zeroEvidence(importsToday, {safeForCurrent:false, reportPeriodVerified:true}), false,
    "stale or conflicting source cannot claim verified zero");
  assert.equal(zeroEvidence(importsToday, {safeForCurrent:true, reportPeriodVerified:false}), false,
    "unverified reporting period cannot claim verified zero");
  assert.equal(zeroEvidence(importsToday, trusted, {"SYN-01":{surveyDate:"2026-10-20"}}), false,
    "existing survey evidence cannot be labeled NO RESPONSES");
  assert.equal(zeroEvidence({imports:[null, {}, {refreshDate:"2026-02-30"}]}, trusted), false,
    "invalid or null import lineage is not a verified zero source");
});

function meetingNps(dealer, evidence) {
  const ctx = vm.createContext({freshness, Date, sourceFreshness: (key) => {
    assert.equal(key, "csi");
    return evidence;
  }});
  vm.runInContext(production + "\nthis.nps=verifiedMeetingCsiNps;", ctx);
  return ctx.nps(dealer);
}

test("Meeting NPS health tile and comparison suppress missing, stale, conflicting or unverified CSI", () => {
  assert.ok(app.includes('value: verifiedMeetingCsiNps(dealer)'),
    "production Meeting NPS tile must consume verified source-backed value");
  assert.ok(app.includes('item.key === "dealerNps" && !Number.isFinite(item.value)'),
    "an unverified CSI number must also withhold historical trend comparisons");
  const verified = {safeForCurrent: true, reportPeriodVerified: true};
  const invalidCases = [
    {status: "missing", safeForCurrent: false, reportPeriodVerified: false},
    {status: "stale", safeForCurrent: false, reportPeriodVerified: true},
    {status: "invalid", safeForCurrent: false, reportPeriodVerified: true},
    {status: "conflicting", safeForCurrent: false, reportPeriodVerified: true},
    {status: "temporarily-unavailable", safeForCurrent: false, reportPeriodVerified: true},
    {status: "current", safeForCurrent: true, reportPeriodVerified: false}
  ];
  for (const evidence of invalidCases) {
    for (const nps of [0, 73, -45]) {
      assert.equal(meetingNps({responses: 8, nps}, evidence), null,
        "unverified source cannot display numeric NPS " + evidence.status);
    }
  }
  assert.equal(meetingNps({responses: 8, nps: 73}, verified), 73);
  assert.equal(meetingNps({responses: 8, nps: 0}, verified), 0,
    "genuine sourced NPS zero is not unknown");
  assert.equal(meetingNps({responses: 0, nps: 0}, verified), null,
    "zero survey responses cannot be relabeled as a numeric NPS score");
  assert.equal(meetingNps({responses: 8, nps: NaN}, verified), null);
  assert.equal(meetingNps({responses: 8, nps: undefined}, verified), null);
});

test("actual Meeting cycle baseline cannot persist unsourced CSI NPS", () => {
  const start = app.indexOf("  function meetingCurrentMetrics()");
  const end = app.indexOf("  async function ensureMeetingCycleBaseline(", start);
  assert.ok(start >= 0 && end > start, "production persisted Meeting-cycle selector exists");
  assert.ok(app.slice(start, end).includes("verifiedMeetingCsiNps(dealer)"),
    "durable Meeting-cycle comparison baseline must share source authority with visible tile");
  for (const validValue of [null, 0, 73]) {
    const ctx = vm.createContext({
      model: {settings: {csiPeriodStart: "2026-10-01"}},
      latestVerifiedMeetingSnapshot: () => null,
      latestOperationalSnapshot: () => null,
      currentCsiSurveys: () => ({}),
      npsSummary: () => ({responses: 8, nps: 73}),
      controllableTeamStatus: () => ({progress: null}),
      localDateKey: () => "2026-10-20",
      virObservationDate: () => "",
      verifiedMeetingCsiNps: () => validValue
    });
    vm.runInContext(app.slice(start, end) + "\nthis.metrics=meetingCurrentMetrics;", ctx);
    const actual = ctx.metrics();
    assert.equal(actual.dealerNps.value, validValue,
      "saved comparison must not reintroduce unverified CSI NPS");
  }
});

test("actual Meeting CSI evidence rejects current-looking sources without verified reporting period", () => {
  const start = app.indexOf("  function metricEvidence({");
  const end = app.indexOf("  function metricEvidenceText(", start);
  const csi = app.indexOf("  function csiMetricEvidence(");
  const csiEnd = app.indexOf("  const rawVirMeetingEvidence=", csi);
  assert.ok(start >= 0 && end > start && csi >= 0 && csiEnd > csi,
    "production evidence and CSI adapters exist");
  const check = evidence => {
    const ctx = vm.createContext({
      model: {settings: {csiPeriodStart: "2026-10-01"}},
      localDateKey: () => "2026-10-20",
      currentCsiSurveys: () => ({"SYN-01": {surveyDate: "2026-10-19"}}),
      sourceFreshness: key => {assert.equal(key, "csi"); return evidence;},
      metricDependencyEvidence: (_, base) => base
    });
    vm.runInContext(app.slice(start, end) + "\n" + app.slice(csi, csiEnd) +
      "\nthis.result=csiMetricEvidence;", ctx);
    return ctx.result({responses: 1, promoters: 1, passives: 0, detractors: 0, nps: 100});
  };
  const unverified = check({status: "current", safeForCurrent: true,
    reportPeriodVerified: false});
  assert.equal(unverified.verified, false);
  assert.equal(unverified.value, null);
  assert.equal(unverified.status, "missing-period",
    "fresh import clock alone cannot certify survey KPI reporting scope");
  const trusted = check({status: "current", safeForCurrent: true,
    reportPeriodVerified: true});
  assert.equal(trusted.verified, true);
  assert.equal(trusted.value, 100);
});
