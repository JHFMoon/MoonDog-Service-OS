"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function extract(from, to) {
  const start = app.indexOf(from);
  const end = app.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, "Expected production functions: " + from);
  return app.slice(start, end);
}
const selector = extract("  function sourceFreshness(", "  function metricDependencyEvidence(");
const lineage = extract("  function sourceStatusLabel(", "  function advisorNextWin(");
const manager = extract("  function renderManagerIntelligence()", "  let overviewPanelsDirty");
const today = "2026-10-30";
const families = ["sor", "appointmentActivity", "efficiency", "mediaAsr", "mediaAsrTech", "openRoSummary"];
const retained = Object.freeze({
  period: "2026-10", periodStart: "2026-10-01", periodEnd: "2026-10-20",
  importedAt: "2026-10-30T18:00:00.000Z",
  metrics: {}, store: { efficiency: 90, flagHours: 9, clockHours: 10 },
  technicians: []
});

function harness(latestFamily = () => null) {
  const grid = {
    items: [],
    replaceChildren() { this.items = []; },
    append(card) { this.items.push(card); }
  };
  const ctx = vm.createContext({
    freshness, Date, Intl,
    model: { state: { records: [] } },
    ui: { managerSourceGrid: grid },
    document: {
      createElement(tagName) {
        return {
          tagName, children: [], textContent: "", className: "",
          append(...children) { this.children.push(...children); }
        };
      }
    },
    sourceExpectation: () => "recommended",
    latestOperationalSnapshot: () => retained,
    latestFamily,
    performanceFormat: () => "synthetic-value",
    businessTimeZone: () => "America/Los_Angeles",
    localDateKey: () => today,
    lastDayOfMonth: freshness.lastDayOfMonth
  });
  vm.runInContext(selector + "\n" + lineage + "\n" + manager +
    "\nthis.api = { sourceFreshness, renderManagerIntelligence };", ctx);
  return { api: ctx.api, grid };
}

test("each reference family keeps an explicitly absent selected source missing, even if a different retained snapshot exists", () => {
  const { api } = harness();
  for (const key of families) {
    const absent = api.sourceFreshness(key, { item: null, today });
    assert.equal(absent.status, "missing", key);
    assert.equal(absent.loaded, false, key);
    assert.equal(absent.reportPeriodVerified, false, key);
    assert.equal(freshness.evaluateMetric([absent]).verified, false, key);
    assert.equal(api.sourceFreshness(key, { item: undefined, today }).status, "missing", key);

    // Omitted selection intentionally keeps the shared latest-source lookup.
    const automatic = api.sourceFreshness(key, { today });
    assert.equal(automatic.status, "historical-valid", key);
    assert.equal(automatic.reportPeriodVerified, true, key);
    const explicit = api.sourceFreshness(key, { item: retained, today });
    assert.equal(explicit.status, "historical-valid", key);
    assert.equal(explicit.reportPeriodVerified, true, key);
  }
});

test("Manager Intelligence cards display their own selected source lineage, not an unrelated global fallback", () => {
  const { api, grid } = harness(key => key === "sor" ? retained : null);
  api.renderManagerIntelligence();
  assert.equal(grid.items.length, 5, "five production Manager Intelligence cards");
  const descriptions = grid.items.map(card => {
    const node = card.children.find(part => part.className === "source-lineage");
    assert.ok(node, "each card includes a lineage field");
    return node.textContent;
  });
  assert.match(descriptions[0], /Report period: 2026-10-01 through 2026-10-20/,
    "the selected SOR source retains its verified period");
  for (const label of descriptions.slice(1)) {
    assert.equal(label, "Missing · Report period: Not verified · Last imported: Not verified",
      "a missing card cannot inherit another stored reference feed");
  }
});
