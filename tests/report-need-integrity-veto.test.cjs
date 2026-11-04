"use strict";

// #59-01: report readiness cannot hide an explicit source-integrity defect.
// Synthetic source evidence only; no Workspace or customer records.
const test = require("node:test");
const assert = require("node:assert/strict");
const freshness = require("../assets/freshness.js");

const today = "2026-11-02";

function check(key, evidence, extra = {}) {
  const before = JSON.stringify(evidence);
  const result = freshness.evaluateReportNeed({key, today, evidence, currentSnapshot: true,
    activeFeature: true, arrivalPlanning: true, ...extra});
  assert.equal(JSON.stringify(evidence), before, "readiness must not mutate source evidence");
  return result;
}

test("a current workload never conceals conflicting, unsupported or unverified source authority", () => {
  const blockedStatuses = ["invalid", "conflicting", "unsupported", "unverified"];
  for (const key of ["openRo", "appointments", "sapr", "nextAppointments", "csi", "vir", "menu"]) {
    for (const status of blockedStatuses) {
      const evidence = Object.freeze({key, label: "Synthetic " + key,
        loaded: true, status, safeForCurrent: false, safeForPurpose: false,
        reason: "Synthetic explicit source integrity defect"});
      const need = check(key, evidence);
      assert.equal(need.state, "NEED NOW", key + " " + status);
      assert.equal(need.actionable, true, key + " " + status);
      assert.equal(need.actions.length, 1, key + " " + status);
    }
  }
});

test("verified current sources and intentional missing-source workload fallback remain unchanged", () => {
  const current = freshness.evaluateSource({
    key: "openRo", exists: true, today, sourceDate: today
  });
  assert.equal(check("openRo", current).state, "CURRENT");
  const missing = freshness.evaluateSource({key: "openRo", exists: false, today});
  assert.equal(check("openRo", missing).state, "CURRENT",
    "independently verified workload may still cover a genuinely missing Open RO report");
  assert.equal(check("openRo", missing, {currentSnapshot: false}).state, "NEED NOW");
});

test("not-used and temporarily-unavailable policy states are still non-actionable", () => {
  const excluded = freshness.evaluateSource({
    key: "sapr", exists: false, today, expectation: "not-used"
  });
  const deferred = freshness.evaluateSource({
    key: "csi", exists: false, today, expectation: "temporarily-unavailable"
  });
  for (const evidence of [excluded, deferred]) {
    const need = check(evidence.key, evidence);
    assert.equal(need.state, "OPTIONAL", evidence.status);
    assert.equal(need.actionable, false, evidence.status);
  }
});

test("stale-but-independent current workload fallback is not changed by the explicit-integrity veto", () => {
  const stale = freshness.evaluateSource({
    key: "openRo", exists: true, today, sourceDate: "2026-10-31"
  });
  assert.equal(stale.status, "stale");
  assert.equal(check("openRo", stale).state, "CURRENT");
  assert.equal(check("openRo", stale, {currentSnapshot: false}).state, "NEED NOW");
});

test("production KPI evidence never presents a known zero as verified when source integrity conflicts", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
  function extract(start, end) {
    const i = app.indexOf(start), j = app.indexOf(end, i);
    assert.ok(i >= 0 && j > i, "production metric adapter must exist");
    return app.slice(i, j);
  }
  const source = extract("  function metricEvidence({", "  function metricEvidenceText(") + "\n" +
    extract("  function metricDependencyEvidence(", "  function sourceStatusLabel(");
  const ctx = vm.createContext({freshness});
  vm.runInContext(source + "\nthis.api = {metricEvidence, metricDependencyEvidence};", ctx);
  for (const status of ["invalid", "conflicting", "unsupported", "unverified"]) {
    const dependency = Object.freeze({
      key: "openRo", label: "Open RO", status, loaded: true, safeForPurpose: false,
      safeForCurrent: false, reason: "Synthetic source-integrity veto"
    });
    const base = ctx.api.metricEvidence({value: 0, source: "Synthetic source", period: today});
    assert.equal(base.verified, true, "verified zero positive control");
    const observed = ctx.api.metricDependencyEvidence([dependency], base);
    assert.equal(observed.verified, false, status);
    assert.equal(observed.value, null, status + " cannot imply a certified zero");
    assert.equal(observed.lastVerifiedValue, 0, status + " may retain non-authoritative history");
    assert.equal(observed.status, status);
    assert.equal(observed.source, "Open RO");
  }
});
