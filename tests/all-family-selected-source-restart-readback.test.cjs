"use strict";

// #59-01: exercise the shipped source-confidence adapter after a synthetic
// JSON save/restart/selected-source readback. This is NOT a physical Workspace
// restore, real report parser, or proof that all view renderers are reconciled.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");

const source = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = source.indexOf("  function sourceFreshness(");
const end = source.indexOf("  function metricDependencyEvidence(", start);
assert.ok(start >= 0 && end > start, "production source-confidence adapter must exist");
const selector = source.slice(start, end);
const families = Object.keys(freshness.SOURCE_DEFINITIONS);
const today = "2026-10-30";
const original = Object.freeze({
  importedAt: "2026-10-30T08:00:00.000Z",
  reportDate: today, date: today,
  period: "2026-10", periodStart: "2026-10-01", periodEnd: "2026-10-29",
  scopeVerified: true, scopeStart: "2026-10-01", scopeEnd: "2026-10-29",
  reportObservationVerified: true, reportObservationDate: "2026-10-29",
  observationTimestamp: "2026-10-29T17:30:00.000Z",
  sourceModifiedAt: "2026-10-29T17:30:00.000Z",
  releaseWeek: "2026-10-26",
  generatedAt: "2026-10-29T17:30:00.000Z",
  rows: 0
});

function appAfterStart(saved) {
  // A new VM models new application-memory state after reload; never use the
  // older process's cached report object when selecting a retained record.
  const model = {
    state: {source: saved}, operationalMetrics: {csi: {imports: [saved]}},
    appointments: {days: {[today]: saved}},
    recovery: {supervisorWorkbook: saved}
  };
  const context = vm.createContext({
    freshness, model, Date, Intl,
    sourceExpectation: () => "recommended",
    businessTimeZone: () => "America/Los_Angeles",
    localDateKey: value => value instanceof Date ? value.toISOString().slice(0, 10) : today,
    currentSaprSnapshot: () => saved,
    latestOperationalSnapshot: () => saved,
    latestVirObservation: () => saved,
    verifiedVirSourceObservationDate: item =>
      freshness.validDateKey(item?.reportDate) ? item.reportDate : "",
    validCoverageDate: value => freshness.validDateKey(value) ? value : "",
    csiReportedPeriod: (scopeStart, scopeEnd, observed) => ({
      periodStart: scopeStart || observed || "",
      periodEnd: scopeEnd || observed || "",
      verified: Boolean(scopeEnd || observed)
    }),
    verifiedMenuTrendReleases: () => new Set(["2026-10-26"]),
    lastDayOfMonth: freshness.lastDayOfMonth
  });
  vm.runInContext(selector + "\nthis.selectedEvidence = sourceFreshness;", context);
  return (key, item, options = {}) => context.selectedEvidence(key, {item, today, ...options});
}

function corrupt(key, item) {
  const data = {...item};
  if (key === "openRo") data.reportDate = "2026-02-30";
  else if (key === "csi") data.scopeEnd = "2026-02-30";
  else if (key === "vir") data.reportDate = "2026-02-30";
  else if (key === "menu") data.releaseWeek = "2026-02-30";
  else if (key === "appointments") data.date = "2026-02-30";
  else if (key === "supervisorWorkbook") data.generatedAt = "2026-02-30T17:30:00.000Z";
  else data.periodEnd = "2026-02-30";
  return data;
}

test("every one of the fourteen source families preserves its selected confidence after synthetic durable serialization and app restart", () => {
  assert.equal(families.length, 14, "update this matrix if the source catalog expands");
  const serialized = JSON.stringify({source: original});
  const restored = JSON.parse(serialized).source;
  const before = appAfterStart(original), after = appAfterStart(restored);
  for (const key of families) {
    const initial = before(key, original), recovered = after(key, restored);
    assert.equal(initial.loaded, true, key + " original loaded");
    assert.equal(recovered.loaded, true, key + " recovered loaded");
    assert.equal(recovered.status, initial.status, key + " recovered source state");
    assert.equal(recovered.periodStart, initial.periodStart, key + " recovered period start");
    assert.equal(recovered.periodEnd, initial.periodEnd, key + " recovered period end");
    assert.equal(recovered.importTimestamp, original.importedAt, key + " source import provenance");
    assert.equal(recovered.reportPeriodVerified, initial.reportPeriodVerified,
      key + " recovered period verification");
    assert.equal(freshness.evaluateMetric([recovered]).verified,
      freshness.evaluateMetric([initial]).verified, key + " metric-source confidence survives reload");
  }
  assert.equal(JSON.stringify(original), serialized.slice('{"source":'.length, -1),
    "saved source must not be mutated by selectors");
});

test("after a synthetic restart, an absent selected source never borrows any retained family or produces verified zero", () => {
  const selected = appAfterStart(JSON.parse(JSON.stringify(original)));
  for (const key of families) {
    const prior = selected(key, JSON.parse(JSON.stringify(original)));
    assert.equal(prior.loaded, true, key + " positive retained fixture");
    const missing = selected(key, null);
    assert.equal(missing.status, "missing", key + " fail-closed missing source");
    assert.equal(missing.loaded, false, key);
    assert.equal(missing.reportPeriodVerified, false, key);
    assert.equal(missing.importTimestamp, "", key + " cannot borrow other import date");
    assert.equal(freshness.evaluateMetric([missing]).verified, false, key + " UNKNOWN cannot become zero");
  }
});

test("a corrupted recovered source is never silently replaced by a different valid retained source in any family", () => {
  const read = appAfterStart(JSON.parse(JSON.stringify(original)));
  for (const key of families) {
    const changed = corrupt(key, JSON.parse(JSON.stringify(original)));
    const before = JSON.stringify(changed);
    const persisted = JSON.parse(JSON.stringify(changed));
    const recovered = read(key, persisted);
    assert.equal(recovered.status, "invalid", key + " rejects malformed source authority");
    assert.equal(recovered.safeForCurrent, false, key);
    assert.equal(recovered.safeForPurpose, false, key);
    assert.equal(freshness.evaluateMetric([recovered]).verified, false, key);
    assert.equal(JSON.stringify(changed), before, key + " source nonmutation");
  }
});

test("restarted sources with older verified periods are stale for a later requested day across all fourteen families", () => {
  const read = appAfterStart(JSON.parse(JSON.stringify(original)));
  for (const key of families) {
    const old = JSON.parse(JSON.stringify(original));
    old.reportDate = "2026-10-29";
    old.date = "2026-10-29";
    old.periodEnd = "2026-10-29";
    old.scopeEnd = "2026-10-29";
    old.reportObservationDate = "2026-10-29";
    old.generatedAt = "2026-10-29T17:30:00.000Z";
    const bytes = JSON.stringify(old);
    const recovered = JSON.parse(bytes);
    const evidence = read(key, recovered, {
      purpose: "historical", targetStart: today, targetEnd: today
    });
    assert.equal(evidence.status, "stale", key + " cannot borrow current import time for missing historical coverage");
    assert.equal(evidence.safeForPurpose, false, key + " cannot certify uncovered day");
    assert.equal(freshness.evaluateMetric([evidence]).verified, false, key + " cannot relabel unknown metric as true zero");
    assert.equal(JSON.stringify(old), bytes, key + " original serialized bytes remain untouched");
  }
});
