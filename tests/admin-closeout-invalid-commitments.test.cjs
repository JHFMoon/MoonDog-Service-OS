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

test("malformed historical commitment dates do not create false missed-promise coaching", () => {
  const revisions = [
    {at:"2026-03-01T10:00:00.000Z",previous:{taskDate:"2026-02-31",expectedCloseDate:"2026-03-10"}},
    {at:"2026-03-01T10:00:00.000Z",previous:{taskDate:"0000-01-01",expectedCloseDate:"2026-03-10"}},
    {at:"2026-03-01T10:00:00.000Z",previous:{taskDate:"bad-date",expectedCloseDate:"2026-03-10"}},
    {at:"2026-03-01T10:00:00.000Z",previous:{taskDate:"2026-03-01",expectedCloseDate:"2026-03-10"}}
  ];
  const state = logic.adminCloseoutState(record("2026-03-05","2026-03-10",{revisions}),"2026-03-01");
  assert.equal(state.revisionCount,4,"retain full administrative revision audit history");
  assert.equal(state.missedRevisions,0,"no false manager missed-promise coaching");
  assert.equal(state.needsCommitment,false,"valid current commitments remain unaffected");
});

test("missing or malformed revision timestamps and entries are not verified misses", () => {
  const revisions = [
    null, 42, {},
    {at:"2026-03-01garbage",previous:{taskDate:"2026-02-28"}},
    {at:"2026-02-31T10:00:00Z",previous:{taskDate:"2026-02-28"}},
    {at:"2026-03-01T25:00:00Z",previous:{taskDate:"2026-02-28"}},
    {at:"2026-03-01T10:61:00Z",previous:{taskDate:"2026-02-28"}},
    {at:"2026-03-01T10:00:00",previous:{taskDate:"2026-02-28"}},
    {at:"2026-03-01T10:00:00+14:30",previous:{taskDate:"2026-02-28"}},
    {at:"2026-03-01T10:00:00.000Z"}
  ];
  const state = logic.adminCloseoutState(record("2026-03-05","2026-03-10",{revisions}),"2026-03-01");
  assert.equal(state.revisionCount,revisions.length);
  assert.equal(state.missedRevisions,0);
});

test("valid historical missed commitments still count once per revision", () => {
  const revisions = [
    {at:"2026-03-01T10:00:00.000Z",previous:{taskDate:"2026-02-28",expectedCloseDate:"2026-02-27"}},
    {at:"2026-03-02T10:00:00-07:00",previous:{taskDate:"2026-03-01",expectedCloseDate:"2026-03-10"}},
    {at:"2026-03-02T10:00:00Z",previous:{taskDate:"2026-03-02",expectedCloseDate:"2026-03-10"}},
    {at:"2026-03-02T10:00:00Z",previous:{taskDate:"2026-03-10",expectedCloseDate:"2026-03-12"}}
  ];
  const state = logic.adminCloseoutState(record("2026-03-05","2026-03-10",{revisions}),"2026-03-02");
  assert.equal(state.missedRevisions,2,"real late revisions still trigger manager follow-up");
  assert.equal(state.revisionCount,4);
  assert.equal(state.overdue,false,"revision audit history is not a current overdue promise");
});
