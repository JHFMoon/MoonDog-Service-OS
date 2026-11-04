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
