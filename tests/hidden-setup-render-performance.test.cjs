"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");

const source = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "Production boundary not found: " + start);
  return source.slice(a, b);
}
const production = section("  function renderAll() {",
  "  const renderAllWithCanonicalSourceLabels=renderAll;");
const navigation = section("  function navigateTo(view,anchor=\"\"){",
  "  function ensurePhase3Ui()");
const optimizedSite = 'if(ui["view-setup"]?.classList.contains("active")) renderSetup(); else { if(ui.setupNav)ui.setupNav.hidden=Boolean(model.settings.setup?.completedAt&&!model.settings.setup?.reopened); renderSetupGates(); }';
assert.equal(production.split(optimizedSite).length - 1, 1, "Production must gate inactive Setup rebuilding");
assert.match(navigation, /if\(view==="setup"\)renderSetup\(\)/);
const oldProduction = production.replace(optimizedSite, "renderSetup();");

function element(active = false) {
  const classes = new Set(active ? ["active"] : []);
  return {
    textContent: "", hidden: false, disabled: false, children: [], attributes: {},
    classList: {
      contains: name => classes.has(name),
      add: name => classes.add(name),
      remove: name => classes.delete(name)
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    append(...children) { this.children.push(...children); }
  };
}
function harness(records, activeSetup = false, old = false) {
  const ui = {
    metricOpen: element(), metricDue: element(), metricMissing: element(),
    metricUpdated: element(), lastImport: element(), lastExport: element(),
    exportButton: element(), pageTitle: element(), setupNav: element(),
    "view-overview": element(!activeSetup),
    "view-setup": element(activeSetup),
    "view-open-ro": element(),
    "view-arrivals": element(),
    "view-performance": element(),
    "view-meeting": element(),
    "view-assign-next": element(),
    "view-imports": element()
  };
  const model = {
    root: { name: "Synthetic Workspace" },
    state: { records, updatedAt: "2026-11-02T18:00:00Z", source: null },
    recovery: { supervisorWorkbook: null },
    settings: { setup: { completedAt: "2026-10-30T18:00:00Z", reopened: false } }
  };
  const counters = { setup: 0, gates: 0, cards: 0, overview: 0 };
  const button = element(); button.textContent = "Setup";
  const overviewButton = element(); overviewButton.textContent = "Home";
  const doc = {
    querySelector: selector => selector.includes('data-view="setup"') ? button : null,
    querySelectorAll: selector => selector === ".nav-item" ? [overviewButton, button] :
      selector === ".view" ? [ui["view-overview"], ui["view-setup"]] : [],
    getElementById: () => null
  };
  const context = vm.createContext({
    model, ui, document: doc, meetingNavigationTicket: 0,
    localDateKey: () => "2026-11-02",
    isClosedManagement: management => management?.status === "closed",
    confirmEditNavigation: () => true,
    renderOverviewPanelsIfNeeded: active => { if (active) counters.overview++; },
    renderDailyFocusIfNeeded: () => {},
    renderOpenRoFiltersIfNeeded: () => {},
    renderTable: () => {}, renderArrivals: () => {},
    renderPerformance: () => {}, renderMeeting: () => {},
    renderAssignNext: () => {},
    renderSetupGates: () => { counters.gates++; },
    renderSetup: () => {
      counters.setup++;
      // Synthetic approximation of rebuilding the 10-card Setup checklist.
      const cards = [];
      for (let i = 0; i < 10; i++) cards.push({
        name: "Synthetic setup step " + i,
        description: "Synthetic status " + records.length + " " + i,
        metadata: Array.from({ length: 12 }, (_, j) => String(i * j))
      });
      counters.cards += cards.length;
      counters.gates++;
    },
    requestAnimationFrame: () => {},
    setTimeout: () => {},
    performance, console
  });
  vm.runInContext((old ? oldProduction : production) + "\n" + navigation +
    "\nthis.actualRender=renderAll;this.actualNavigate=navigateTo;", context);
  return { ui, model, counters, render: context.actualRender, navigate: context.actualNavigate };
}
function records(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: "synthetic-" + i,
    management: {
      status: i % 7 === 0 ? "closed" : "open",
      reviewDate: i % 3 === 0 ? "2026-11-02" : "2026-11-03",
      nextAction: i % 5 === 0 ? "" : "Synthetic next step"
    }
  }));
}
function metrics(h) {
  return [h.ui.metricOpen.textContent, h.ui.metricDue.textContent,
    h.ui.metricMissing.textContent, h.ui.exportButton.disabled];
}
function percentile(values, factor) {
  const ordered = [...values].sort((a,b) => a - b);
  return +ordered[Math.ceil(ordered.length * factor) - 1].toFixed(3);
}
test("real renderAll skips rebuilding hidden Setup but preserves status and RO counts", () => {
  for (const count of [0, 2100]) {
    const rows = records(count), original = JSON.stringify(rows);
    const before = harness(rows, false, true), after = harness(rows, false, false);
    for (let i = 0; i < 4; i++) { before.render(); after.render(); }
    assert.deepEqual(metrics(after), metrics(before));
    assert.equal(before.counters.setup, 4);
    assert.equal(after.counters.setup, 0);
    assert.equal(before.counters.gates, 4);
    assert.equal(after.counters.gates, 4);
    assert.equal(after.ui.setupNav.hidden, true);
    assert.equal(JSON.stringify(rows), original, "source rows are immutable");
  }
});

test("Setup navigation immediately rebuilds the checklist, then active updates preserve it", () => {
  const h = harness(records(25));
  h.render();
  assert.equal(h.counters.setup, 0);
  h.navigate("setup");
  assert.equal(h.counters.setup, 1);
  assert.equal(h.ui["view-setup"].classList.contains("active"), true);
  h.render();
  assert.equal(h.counters.setup, 2);
  h.model.settings.setup.reopened = true;
  h.render();
  assert.equal(h.counters.setup, 3);
});

test("hidden Setup nav tracks reopened and completed state without checklist rebuilding", () => {
  const h = harness([]);
  h.render();
  assert.equal(h.ui.setupNav.hidden, true);
  h.model.settings.setup.reopened = true;
  h.render();
  assert.equal(h.ui.setupNav.hidden, false);
  h.model.settings.setup.reopened = false;
  delete h.model.settings.setup.completedAt;
  h.render();
  assert.equal(h.ui.setupNav.hidden, false);
  assert.equal(h.counters.setup, 0);
  assert.equal(h.counters.gates, 3);
});

test("24 paired synthetic trials report p50/p95 before/after without ungrounded speed targets", () => {
  const rows = records(2100), before = harness(rows, false, true),
    after = harness(rows, false, false), oldTimes = [], newTimes = [];
  before.render(); after.render();
  for (let i = 0; i < 24; i++) {
    const time = (run, sink) => {
      const start = performance.now();
      run();
      sink.push(performance.now() - start);
    };
    if (i % 2 === 0) {
      time(before.render, oldTimes); time(after.render, newTimes);
    } else {
      time(after.render, newTimes); time(before.render, oldTimes);
    }
  }
  assert.deepEqual(metrics(after), metrics(before));
  assert.equal(before.counters.setup, 25);
  assert.equal(after.counters.setup, 0);
  const result = {
    fixture: "2100 synthetic Open ROs, mocked ten-card Setup DOM workload, 24 paired samples",
    before: { p50ms: percentile(oldTimes,.5), p95ms: percentile(oldTimes,.95) },
    after: { p50ms: percentile(newTimes,.5), p95ms: percentile(newTimes,.95) }
  };
  console.log("58-hidden-setup-synthetic-performance " + JSON.stringify(result));
});
