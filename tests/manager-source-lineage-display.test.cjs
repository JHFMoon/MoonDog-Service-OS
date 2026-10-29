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
    mediaAsr: { store: { mediaCreatedRate: 0, mediaViewedRate: 0 }, technicians: [] },
    openRoSummary: { store: { total: { open: 0, revenue: 0 } }, date: "2026-10-22" }
  };
  const grid = element();
  const context = vm.createContext({
    ui: { managerSourceGrid: grid },
    model: { state: { records: [] } },
    document: { createElement: element },
    latestFamily: key => snapshots[key] || null,
    sourceFreshness: key => evidence[key],
    performanceFormat: value => Number.isFinite(value) ? String(value) : "—"
  });
  vm.runInContext(app.slice(lineageStart, lineageEnd) + app.slice(rendererStart, rendererEnd) +
    "; this.renderManagerIntelligence = renderManagerIntelligence;", context);

  context.renderManagerIntelligence();
  assert.equal(grid.children.length, 5);
  const cardText = grid.children.map(text);
  assert.match(cardText[0], /Historical · valid for stated period · Report period: 2026-10-01 through 2026-10-31 · Last imported: 2026-11-01 02:03 UTC/);
  assert.match(cardText[1], /Current · Report period: 2026-10-22 · Last imported: 2026-10-23 01:00 UTC/);
  assert.match(cardText[1], /0 configured-store records/, "a verified zero remains distinguishable from missing coverage");
  assert.match(cardText[2], /Loaded but stale · Needs updating/);
  assert.match(cardText[3], /Conflict · Review required · Report period: Not verified/);
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
    reason: "Unsupported synthetic workbook structure" }), "Loaded · validation needed");
});
