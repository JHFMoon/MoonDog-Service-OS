"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const freshness = require("../assets/freshness.js");

test("missing CSI import dates cannot fabricate a report observation or refresh", () => {
  const evidence = freshness.csiTrendEvidence({
    imports: [{}, {importedAt: null}, {refreshDate: ""}, null],
    today: "2026-10-30", surveys: {}
  });
  assert.deepEqual(evidence.reportDates, []);
  assert.deepEqual(evidence.importDates, []);
  assert.equal(evidence.lastReportObservation, "");
  assert.equal(evidence.lastImportDate, "");
  assert.equal(evidence.verifiedScope, null);
});

test("local CSI imports, including validated scopes, do not become reported observations", () => {
  const imports = [
    {importedAt: "2026-10-27T16:00:00Z", reportObservationDate: "2026-10-27"},
    {refreshDate: "2026-10-28", importedAt: "2026-10-28T18:00:00Z",
      scopeVerified: true, scopeStart: "2026-10-01", scopeEnd: "2026-10-26"},
    {refreshDate: "2026-02-30"},
    {refreshDate: "2026-11-01"},
    null
  ];
  const original = JSON.stringify(imports);
  const evidence = freshness.csiTrendEvidence({
    imports, today: "2026-10-30",
    surveys: {example: {surveyDate: "2026-10-29", advisorCode: "A"}}
  });
  assert.deepEqual(evidence.reportDates, [],
    "a recent local import and even a verified export scope do not identify the source observation date");
  assert.equal(evidence.lastReportObservation, "");
  assert.deepEqual(evidence.importDates, ["2026-10-27", "2026-10-28"]);
  assert.equal(evidence.lastImportDate, "2026-10-28");
  assert.equal(evidence.verifiedScope.scopeEnd, "2026-10-26",
    "validated cumulative scope remains separately available");
  assert.deepEqual(evidence.responseDates, ["2026-10-29"],
    "survey events remain separate from import and report observation dates");
  assert.equal(JSON.stringify(imports), original, "source evidence must never be mutated");
});

test("only explicit verified CSI report observations supply source observation points", () => {
  const evidence = freshness.csiTrendEvidence({
    imports: [
      {refreshDate: "2026-10-28", reportObservationVerified: true, reportObservationDate: "2026-10-25"},
      {importedAt: "2026-10-30T16:00:00Z", reportObservationVerified: true,
        reportObservationDate: "2026-10-29"},
      {refreshDate: "2026-10-30", reportObservationVerified: false,
        reportObservationDate: "2026-10-30"},
      {refreshDate: "2026-10-29", reportObservationVerified: true,
        reportObservationDate: "2026-02-30"},
      {reportObservationVerified: true, reportObservationDate: "2026-11-01"}
    ],
    today: "2026-10-30", surveys: {}
  });
  assert.deepEqual(evidence.reportDates, ["2026-10-25", "2026-10-29"]);
  assert.equal(evidence.lastReportObservation, "2026-10-29");
  assert.deepEqual(evidence.importDates, ["2026-10-28", "2026-10-29", "2026-10-30"]);
  assert.equal(evidence.lastImportDate, "2026-10-30");
  assert.equal(evidence.lastResponseEvent, "");
});
