"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(relative) {
  const code = fs.readFileSync(path.resolve(__dirname, "..", relative), "utf8");
  const context = vm.createContext({Date, Intl});
  vm.runInContext(code, context);
  return context.ServiceRefreshIntelligence;
}

for (const relative of ["src/refresh-intelligence.js", "assets/freshness.js"]) {
  const R = load(relative);
  test(relative + ": late import preserves a newer user snooze without mutating the original", () => {
    const deferAt = "2026-11-08T14:00:00Z";
    const prior = R.learn(R.empty(), "performance", "not-now", {at:deferAt});
    const until = prior.sources.performance.notNowUntil;
    const original = JSON.stringify(prior);
    const after = R.learn(prior, "performance", "imported",
      {at:"2026-11-08T10:00:00Z", periodEnd:"2026-11-07", hour:8});
    assert.equal(JSON.stringify(prior), original, "prior state remains unmodified");
    assert.equal(after.sources.performance.notNowUntil, until);
    assert.equal(after.sources.performance.observations.length, 1,
      "a valid late arrival is still recorded with its verified report period");
    assert.equal(R.plan([{source:"performance",rank:1}], after,
      {at:"2026-11-08T14:10:00Z", today:"2026-11-08"}).length, 0);
    const newer = R.learn(after, "performance", "imported",
      {at:"2026-11-08T15:00:00Z", periodEnd:"2026-11-07", hour:15});
    assert.equal(newer.sources.performance.notNowUntil, "",
      "a genuinely newer verified arrival may clear the snooze");
  });
  test(relative + ": stale duplicate cannot replace a newer same-day source observation", () => {
    let history = R.learn(R.empty(), "performance", "imported",
      {at:"2026-11-08T15:00:00Z", periodEnd:"2026-11-07", hour:15});
    history = R.learn(history, "performance", "imported",
      {at:"2026-11-08T10:00:00Z", periodEnd:"2026-11-07", hour:8});
    assert.equal(history.sources.performance.observations.length, 1);
    assert.equal(history.sources.performance.observations[0].hour, 15);
    assert.equal(history.sources.performance.observations[0].at,
      "2026-11-08T15:00:00Z");
  });
  test(relative + ": out-of-order distinct report periods stay ordered by import event time", () => {
    let history = R.learn(R.empty(), "performance", "imported",
      {at:"2026-11-08T15:00:00Z", periodEnd:"2026-11-08", hour:15});
    history = R.learn(history, "performance", "imported",
      {at:"2026-11-08T09:00:00Z", periodEnd:"2026-11-07", hour:9});
    assert.deepEqual(Array.from(history.sources.performance.observations, x=>x.day),
      ["2026-11-07","2026-11-08"]);
  });
  test(relative + ": chronological imports still update the latest observation and clear snooze", () => {
    let history = R.learn(R.empty(), "performance", "not-now",
      {at:"2026-11-08T10:00:00Z"});
    history = R.learn(history, "performance", "imported",
      {at:"2026-11-08T11:00:00Z", periodEnd:"2026-11-07", hour:11});
    assert.equal(history.sources.performance.notNowUntil, "");
    history = R.learn(history, "performance", "imported",
      {at:"2026-11-08T12:00:00Z", periodEnd:"2026-11-07", hour:12});
    assert.equal(history.sources.performance.observations.length, 1);
    assert.equal(history.sources.performance.observations[0].hour, 12);
  });
}
