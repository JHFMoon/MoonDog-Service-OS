"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise the real production schedule selectors and Daily Walk renderer.
// Synthetic in-memory DOM only: no local folder, browser authority or operational data.
const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  const MANAGER_WORK_DAYS = Object.freeze([2,3,4,5,6]);");
const end = app.indexOf("  function focusCandidates(", start);
const renderStart = app.indexOf("  function renderDailyFocus() {", end);
const renderEnd = app.indexOf("  function renderFilters()", renderStart);
assert.ok(start >= 0 && end > start && renderStart > end && renderEnd > renderStart,
  "actual production schedule and Daily Walk renderer exist");
const production = app.slice(start, end) + app.slice(renderStart, renderEnd);

function element() {
  return {
    className: "", textContent: "", innerHTML: "", children: [], dataset: {},
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren() { this.children = []; }
  };
}

function render(day, configuredDays, connected = true) {
  const ui = {
    dailyFocusDate: element(),
    dailyFocusSummary: element(),
    dailyFocusGrid: element()
  };
  const defaults = {days: [2,3,4,5,6], startTime: "07:30", endTime: "16:00"};
  const model = {
    root: connected ? {} : null,
    state: {records: [], dailyFocus: {}},
    settings: configuredDays === null ? {} : {
      future: {managerSchedule: {days: configuredDays, startTime: "08:00", endTime: "17:00"}}
    }
  };
  const context = {
    ui, model, DEFAULTS: {future: {managerSchedule: defaults}},
    localDateKey: () => day,
    freshness: {dayOfWeek: date => new Date(date + "T12:00:00Z").getUTCDay()},
    DAILY_WALK_ADVISORS: {"101": "Synthetic Advisor"},
    dailyWalkCount: () => 3,
    document: {createElement: () => element()}
  };
  vm.runInNewContext(production + "\nthis.testRender=renderDailyFocus;", context);
  context.testRender();
  return ui;
}

test("default Tue-Sat calendar shows off-day on Monday without implying Monday restart", () => {
  const monday = render("2026-10-19", null);
  assert.equal(monday.dailyFocusGrid.children.length, 1);
  assert.equal(monday.dailyFocusGrid.children[0].className, "focus-off");
  assert.match(monday.dailyFocusGrid.children[0].innerHTML, /no manager review/i);
  assert.match(monday.dailyFocusSummary.textContent, /next scheduled workday/i);
  assert.doesNotMatch(monday.dailyFocusSummary.textContent, /resume Monday/i);
  const tuesday = render("2026-10-20", null);
  assert.equal(tuesday.dailyFocusGrid.children[0].className, "focus-advisor");
});

test("selected Sunday is treated as an ordinary scheduled review day", () => {
  const sunday = render("2026-10-18", [0,2,3,4,5]);
  assert.equal(sunday.dailyFocusGrid.children.length, 1);
  assert.equal(sunday.dailyFocusGrid.children[0].className, "focus-advisor");
  assert.match(sunday.dailyFocusSummary.textContent, /Import Open ROs or reconnect/);
});

test("custom excluded Saturday and default Sunday remain scheduled off-days", () => {
  const saturday = render("2026-10-17", [0,1,2,3,4]);
  assert.equal(saturday.dailyFocusGrid.children[0].className, "focus-off");
  const sunday = render("2026-10-18", null);
  assert.equal(sunday.dailyFocusGrid.children[0].className, "focus-off");
});

test("disconnected folder messaging takes precedence over workday presentation", () => {
  const ui = render("2026-10-19", null, false);
  assert.match(ui.dailyFocusSummary.textContent, /Connect the working folder/);
  assert.equal(ui.dailyFocusGrid.children.length, 0);
});
