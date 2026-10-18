"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

// Execute the actual shipped manager-task selector and business-date rules.
require("../assets/freshness.js");
const { eligible, hasFuturePlan } = require("../assets/daily-engine.js");
globalThis.__moondogSettingsModel = { settings: { store: { timeZone: "America/Los_Angeles" } } };

const now = Date.parse("2026-01-20T18:00:00.000Z");
function completedReview(reviewDate, rank = 4) {
  const task = {
    id: "ro:SYNTHETIC-001",
    type: "ro",
    rank,
    hard: rank <= 3,
    fingerprint: "synthetic-unchanged",
    record: { id: "SYNTHETIC-001", management: {
      reviewDate,
      nextAction: "Confirm a synthetic part's ETA",
      owner: "Test advisor"
    } }
  };
  const events = [{
    at: "2026-01-19T18:00:00.000Z",
    details: {
      taskId: task.id,
      action: "completed",
      rank: 4,
      fingerprint: task.fingerprint,
      until: "2026-01-19T19:00:00.000Z"
    }
  }];
  return { task, events };
}

test("impossible calendar dates cannot suppress an aged RO review after the previous acknowledgment expires", () => {
  for (const date of ["2026-02-29", "2026-02-31", "2026-04-31", "2026-13-01", "2026-99-99"]) {
    const { task, events } = completedReview(date);
    assert.equal(hasFuturePlan(task.record, "2026-01-20"), false, date + " must not be a valid future plan");
    assert.equal(eligible(task, events, now), true, date + " must not silence the manager's RO review");
  }
});

test("a real future RO review plan still suppresses a routine repeat until that date", () => {
  const { task, events } = completedReview("2026-02-28");
  assert.equal(hasFuturePlan(task.record, "2026-01-20"), true);
  assert.equal(eligible(task, events, now), false);
});

test("hard escalation still takes priority over a future review plan", () => {
  const { task, events } = completedReview("2026-02-28", 2);
  assert.equal(eligible(task, events, now), true);
});
