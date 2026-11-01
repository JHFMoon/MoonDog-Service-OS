"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const lineageStart = app.indexOf("  function sourceStatusLabel(evidence)");
const lineageEnd = app.indexOf("  function advisorNextWin(", lineageStart);
const rendererStart = app.indexOf("  function renderManagerIntelligence() {");
const rendererEnd = app.indexOf("  let overviewPanelsDirty", rendererStart);
assert.ok(lineageStart >= 0 && lineageEnd > lineageStart, "Missing production source-lineage labels");
assert.ok(rendererStart >= 0 && rendererEnd > rendererStart, "Missing production manager-source renderer");

function element() {
  const node = { children: [], textContent: "", className: "",
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = [...children]; }
  };
  Object.defineProperty(node, "innerHTML", {
    set() { throw new Error("Source-derived text must use textContent, not HTML parsing."); }
  });
  return node;
}

function text(node) {
  return [node.textContent, ...(node.children || []).map(text)].filter(Boolean).join(" ");
}

test("manager source cards expose verified periods, import time, stale state, conflicts, and true zero", () => {
  const evidence = {
    sor: { status: "historical-valid", loaded: true, reportPeriodVerified: true,
      periodStart: "2026-10-01", periodEnd: "2026-10-31", importTimestamp: "2026-11-01T02:03:00.000Z" },
    appointmentActivity: { status: "current", loaded: true, reportPeriodVerified: true,
      periodStart: "2026-10-22", periodEnd: "2026-10-22", importTimestamp: "2026-10-23T01:00:00.000Z" },
    efficiency: { status: "stale", loaded: true, reportPeriodVerified: true,
      periodStart: "2026-10-01", periodEnd: "2026-10-15", importTimestamp: "2026-10-16T01:00:00.000Z" },
    mediaAsr: { status: "invalid", loaded: true, reportPeriodVerified: false,
      reason: "Conflicting validated source snapshots for the same reporting period" },
    openRoSummary: { status: "missing", loaded: false, reportPeriodVerified: false }
  };
  const snapshots = {
    sor: { period: "2026-10", metrics: { "CP Labor Gross": { currentActual: 1200 }, "CP ELR": { currentActual: 150 } } },
    appointmentActivity: { rowCount: 0, periodStart: "2026-10-22", periodEnd: "2026-10-22" },
    efficiency: { store: { efficiency: 0, flagHours: 0, clockHours: 0, efficiencyBic: 0 }, periodStart: "2026-10-01", periodEnd: "2026-10-15" },
    // Legacy technician snapshots can be the exact snapshot selected for this card
    // even when freshness's default advisor-only selector returns nothing.
    mediaAsr: { periodStart: "2026-08-01", periodEnd: "2026-08-31", importedAt: "2026-09-01T04:05:00.000Z",
      store: { mediaCreatedRate: 0, mediaViewedRate: 0 }, technicians: [] },
    openRoSummary: { store: { total: { open: 0, revenue: 0 } }, date: "2026-10-22" }
  };
  const grid = element();
  const freshnessItems = {};
  const context = vm.createContext({
    ui: { managerSourceGrid: grid },
    model: { state: { records: [] } },
    document: { createElement: element },
    latestFamily: key => snapshots[key] || null,
    sourceFreshness: (key, options = {}) => {
      freshnessItems[key] = options.item;
      const selected = options.item;
      if (selected && key === "mediaAsr") return { status: "historical-valid", loaded: true,
        reportPeriodVerified: true, periodStart: selected.periodStart, periodEnd: selected.periodEnd,
        importTimestamp: selected.importedAt };
      return evidence[key];
    },
    performanceFormat: value => Number.isFinite(value) ? String(value) : "—"
  });
  vm.runInContext(app.slice(lineageStart, lineageEnd) + app.slice(rendererStart, rendererEnd) +
    "; this.renderManagerIntelligence = renderManagerIntelligence;", context);

  context.renderManagerIntelligence();
  assert.equal(grid.children.length, 5);
  const cardText = grid.children.map(text);
  assert.strictEqual(freshnessItems.sor, snapshots.sor);
  assert.strictEqual(freshnessItems.appointmentActivity, snapshots.appointmentActivity);
  assert.strictEqual(freshnessItems.efficiency, snapshots.efficiency);
  assert.strictEqual(freshnessItems.mediaAsr, snapshots.mediaAsr,
    "lineage must use the same legacy technician snapshot selected for displayed metrics");
  assert.strictEqual(freshnessItems.openRoSummary, snapshots.openRoSummary);
  assert.match(cardText[0], /Historical · valid for stated period · Report period: 2026-10-01 through 2026-10-31 · Last imported: 2026-11-01 02:03 UTC/);
  assert.match(cardText[1], /Current · Report period: 2026-10-22 · Last imported: 2026-10-23 01:00 UTC/);
  assert.match(cardText[1], /0 configured-store records/, "a verified zero remains distinguishable from missing coverage");
  assert.match(cardText[2], /Loaded but stale · Needs updating/);
  assert.match(cardText[3], /Historical · valid for stated period · Report period: 2026-08-01 through 2026-08-31 · Last imported: 2026-09-01 04:05 UTC/);
  assert.match(cardText[4], /Missing · Report period: Not verified · Last imported: Not verified/);
});

