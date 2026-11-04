"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  function sourceFreshness(");
const end = app.indexOf("  function metricDependencyEvidence(", start);
assert.ok(start >= 0 && end > start, "shipped source-confidence adapter must exist");
function confidence(item) {
  const model = {recovery: {supervisorWorkbook: item}};
  const prior = JSON.stringify(item);
  const ctx = vm.createContext({
    freshness, model, Date,
    sourceExpectation: () => "recommended",
    businessTimeZone: () => "UTC",
    localDateKey: value => value instanceof Date ? value.toISOString().slice(0, 10) : "2026-11-02"
  });
  vm.runInContext(app.slice(start, end) + "\nthis.evidence = sourceFreshness;", ctx);
  const evidence = ctx.evidence("supervisorWorkbook", {item, today: "2026-11-02"});
  assert.equal(JSON.stringify(item), prior, "source confidence cannot modify the retained artifact");
  return evidence;
}

test("verified Supervisor Workbook issue time remains current unless state is explicitly stale", () => {
  const valid = confidence({generatedAt: "2026-11-02T12:00:00.000Z", stale: false});
  assert.equal(valid.status, "current");
  assert.equal(valid.safeForCurrent, true);
  assert.equal(valid.reportPeriodVerified, false, "state-current does not certify historical coverage");
  const stale = confidence({generatedAt: "2026-11-02T12:00:00Z", stale: true});
  assert.equal(stale.status, "stale");
  assert.equal(stale.safeForCurrent, false);
  assert.equal(confidence(null).status, "missing");
});

test("invalid, non-ISO, impossible, numeric and future timestamps cannot certify current workbook", () => {
  const bad = [
    "not-a-timestamp", "2026-11-02", "2026-02-30T12:00:00Z",
    "2026-11-02T25:00:00Z", "2026-11-02T12:00:00+99:99",
    new Date(Date.now() + 60 * 60 * 1000).toISOString(), 1780000000000
  ];
  for (const stamp of bad) {
    const evidence = confidence({generatedAt: stamp, stale: false});
    assert.equal(evidence.status, "invalid", String(stamp));
    assert.equal(evidence.safeForCurrent, false, String(stamp));
    assert.equal(evidence.safeForPurpose, false, String(stamp));
    assert.equal(evidence.reportPeriodVerified, false, String(stamp));
    assert.match(evidence.reason, /generation timestamp is (?:missing, )?invalid or future-dated/, String(stamp));
  }
});

test("present workbook without a verified issuance stamp is invalid, not a missing source or zero", () => {
  for (const item of [{}, {generatedAt: ""}, {generatedAt: null},
    {generatedAt: undefined}, {generatedAt: 0}]) {
    const health = confidence(item);
    assert.equal(health.status, "invalid", JSON.stringify(item));
    assert.equal(health.loaded, true, "the retained artifact exists but has corrupt lineage");
    assert.equal(health.safeForCurrent, false);
    assert.equal(health.safeForPurpose, false);
    assert.equal(health.reportPeriodVerified, false);
    assert.equal(freshness.evaluateMetric([health]).verified, false, "unknown data is not zero");
    assert.match(health.reason, /generation timestamp is missing, invalid or future-dated/);
  }
  assert.equal(confidence(undefined).status, "missing", "explicitly absent remains absent");
  assert.equal(confidence(null).status, "missing", "null artifact remains absent");
});
