"use strict";

// #59-01 synthetic report-readiness authority: an unknown/partial status
// must not be converted into CURRENT by an unrelated current workload.
const test = require("node:test");
const assert = require("node:assert/strict");
const freshness = require("../assets/freshness.js");
const today = "2026-11-02";
const families = ["openRo", "appointments", "sapr", "nextAppointments", "csi", "vir", "menu"];
function check(key, evidence, currentSnapshot = true) {
  const original = JSON.stringify(evidence);
  const need = freshness.evaluateReportNeed({
    key, evidence, today, currentSnapshot,
    activeFeature: true, arrivalPlanning: true
  });
  assert.equal(JSON.stringify(evidence), original, "readiness is a read-only selector");
  return need;
}

test("unknown, blank, pending and bogus confidence cannot claim report readiness in any operational family", () => {
  for (const key of families) {
    for (const status of [undefined, null, "", "unknown", "pending", "loading", "verified"]) {
      const evidence = Object.freeze({
        key, status, loaded: true, safeForCurrent: true, safeForPurpose: true,
        label: "Synthetic " + key, reason: "No canonical source authority proved"
      });
      const result = check(key, evidence);
      assert.equal(result.state, "NEED NOW", key + " " + String(status));
      assert.equal(result.actionable, true, key + " " + String(status));
      assert.equal(result.actions.length, 1, key + " " + String(status));
    }
    const absent = check(key, {});
    assert.equal(absent.state, "NEED NOW", key + " entirely absent evidence");
  }
});

test("recognized invalid, conflicting, unsupported and unverified states remain blocked", () => {
  for (const key of families) for (const status of ["invalid", "conflicting", "unsupported", "unverified"]) {
    const evidence = Object.freeze({key, status, loaded: true, safeForCurrent: false, safeForPurpose: false});
    assert.equal(check(key, evidence).state, "NEED NOW", key + " " + status);
  }
});

test("canonical current, missing and stale Open RO evidence preserve authorized independent workload behavior", () => {
  const current = freshness.evaluateSource({key: "openRo", today, exists: true, sourceDate: today});
  const missing = freshness.evaluateSource({key: "openRo", today, exists: false});
  const stale = freshness.evaluateSource({key: "openRo", today, exists: true, sourceDate: "2026-10-31"});
  assert.equal(current.status, "current");
  assert.equal(missing.status, "missing");
  assert.equal(stale.status, "stale");
  assert.equal(check("openRo", current).state, "CURRENT");
  assert.equal(check("openRo", missing).state, "CURRENT");
  assert.equal(check("openRo", stale).state, "CURRENT");
  assert.equal(check("openRo", missing, false).state, "NEED NOW");
  assert.equal(check("openRo", stale, false).state, "NEED NOW");
});

test("not-used and unavailable policy remain non-actionable, not verified as current", () => {
  for (const [key, expectation] of [["sapr", "not-used"], ["csi", "temporarily-unavailable"]]) {
    const state = freshness.evaluateSource({key, today, exists: false, expectation});
    const need = check(key, state);
    assert.equal(need.state, "OPTIONAL", expectation);
    assert.equal(need.actionable, false, expectation);
    assert.equal(freshness.evaluateMetric([state]).verified, false);
  }
});

test("valid current source can still satisfy need without independent workload fallback", () => {
  const current = freshness.evaluateSource({key: "openRo", today, exists: true, sourceDate: today});
  assert.equal(check("openRo", current, false).state, "CURRENT");
});