test("source status distinguishes a period conflict from other validation failures", () => {
  const start = lineageStart;
  const end = app.indexOf("  // Source coverage and local import time", start);
  const context = vm.createContext({});
  vm.runInContext(app.slice(start, end) + "; this.sourceStatusLabel = sourceStatusLabel;", context);
  assert.equal(context.sourceStatusLabel({ status: "invalid", loaded: true,
    reason: "Conflicting validated source snapshots for the same reporting period" }), "Conflict · Review required");
  assert.equal(context.sourceStatusLabel({ status: "invalid", loaded: true,
    reason: "Unsupported synthetic workbook structure" }), "Unsupported format · Review required");
  assert.equal(context.sourceStatusLabel({ status: "invalid", loaded: true,
    reason: "The saved report period is invalid or internally inconsistent." }), "Invalid period · Review required");
});

test("production freshness selectors and Home renderer preserve lineage for every reference source family", () => {
  const freshness = fs.readFileSync(path.join(__dirname, "..", "assets", "freshness.js"), "utf8");
  const expectationStart = app.indexOf("  function sourceExpectation(key)");
  const expectationEnd = app.indexOf("  function sourceAvailable(key)", expectationStart);
  const freshnessStart = app.indexOf("  function sourceFreshness(key, options = {})");
  const freshnessEnd = app.indexOf("  function metricDependencyEvidence(", freshnessStart);
  const productionLastDay = app.indexOf("  function lastDayOfMonth(");
  const productionLastDayEnd = app.indexOf("\n  function ", productionLastDay + 3);
  const lineageEnd = app.indexOf("  function advisorNextWin(", lineageStart);
  const managerStart = app.indexOf("  function latestFamily(family)");
  assert.ok(expectationStart >= 0 && expectationEnd > expectationStart, "production source expectation selector exists");
  assert.ok(freshnessStart >= 0 && freshnessEnd > freshnessStart, "production source freshness selector exists");
  assert.ok(productionLastDay >= 0 && productionLastDayEnd > productionLastDay, "production month boundary helper exists");
  assert.ok(lineageEnd > lineageStart && managerStart >= 0 && rendererEnd > managerStart,
    "production source lineage labels and Home renderer exist");

  const snapshots = {
    sor: { period: "2026-10", importedAt: "2026-11-01T02:03:00.000Z",
      metrics: { "CP Labor Gross": { currentActual: 1200 }, "CP ELR": { currentActual: 150 } } },
    appointmentActivity: { rowCount: 0, periodStart: "2026-10-22", periodEnd: "2026-10-22",
      importedAt: "2026-10-23T01:00:00.000Z" },
    efficiency: { periodStart: "2026-10-01", periodEnd: "2026-10-15", importedAt: "2026-10-16T01:00:00.000Z",
      store: { efficiency: 0, flagHours: 0, clockHours: 0, efficiencyBic: 0 } },
    mediaAsr: { periodStart: "2026-08-01", periodEnd: "2026-08-31", importedAt: "2026-09-01T04:05:00.000Z",
      store: { mediaCreatedRate: 0, mediaViewedRate: 0 }, technicians: [] },
    openRoSummary: { date: "2026-10-22", importedAt: "2026-10-23T02:00:00.000Z",
      store: { total: { open: 0, revenue: 0 } } }
  };
  const grid = element();
  const model = {
    settings: { setup: { sourceExpectations: {} }, store: { timeZone: "UTC" } },
    state: { records: [] },
    operationalMetrics: Object.fromEntries(Object.entries(snapshots)
      .map(([key, item]) => [key, { snapshots: { synthetic: item } }]))
  };
  const context = vm.createContext({
    ui: { managerSourceGrid: grid },
    model,
    document: { createElement: element },
    localDateKey: () => "2026-10-30",
    businessTimeZone: () => "UTC",
    performanceFormat: value => Number.isFinite(value) ? String(value) : "—"
  });
  vm.runInContext(freshness, context);
  context.freshness = context.MoonDogFreshness;
  vm.runInContext(app.slice(expectationStart, expectationEnd) +
    app.slice(freshnessStart, freshnessEnd) +
    app.slice(productionLastDay, productionLastDayEnd) +
    app.slice(lineageStart, lineageEnd) +
    app.slice(managerStart, rendererEnd) +
    "; this.sourceFreshness = sourceFreshness; this.renderManagerIntelligence = renderManagerIntelligence;",
    context);

  for (const [family, item] of Object.entries(snapshots)) {
    const evidence = context.sourceFreshness(family, { item });
    assert.equal(evidence.status, "historical-valid", family + " must remain valid for its stated period");
    assert.equal(evidence.reportPeriodVerified, true, family + " must use its saved report period");
    assert.equal(evidence.importTimestamp, item.importedAt, family + " must expose its durable import timestamp");
  }
  context.renderManagerIntelligence();
  assert.equal(grid.children.length, 5);
  const cards = grid.children.map(text);
  assert.match(cards[0], /Historical · valid for stated period · Report period: 2026-10-31 · Last imported: 2026-11-01 02:03 UTC/);
  assert.match(cards[1], /Historical · valid for stated period · Report period: 2026-10-22 · Last imported: 2026-10-23 01:00 UTC/);
  assert.match(cards[2], /Historical · valid for stated period · Report period: 2026-10-01 through 2026-10-15 · Last imported: 2026-10-16 01:00 UTC/);
  assert.match(cards[3], /Historical · valid for stated period · Report period: 2026-08-01 through 2026-08-31 · Last imported: 2026-09-01 04:05 UTC/);
  assert.match(cards[4], /Historical · valid for stated period · Report period: 2026-10-22 · Last imported: 2026-10-23 02:00 UTC/);
  assert.match(cards[1], /0 configured-store records/, "a valid zero is not mistaken for missing lineage");
});


