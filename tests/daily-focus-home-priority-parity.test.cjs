"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "assets", "app.js"), "utf8");
const engineSource = fs.readFileSync(path.join(root, "assets", "daily-engine.js"), "utf8");
const start = app.indexOf("  function dailyFocusPriority(");
const end = app.indexOf("\n  const MANAGER_WORK_DAYS", start);
assert.ok(start >= 0 && end > start, "the shipped Daily Walk priority selector exists");
const dailyFocusSource = app.slice(start, end);

test("Daily Walk and Home rank the same synthetic Open ROs in the same urgency order", () => {
  const today = "2026-10-24";
  const freshness = {
    DEFAULT_TIME_ZONE: "UTC",
    validDateKey(value) {
      return typeof value === "string" && /^\\d{4}-\\d{2}-\\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value + "T12:00:00Z"));
    }
  };
  const context = vm.createContext({
    Date, Intl, freshness, MoonDogFreshness: freshness,
    localDateKey: () => today,
    clarificationFor: record => record.management?.clarification || null
  });
  vm.runInContext(dailyFocusSource + "\nthis.priorityForTest = dailyFocusPriority;", context);
  vm.runInContext(engineSource, context);

  const records = [
    { id: "synthetic-future", ro: "SYN-FUTURE", daysOpen: 0, management: { status: "Open", nextAction: "Review", reviewDate: "2026-10-25" } },
    { id: "synthetic-no-plan", ro: "SYN-NO-PLAN", daysOpen: 0, management: { status: "Open", nextAction: "", reviewDate: "" } },
    { id: "synthetic-today", ro: "SYN-TODAY", daysOpen: 0, management: { status: "Open", nextAction: "Review", reviewDate: today } },
    { id: "synthetic-overdue", ro: "SYN-OVERDUE", daysOpen: 0, management: { status: "Open", nextAction: "Review", reviewDate: "2026-10-23" } },
    { id: "synthetic-question", ro: "SYN-QUESTION", daysOpen: 0, management: { status: "Open", nextAction: "Review", reviewDate: "2026-10-25", clarification: { reason: "Synthetic source question" } } }
  ];
  const priority = (record, day) => context.priorityForTest(record, day);
  const api = {
    closed: management => management?.status === "Closed",
    priority,
    status: record => record.management?.status || ""
  };
  const engine = context.MoonDogDailyEngine;
  const homeOrder = [...records]
    .sort((a, b) => priority(a, today) - priority(b, today) ||
      Number(b.daysOpen || 0) - Number(a.daysOpen || 0) ||
      String(a.management?.reviewDate || "9999-12-31").localeCompare(String(b.management?.reviewDate || "9999-12-31")) ||
      String(a.ro).localeCompare(String(b.ro), undefined, { numeric: true }))
    .map(record => record.id);
  const homeTasks = records.map(record => engine.roTask(record, api, today, Date.parse(today + "T12:00:00Z")));
  assert.ok(homeTasks.every(Boolean), "all open synthetic rows produce Home tasks");
  const managerOrder = homeTasks.sort((a, b) => a.rank - b.rank).map(task => task.record.id);

  assert.deepEqual(homeOrder, [
    "synthetic-question",
    "synthetic-overdue",
    "synthetic-today",
    "synthetic-no-plan",
    "synthetic-future"
  ]);
  assert.deepEqual(managerOrder, homeOrder,
    "the Home task selector must preserve the source-authoritative Daily Walk urgency order");
  assert.deepEqual(
    records.map(record => priority(record, today)),
    [4, 3, 2, 1, 0],
    "the Daily Walk priority function derives order from verified urgency and source-question state"
  );
  assert.deepEqual(
    homeTasks.slice().sort((a, b) => a.rank - b.rank).map(task => task.rank),
    [0, 1, 2, 4, 5],
    "Home may map priorities to rank gaps but must preserve the same order"
  );
});
