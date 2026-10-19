"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Execute the shipped manager-only admin closeout logic in a synthetic context.
const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const first = app.indexOf("  const ADMIN_CLOSEOUT_BLOCKERS =");
const last = app.indexOf("  function cdkStatusIndicator(", first);
assert.ok(first >= 0 && last > first, "production admin closeout boundary exists");
const context = {
  localDateKey: () => "2026-03-01",
  isClosedManagement: management => String(management?.status || "").toLowerCase() === "closed"
};
const logic = vm.runInNewContext(app.slice(first, last) +
  "\n({adminCloseoutDaysLate, adminCloseoutState, adminCloseoutEscalations, nextAdminCloseout})", context);
const record = (taskDate, expectedCloseDate, additions = {}) => ({
  id: "SYNTHETIC-ADMIN", ro: "SYNTHETIC-ADMIN",
  management: {
    status: "Ready for Review",
    adminCloseout: {
      blocker: "Warranty approval or processing",
      physicalWorkStatus: "verified",
      taskDate, expectedCloseDate, revisions: [], ...additions
    }
  }
});

test("impossible saved advisor-task dates cannot create false overdue administrative promises", () => {
  for (const invalid of ["2026-02-29", "2026-02-31", "2026-04-31", "2026-13-01", "2026-00-11", "0000-01-01", "bad", "2026-10-1"]) {
    const state = logic.adminCloseoutState(record(invalid, "2026-03-05"), "2026-03-01");
    assert.equal(state.taskDate, "", invalid + " is not a proven task promise");
    assert.equal(state.needsCommitment, true, invalid + " must request an actual commitment");
    assert.equal(state.taskOverdue, false, invalid + " must not be an overdue customer promise");
    assert.equal(state.taskDaysLate, 0, invalid + " has zero verified late days");
  }
});

test("invalid expected-close dates are missing evidence rather than overdue RO deadlines", () => {
  const state = logic.adminCloseoutState(record("2026-03-05", "2026-02-31"), "2026-03-01");
  assert.equal(state.closeDate, "");
  assert.equal(state.needsCommitment, true);
  assert.equal(state.overdue, false);
  assert.equal(state.closeDaysLate, 0);
  const attention = logic.adminCloseoutEscalations([record("2026-02-31", "2026-03-05")], "2026-03-01");
  assert.equal(attention.length, 1, "invalid commitments remain actionable for manual correction");
  assert.equal(attention[0].priority, 1, "missing verified commitment must not outrank a genuinely missed one");
});

test("new or revised administrative commitments reject impossible dates before creating history", () => {
  for (const invalid of ["2026-02-29", "2026-02-31", "2026-13-01", "0000-01-01", "not-a-date"]) {
    assert.throws(() => logic.nextAdminCloseout(null, "Customer pickup", invalid, "2026-03-05", "", "2026-03-01T09:00:00Z"), /valid advisor task date/, invalid);
    assert.throws(() => logic.nextAdminCloseout(null, "Customer pickup", "2026-03-05", invalid, "", "2026-03-01T09:00:00Z"), /valid expected RO close date/, invalid);
  }
});

test("real leap days and legitimate due, missed and future dates keep their established behavior", () => {
  assert.equal(logic.adminCloseoutDaysLate("2028-02-29", "2028-03-02"), 2);
  assert.equal(logic.adminCloseoutDaysLate("2026-02-31", "2026-03-02"), 0);
  assert.equal(logic.adminCloseoutDaysLate("0000-01-01", "2026-03-02"), 0);
  const prior = logic.nextAdminCloseout(null, "Customer pickup", "2028-02-29", "2028-03-05", "", "2028-02-28T09:00:00Z");
  assert.equal(prior.taskDate, "2028-02-29");
  const overdue = logic.adminCloseoutState(record("2026-02-28", "2026-03-05"), "2026-03-01");
  assert.equal(overdue.taskOverdue, true);
  assert.equal(overdue.taskDaysLate, 1);
  assert.equal(overdue.needsCommitment, false);
  const due = logic.adminCloseoutState(record("2026-03-01", "2026-03-05"), "2026-03-01");
  assert.equal(due.taskDueToday, true);
  assert.equal(due.overdue, false);
});

test("unverified physical work and closed ROs remain excluded from manager admin exceptions", () => {
  const noProof = record("2026-02-31", "2026-03-05", {physicalWorkStatus: "unverified"});
  assert.equal(logic.adminCloseoutState(noProof, "2026-03-01").active, false);
  const closed = record("2026-02-31", "2026-03-05");
  closed.management.status = "Closed";
  assert.equal(logic.adminCloseoutState(closed, "2026-03-01").active, false);
});
