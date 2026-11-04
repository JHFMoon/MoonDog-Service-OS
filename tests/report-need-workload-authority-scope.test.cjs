"use strict";

// #59-01: the independently verified workload fallback is Open RO-specific.
// Synthetic source confidence only; never reads customer or Workspace data.
const test = require("node:test");
const assert = require("node:assert/strict");
const freshness = require("../assets/freshness.js");

const today = "2026-11-04"; // Wednesday; prior operating date is Tuesday.
const otherFamilies = [
  "sapr", "csi", "nextAppointments", "vir", "menu", "appointments"
];

function readiness(key, evidence, options = {}) {
  const before = JSON.stringify(evidence);
  const value = freshness.evaluateReportNeed({
    key, today, evidence, currentSnapshot: true,
    activeFeature: true, arrivalPlanning: true, ...options
  });
  assert.equal(JSON.stringify(evidence), before,
    "readiness must leave source authority and provenance untouched");
  return value;
}

test("unrelated current workload never verifies an absent report family", () => {
  for (const key of otherFamilies) {
    const missing = freshness.evaluateSource({key, today, exists: false});
    assert.equal(missing.status, "missing", key);
    const need = readiness(key, missing);
    assert.equal(need.state, "NEED NOW", key + " must have its own report");
    assert.equal(need.actionable, true, key);
    assert.equal(need.actions.length, 1, key);
  }
});

test("unrelated workload cannot revive stale report periods", () => {
  for (const key of ["sapr", "nextAppointments", "vir"]) {
    const stale = freshness.evaluateSource({
      key, today, exists: true,
      periodStart: "2026-10-01", periodEnd: "2026-10-20"
    });
    assert.equal(stale.status, "stale", key);
    const need = readiness(key, stale);
    assert.equal(need.state, "NEED NOW", key);
    assert.equal(need.actionable, true, key);
  }
});

test("Open RO retains its separately verified current-workload fallback", () => {
  const missing = freshness.evaluateSource({key: "openRo", today, exists: false});
  assert.equal(readiness("openRo", missing).state, "CURRENT");
  assert.equal(readiness("openRo", missing, {currentSnapshot: false}).state, "NEED NOW");
  const stale = freshness.evaluateSource({
    key: "openRo", today, exists: true, sourceDate: "2026-11-02"
  });
  assert.equal(stale.status, "stale");
  assert.equal(readiness("openRo", stale).state, "CURRENT");
  const invalid = freshness.evaluateSource({
    key: "openRo", today, exists: true, sourceDate: today,
    invalid: "Synthetic invalid Open RO report authority"
  });
  assert.equal(readiness("openRo", invalid).state, "NEED NOW");
});

test("valid SAPR authority stays current without borrowing workload", () => {
  const sapr = freshness.evaluateSource({
    key: "sapr", today, exists: true,
    periodStart: "2026-11-01", periodEnd: "2026-11-03"
  });
  assert.equal(sapr.status, "current");
  assert.equal(readiness("sapr", sapr, {currentSnapshot: false}).state, "CURRENT");
  assert.equal(readiness("sapr", sapr).state, "CURRENT");
});

test("explicit not-used and temporarily-unavailable policies remain non-actionable", () => {
  for (const [key, expectation] of [
    ["sapr", "not-used"],
    ["csi", "temporarily-unavailable"]
  ]) {
    const excluded = freshness.evaluateSource({key, today, exists: false, expectation});
    const need = readiness(key, excluded);
    assert.equal(need.state, "OPTIONAL", key);
    assert.equal(need.actionable, false, key);
  }
});
