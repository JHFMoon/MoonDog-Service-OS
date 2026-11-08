"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Execute real canonical and shipped source, not a mock or replacement parser.
function load(relative) {
  const source = readFileSync(path.join(__dirname, "..", relative), "utf8");
  const context = vm.createContext({Date, Intl});
  vm.runInContext(source, context);
  return context.ServiceRefreshIntelligence;
}

for (const relative of ["src/refresh-intelligence.js", "assets/freshness.js"]) {
  test(relative + " rejects malformed supplied report periods without fabricating source learning", () => {
    const engine = load(relative);
    const before = engine.learn(engine.empty(), "performance", "not-now", {at:"2026-11-06T15:00:00Z"});
    const original = JSON.stringify(before);
    const invalid = [
      "2026-11-05 trailing notes", "2026-11-05T12:00:00Z extra",
      "2026-11-05T25:00:00Z", "2026-11-05T12:75:00Z",
      "2026-02-30T12:00:00Z", "2026-11-05garbage"
    ];
    for (const periodEnd of invalid) {
      const after = engine.learn(before, "performance", "imported", {
        at:"2026-11-06T16:00:00Z", periodEnd, hour:9
      });
      assert.strictEqual(after, before, "invalid source period must not clear a snooze: " + periodEnd);
      assert.equal(after.sources.performance.observations.length, 0);
      assert.equal(JSON.stringify(before), original, "source records are never mutated");
    }

    // Explicit valid dates, valid ISO observation timestamps and date-less imports
    // preserve their prior successful behavior after the validation fix.
    for (const periodEnd of ["2026-11-05", "2026-11-05T12:30:00Z", "2026-11-05T12:30:00-08:00"]) {
      const after = engine.learn(before, "performance", "imported", {
        at:"2026-11-06T16:00:00Z", periodEnd, hour:9
      });
      assert.equal(after.sources.performance.observations.length, 1);
      assert.equal(after.sources.performance.observations[0].day, "2026-11-05");
      assert.equal(after.sources.performance.notNowUntil, "");
    }
    const after = engine.learn(before, "performance", "imported", {at:"2026-11-06T16:00:00Z"});
    assert.equal(after.sources.performance.observations[0].day, "2026-11-06");
  });
}
