"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const freshness = require("../assets/freshness.js");

const TODAY = "2026-11-02";
const families = Object.keys(freshness.SOURCE_DEFINITIONS);

test("historical lookup never certifies a future date across all source families", () => {
  assert.equal(families.length, 14, "exercise the full canonical source catalog");
  for (const key of families) {
    const source = {
      key, exists: true, purpose: "historical", today: TODAY,
      periodStart: "2026-10-01", periodEnd: "2026-11-07",
      targetStart: "2026-11-03", targetEnd: "2026-11-03",
      sourceTimestamp: "2026-11-02T18:00:00.000Z"
    };
    const before = JSON.stringify(source);
    const evidence = freshness.evaluateSource(source);
    assert.equal(evidence.status, "stale", key + " future day");
    assert.equal(evidence.safeForPurpose, false, key);
    assert.equal(freshness.evaluateMetric([evidence]).verified, false, key);
    assert.equal(JSON.stringify(source), before, key + " lookup must not modify retained source");

    const crossedToday = freshness.evaluateSource({
      ...source, targetStart: TODAY, targetEnd: "2026-11-03"
    });
    assert.equal(crossedToday.status, "stale", key + " interval extends into future");
    assert.equal(crossedToday.safeForPurpose, false, key);

    const invalidToday = freshness.evaluateSource({
      ...source, today: "2026-02-30",
      targetStart: "2026-10-01", targetEnd: "2026-10-01"
    });
    assert.equal(invalidToday.status, "stale", key + " invalid reference business date");
  }
});

test("future-dated SAPR end cannot verify an otherwise past historical interval", () => {
  const source = Object.freeze({
    key: "sapr", exists: true, purpose: "historical", today: "2026-11-16",
    periodStart: "2026-10-01", periodEnd: "2026-12-01",
    targetStart: "2026-10-15", targetEnd: "2026-10-20"
  });
  const before = JSON.stringify(source);
  const future = freshness.evaluateSource(source);
  assert.equal(future.status, "stale", "future SAPR report end is not completed source coverage");
  assert.equal(future.safeForPurpose, false);
  assert.equal(freshness.evaluateMetric([future]).verified, false);
  assert.equal(JSON.stringify(source), before, "source and declared period remain untouched");

  const corrected = freshness.evaluateSource({...source, periodEnd: source.today});
  assert.equal(corrected.status, "historical-valid", "verified completed SAPR interval still works");
  assert.equal(freshness.evaluateMetric([corrected]).verified, true);
  const forward = freshness.evaluateSource({...source, key: "nextAppointments"});
  assert.equal(forward.status, "historical-valid", "forward-looking appointments keep valid future coverage");
});

test("genuinely covered historical intervals and end-only observations remain verified", () => {
  for (const key of families) {
    const historical = freshness.evaluateSource({
      key, exists: true, purpose: "historical", today: TODAY,
      periodStart: "2026-10-01", periodEnd: TODAY,
      targetStart: "2026-10-20", targetEnd: TODAY
    });
    assert.equal(historical.status, "historical-valid", key + " real past interval");
    assert.equal(historical.safeForPurpose, true, key);
    assert.equal(freshness.evaluateMetric([historical]).verified, true, key);

    const point = freshness.evaluateSource({
      key, exists: true, purpose: "historical", today: TODAY,
      periodEnd: "2026-10-31",
      targetStart: "2026-10-31", targetEnd: "2026-10-31"
    });
    assert.equal(point.status, "historical-valid", key + " valid point observation");

    const expandedPoint = freshness.evaluateSource({
      key, exists: true, purpose: "historical", today: TODAY,
      periodEnd: "2026-10-31",
      targetStart: "2026-10-01", targetEnd: "2026-10-31"
    });
    assert.equal(expandedPoint.status, "stale", key + " undated-start must not cover entire month");
  }
});