test("production freshness selectors distinguish missing and stale coverage for reference sources", () => {
  const freshnessSource = fs.readFileSync(path.join(__dirname, "..", "assets", "freshness.js"), "utf8");
  const expectationStart = app.indexOf("  function sourceExpectation(key)");
  const expectationEnd = app.indexOf("  function sourceAvailable(key)", expectationStart);
  const freshnessStart = app.indexOf("  function sourceFreshness(key, options = {})");
  const freshnessEnd = app.indexOf("  function metricDependencyEvidence(", freshnessStart);
  const lastDayStart = app.indexOf("  function lastDayOfMonth(month)");
  const lastDayEnd = app.indexOf("\n  function ", lastDayStart + 3);
  assert.ok(expectationStart >= 0 && expectationEnd > expectationStart, "production expectations selector exists");
  assert.ok(freshnessStart >= 0 && freshnessEnd > freshnessStart, "production freshness selector exists");
  assert.ok(lastDayStart >= 0 && lastDayEnd > lastDayStart, "production date helper exists");

  const context = vm.createContext({
    model: { settings: { setup: { sourceExpectations: {} } }, operationalMetrics: {}, state: { records: [] } },
    localDateKey: () => "2026-10-30",
    businessTimeZone: () => "UTC",
    latestOperationalSnapshot: () => null
  });
  vm.runInContext(freshnessSource, context);
  context.freshness = context.MoonDogFreshness;
  vm.runInContext(app.slice(expectationStart, expectationEnd) +
    app.slice(freshnessStart, freshnessEnd) +
    app.slice(lastDayStart, lastDayEnd) +
    "; this.sourceFreshness = sourceFreshness;", context);

  const referenceSources = ["sor", "appointmentActivity", "efficiency", "mediaAsr", "openRoSummary"];
  const target = { purpose: "historical", targetStart: "2026-10-01", targetEnd: "2026-10-31" };
  for (const key of referenceSources) {
    const missing = context.sourceFreshness(key, { ...target, item: null });
    assert.equal(missing.status, "missing", key + " must not present absent source coverage as zero");
    assert.equal(missing.safeForPurpose, false, key + " missing coverage cannot satisfy a historical request");
    assert.equal(missing.reportPeriodVerified, false);

    const staleItem = {
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      importedAt: "2026-10-01T12:00:00.000Z"
    };
    const stale = context.sourceFreshness(key, { ...target, item: staleItem });
    assert.equal(stale.status, "stale", key + " must reject a source that does not cover the requested period");
    assert.equal(stale.safeForPurpose, false, key + " stale coverage cannot satisfy a historical request");
    assert.equal(stale.reportPeriodVerified, true, key + " retains the fact that the saved period itself is verified");
    assert.equal(stale.periodStart, staleItem.periodStart);
    assert.equal(stale.periodEnd, staleItem.periodEnd);
    assert.equal(stale.importTimestamp, staleItem.importedAt);
    assert.match(stale.requiredAction, /requested historical period/);
  }
});

