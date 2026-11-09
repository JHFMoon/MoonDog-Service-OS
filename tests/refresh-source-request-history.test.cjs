"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(relative) {
  const code = fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
  const context = vm.createContext({Date, Intl});
  vm.runInContext(code, context);
  return context.ServiceRefreshIntelligence;
}

for (const relative of ["src/refresh-intelligence.js", "assets/freshness.js"]) {
  test(relative + " retains last requested report time across deferral and import", () => {
    const engine = load(relative);
    const requestedAt = "2026-11-06T15:00:00Z";
    const deferredAt = "2026-11-06T15:05:00Z";
    const importAt = "2026-11-06T17:00:00Z";
    let history = engine.learn(engine.empty(), "performance", "requested", {at:requestedAt});
    assert.equal(history.sources.performance.lastRequested, requestedAt);
    const requestedSnapshot = JSON.stringify(history);

    history = engine.learn(history, "performance", "not-now", {at:deferredAt});
    assert.equal(history.sources.performance.lastRequested, requestedAt,
      "deferring does not erase when the source was requested");
    assert.ok(history.sources.performance.notNowUntil);
    assert.equal(engine.sourceRecord(history, "performance").lastRequested, requestedAt);

    history = engine.learn(history, "performance", "imported",
      {at:importAt,periodEnd:"2026-11-05",hour:9});
    assert.equal(history.sources.performance.lastRequested, requestedAt,
      "an import is a new observation, not a reason to destroy the request record");
    assert.equal(history.sources.performance.observations.length, 1);
    assert.equal(history.sources.performance.notNowUntil, "");
    assert.equal(JSON.stringify(engine.learn(engine.empty(), "performance", "requested",
      {at:requestedAt})), requestedSnapshot, "historical returned objects are not mutated");

    const laterAt = "2026-11-07T15:00:00Z";
    history = engine.learn(history, "performance", "requested", {at:laterAt});
    assert.equal(history.sources.performance.lastRequested, laterAt,
      "a real later request replaces the previous request time");
    assert.equal(history.sources.performance.observations.length, 1);
  });

  test(relative + " does not promote invalid legacy request timestamps", () => {
    const engine = load(relative);
    const legacy = {schemaVersion:1,sources:{performance:{
      observations:[],deferrals:[],notNowUntil:"",lastRequested:"invalid-date"
    }}};
    const before = JSON.stringify(legacy);
    const next = engine.learn(legacy, "performance", "not-now",
      {at:"2026-11-08T16:00:00Z"});
    assert.equal(Object.hasOwn(next.sources.performance,"lastRequested"), false);
    assert.equal(JSON.stringify(legacy),before,"legacy source state remains unchanged");
    const noRequest = engine.learn(engine.empty(), "csi", "imported",
      {at:"2026-11-08T16:00:00Z",periodEnd:"2026-11-07"});
    assert.equal(Object.hasOwn(noRequest.sources.csi,"lastRequested"),false,
      "new fields are not invented for imports that had no request");
  });
}
