"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  function csiTrendSummaryStatus(");
const end = app.indexOf("  function compactMonthlyMetrics(", start);
assert.ok(start >= 0 && end > start, "Actual production CSI Home trend selector/render must exist");
const production = app.slice(start, end);
assert.ok(production.includes("items.push(csiTrendSummaryStatus(audit.csi))"),
  "Actual Home trend summary must consume verified status helper");

const today = "2026-11-02";
function evaluate(scope) {
  return freshness.evaluateSource({
    key: "csi", exists: true, today, scopeVerified: true,
    scopeStart: "2026-10-31", scopeEnd: "2026-11-02", ...scope
  });
}
function node(tag) {
  return {tag, textContent: "", className: "", children: [],
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = [...children]; }
  };
}
function display(csi, evidence, expectation = "available") {
  const host = node("section");
  const calls = [];
  const ctx = vm.createContext({
    ui: {trendCoverageSummary: host},
    document: {createElement: node},
    localDateKey: () => today,
    sourceFreshness: (key, options) => {
      calls.push({key, today: options.today});
      return evidence;
    },
    sourceExpectation: key => {
      assert.equal(key, "menu");
      return expectation;
    },
    shortDate: date => date
  });
  vm.runInContext(production + "\nthis.render=renderTrendCoverageSummary;", ctx);
  const audit = {
    window: {expectedDates: [today]}, sapr: {presentDates: []},
    vir: {state: "not-used"}, csi
  };
  const before = JSON.stringify(audit);
  ctx.render(audit);
  assert.equal(JSON.stringify(audit), before, "Home rendering must not change source state");
  const grid = host.children.find(item => item.className === "trend-coverage-grid");
  assert.ok(grid, "Actual production Home trend grid must render");
  const status = grid.children.map(item => item.textContent).find(item => item.startsWith("CSI: "));
  assert.ok(status, "CSI status must appear in the actual Home trend grid");
  return {status, calls};
}

test("current durable refresh with verified recent CSI reporting period remains Complete", () => {
  const valid = evaluate({});
  assert.equal(valid.safeForCurrent, true, "Actual freshness evaluator recognizes validated recent scope");
  assert.equal(display({state: "available", refreshDate: today},
    {...valid, reportPeriodVerified: true}).status, "CSI: Complete · cumulative");
  assert.equal(display({state: "available", refreshDate: today},
    {...valid, reportPeriodVerified: true}).calls.length, 1);
});

test("same-day refresh with invalid or reversed CSI scope cannot display Complete", () => {
  for(const scope of [
    {scopeEnd: "2026-02-30"},
    {scopeStart: "2026-11-02", scopeEnd: "2026-10-31"},
    {scopeEnd: ""}
  ]) {
    const confidence = evaluate(scope);
    assert.equal(confidence.safeForCurrent, false,
      "Actual freshness evaluator must reject invalid declared CSI scope");
    assert.equal(display({state: "available", refreshDate: today},
      {...confidence, reportPeriodVerified: false}).status,
    "CSI: Report verification needed · cumulative");
  }
});

test("current-looking refresh cannot borrow confidence from a missing reporting period", () => {
  for(const confidence of [
    {safeForCurrent: true, reportPeriodVerified: false},
    {safeForCurrent: false, reportPeriodVerified: true},
    {safeForCurrent: false, reportPeriodVerified: false},
    {safeForCurrent: undefined, reportPeriodVerified: undefined}
  ]) {
    assert.equal(display({state: "available", refreshDate: today}, confidence).status,
      "CSI: Report verification needed · cumulative",
      "Complete must require both source currentness and verified report period");
  }
});

test("old or missing durable refresh stays Refresh needed despite otherwise valid CSI", () => {
  const verified = {...evaluate({}), reportPeriodVerified: true};
  for(const refreshDate of ["2026-11-01", "", undefined]) {
    const result = display({state: "available", refreshDate}, verified);
    assert.equal(result.status, "CSI: Refresh needed · cumulative");
    assert.equal(result.calls.length, 0, "Avoid extra source evaluation for an old refresh");
  }
});

test("not used and temporarily unavailable overrides remain authoritative", () => {
  for(const [state, status] of [
    ["not-used", "CSI: Not used"],
    ["temporarily-unavailable", "CSI: Temporarily unavailable"]
  ]) {
    const result = display({state, refreshDate: today},
      {safeForCurrent: true, reportPeriodVerified: true});
    assert.equal(result.status, status);
    assert.equal(result.calls.length, 0, "Explicit source setting bypasses CSI source evaluation");
  }
});

test("source freshness uses the same business date as displayed durable import", () => {
  const valid = {...evaluate({}), reportPeriodVerified: true};
  const result = display({state: "available", refreshDate: today}, valid);
  assert.deepEqual(result.calls, [{key: "csi", today}]);
});