test("production lineage rejects malformed and reversed saved report periods before use", () => {
  const freshnessSource = fs.readFileSync(path.join(__dirname, "..", "assets", "freshness.js"), "utf8");
  const expectationStart = app.indexOf("  function sourceExpectation(key)");
  const expectationEnd = app.indexOf("  function sourceAvailable(key)", expectationStart);
  const freshnessStart = app.indexOf("  function sourceFreshness(key, options = {})");
  const freshnessEnd = app.indexOf("  function metricDependencyEvidence(", freshnessStart);
  const lastDayStart = app.indexOf("  function lastDayOfMonth(month)");
  const lastDayEnd = app.indexOf("\n  function ", lastDayStart + 3);
  assert.ok(expectationStart >= 0 && expectationEnd > expectationStart);
  assert.ok(freshnessStart >= 0 && freshnessEnd > freshnessStart);
  assert.ok(lastDayStart >= 0 && lastDayEnd > lastDayStart);
  const context = vm.createContext({
    model: { settings: { setup: { sourceExpectations: {} } }, operationalMetrics: {}, state: { records: [] } },
    localDateKey: () => "2026-10-30",
    businessTimeZone: () => "UTC",
    latestOperationalSnapshot: () => null
  });
  vm.runInContext(freshnessSource, context);
  context.freshness = context.MoonDogFreshness;
  vm.runInContext(app.slice(expectationStart, expectationEnd) +
    app.slice(freshnessStart, freshnessEnd) +
    app.slice(lastDayStart, lastDayEnd) +
    "; this.sourceFreshness = sourceFreshness;", context);

  const malformedMonth = context.sourceFreshness("sor", { item: {
    period: "2026-13", importedAt: "2026-10-30T12:00:00.000Z"
  } });
  assert.equal(malformedMonth.status, "invalid");
  assert.equal(malformedMonth.safeForCurrent, false);
  assert.equal(malformedMonth.reportPeriodVerified, false);
  assert.equal(malformedMonth.requiredAction, "Review the report period before using these values.");

  const reversed = context.sourceFreshness("efficiency", { item: {
    periodStart: "2026-10-31", periodEnd: "2026-10-01",
    importedAt: "2026-10-30T12:00:00.000Z"
  } });
  assert.equal(reversed.status, "invalid");
  assert.equal(reversed.safeForPurpose, false);
  assert.equal(reversed.reportPeriodVerified, false);
});
