"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = source.indexOf("  function adminCloseoutDaysLate(");
const end = source.indexOf("  function nextAdminCloseout(", start);
assert.ok(start !== -1 && end > start, "manager-only closeout deadline logic is available");
const implementation = source.slice(start, end);
const evaluate = vm.runInNewContext(`(() => {
  function localDateKey() { return "2026-10-12"; }
  function isClosedManagement(management) { return String(management?.status || "").toLowerCase() === "closed"; }
  ${implementation}
  return adminCloseoutState;
})()`);

function openAdmin(taskDate, expectedCloseDate, extras = {}) {
  return {
    management: {
      status: "Ready for Review", reviewDate: taskDate,
      adminCloseout: {
        blocker: "MaxCare / extended-warranty claim", physicalWorkStatus: "verified", taskDate,
        expectedCloseDate, revisions: [], ...extras
      }
    }
  };
}

test("future closeout promises remain quiet, not incorrectly overdue", () => {
  const current = evaluate(openAdmin("2026-10-15", "2026-10-16"));
  assert.equal(current.active, true);
  assert.equal(current.dueToday, false);
  assert.equal(current.overdue, false);
  assert.equal(current.needsCommitment, false);
});

test("task and RO-close deadlines surface separately when due today", () => {
  const task = evaluate(openAdmin("2026-10-12", "2026-10-19"));
  assert.equal(task.taskDueToday, true);
  assert.equal(task.closeDueToday, false);
  assert.equal(task.dueToday, true);
  assert.equal(task.overdue, false);
  const close = evaluate(openAdmin("2026-10-19", "2026-10-12"));
  assert.equal(close.taskDueToday, false);
  assert.equal(close.closeDueToday, true);
  assert.equal(close.dueToday, true);
  assert.equal(close.overdue, false);
});

test("each overdue promise is identified even when the other date is future", () => {
  const task = evaluate(openAdmin("2026-10-11", "2026-10-19"));
  assert.equal(task.taskOverdue, true);
  assert.equal(task.closeOverdue, false);
  assert.equal(task.overdue, true);
  const close = evaluate(openAdmin("2026-10-19", "2026-10-11"));
  assert.equal(close.taskOverdue, false);
  assert.equal(close.closeOverdue, true);
  assert.equal(close.overdue, true);
});

test("unknown administrative task or close date stays commitment needed", () => {
  assert.equal(evaluate(openAdmin("", "2026-10-15")).needsCommitment, true);
  assert.equal(evaluate(openAdmin("2026-10-15", "")).needsCommitment, true);
  assert.equal(evaluate(openAdmin("", "")).needsCommitment, true);
});

test("verified closed and non-administrative ROs do not resurface", () => {
  const closed = openAdmin("2026-10-11", "2026-10-11");
  closed.management.status = "Closed";
  assert.equal(evaluate(closed).active, false);
  assert.equal(evaluate(closed).overdue, false);
  assert.equal(evaluate(closed).dueToday, false);
  assert.equal(evaluate({management: {status: "Repair", reviewDate: "2026-10-11"}}).active, false);
});

test("historical revisions remain available without treating them as current due dates", () => {
  const updated = evaluate(openAdmin("2026-10-18", "2026-10-20", {
    revisions: [{
      at: "2026-10-11T12:00:00Z", reason: "Advisor revised commitment",
      previous: {taskDate: "2026-10-10", expectedCloseDate: "2026-10-11"},
      next: {taskDate: "2026-10-18", expectedCloseDate: "2026-10-20"}
    }]
  }));
  assert.equal(updated.revisionCount, 1);
  assert.equal(updated.overdue, false);
});

test("the manager gets explicit due-today and overdue filters", () => {
  assert.match(source, /value="admin-due-today"/);
  assert.match(source, /attention === "admin-due-today"/);
  assert.match(source, /admin\.closeDueToday/);
  assert.match(source, /admin\.taskDueToday/);
});
