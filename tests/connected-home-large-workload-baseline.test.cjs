"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  function renderAll() {");
const end = app.indexOf("  const renderAllWithCanonicalSourceLabels=renderAll;", start);
assert.ok(start >= 0 && end > start, "production Home render boundary exists");
const renderHome = app.slice(start, end);

function makeWorkspace(count) {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: "synthetic-record-" + String(index + 1).padStart(4, "0"),
    management: {
      status: index % 11 === 0 ? "closed" : "open",
      reviewDate: index % 3 === 0 ? "2026-10-25" : "2026-10-26",
      nextAction: index % 4 === 0 ? "" : "Synthetic follow-up"
    }
  }));
  return {
    root: { name: "Synthetic Workspace" },
    state: {
      records: rows,
      updatedAt: "2026-10-25T12:00:00.000Z",
      source: null
    },
    recovery: { supervisorWorkbook: null }
  };
}

function makeHarness(count) {
  const field = () => ({ textContent: "", disabled: false });
  const model = makeWorkspace(count);
  const calls = { overview: 0, daily: 0, filters: 0, setup: 0 };
  const ui = {
    metricOpen: field(),
    metricDue: field(),
    metricMissing: field(),
    metricUpdated: field(),
    lastImport: field(),
    lastExport: field(),
    exportButton: field()
  };
  const context = vm.createContext({
    model,
    ui,
    localDateKey: () => "2026-10-25",
    isClosedManagement: management => management?.status === "closed",
    renderOverviewIntelligence: () => { calls.overview += 1; },
    renderDailyFocus: () => { calls.daily += 1; },
    renderFilters: () => { calls.filters += 1; },
    renderTable: () => {},
    renderArrivals: () => {},
    renderPerformance: () => {},
    renderMeeting: () => {},
    renderAssignNext: () => {},
    renderSetup: () => { calls.setup += 1; }
  });
  vm.runInContext(renderHome + "\nthis.renderHome = renderAll;", context);
  return { model, ui, calls, render: context.renderHome };
}

function percentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
}

test("connected Home summary counts remain correct for 2,100 synthetic records without mutating source rows", () => {
  const { model, ui, calls, render } = makeHarness(2100);
  const original = JSON.stringify(model.state.records);

  for (let i = 0; i < 3; i += 1) render();

  const active = model.state.records.filter(row => row.management.status !== "closed");
  const due = active.filter(row => row.management.reviewDate === "2026-10-25");
  const missing = active.filter(row => !row.management.nextAction);

  assert.equal(Number(ui.metricOpen.textContent), active.length);
  assert.equal(Number(ui.metricDue.textContent), due.length);
  assert.equal(Number(ui.metricMissing.textContent), missing.length);
  assert.equal(ui.exportButton.disabled, false);
  assert.equal(calls.overview, 3);
  assert.equal(calls.daily, 3);
  assert.equal(calls.filters, 3);
  assert.equal(calls.setup, 3);
  assert.equal(JSON.stringify(model.state.records), original,
    "Home summary rendering must not alter authoritative synthetic source rows");

  const samples = [];
  for (let i = 0; i < 15; i += 1) {
    const began = performance.now();
    render();
    samples.push(performance.now() - began);
  }
  const result = {
    scope: "production renderAll summary/filter dispatch; 2,100 synthetic records; view renderers stubbed; excludes DOM layout, connection reads, and device latency",
    count: samples.length,
    p50Ms: Number(percentile(samples, 0.50).toFixed(3)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...samples).toFixed(3))
  };
  console.log("Synthetic connected Home large-workload baseline", JSON.stringify(result));
  assert.ok(Number.isFinite(result.p50Ms) && result.p50Ms >= 0);
  assert.ok(Number.isFinite(result.p95Ms) && result.p95Ms >= result.p50Ms);
});

test("connected Home remains accurate and nonmutating for an empty synthetic Workspace", () => {
  const { model, ui, render } = makeHarness(0);
  const original = JSON.stringify(model.state.records);
  render();
  assert.equal(ui.metricOpen.textContent, 0);
  assert.equal(ui.metricDue.textContent, 0);
  assert.equal(ui.metricMissing.textContent, 0);
  assert.equal(ui.exportButton.disabled, true);
  assert.equal(JSON.stringify(model.state.records), original);
});
