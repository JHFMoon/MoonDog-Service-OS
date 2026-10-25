"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const tableStart = app.indexOf("  function renderTable()");
const tableEnd = app.indexOf("\n  function ", tableStart + 18);
assert.ok(tableStart >= 0 && tableEnd > tableStart, "use the shipped Open RO table renderer");
const tableSource = app.slice(tableStart, tableEnd);
const sortStart = app.indexOf("  function sortOpenRoRows(");
assert.ok(sortStart >= 0 && sortStart < tableStart, "use the shipped Open RO sorter");
const sortSource = app.slice(sortStart, tableStart);

function element(tagName) {
  return {
    tagName,
    children: [],
    dataset: {},
    className: "",
    textContent: "",
    hidden: false,
    disabled: false,
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = [...children]; }
  };
}

function syntheticRecords(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: "synthetic-open-ro-" + String(i).padStart(4, "0"),
    ro: "SYN-" + String(i).padStart(4, "0"),
    advisor: "Synthetic Advisor " + (i % 8),
    advisorCode: "S" + (i % 8),
    customer: "Synthetic Guest " + String(i).padStart(4, "0"),
    vehicle: "Synthetic Vehicle " + (i % 25),
    sourceStatus: "Being Repaired",
    daysOpen: i % 19,
    management: {
      status: "Being Repaired",
      nextAction: "Synthetic follow-up",
      reviewDate: "2026-10-24",
      communication: "Updated"
    }
  }));
}

function harness(records) {
  const table = element("tbody");
  const ui = {
    searchInput: { value: "" },
    advisorFilter: { value: "" },
    sourceStatusFilter: { value: "" },
    managementStatusFilter: { value: "" },
    attentionFilter: { value: "" },
    openRoSort: { value: "priority" },
    exactRoFilterNotice: { hidden: true, textContent: "" },
    clarificationBanner: element("div"),
    recordCount: { textContent: "" },
    openFirstRecord: { disabled: false },
    roTable: table
  };
  const context = vm.createContext({
    ui,
    model: { state: { reviewQueue: [] } },
    document: {
      createElement: tagName => element(tagName),
      createDocumentFragment() { return { fragment: true, children: [], append(...children) { this.children.push(...children); } }; }
    },
    ensureOpenRoRetrievalUi() {},
    norm: value => String(value ?? "").normalize("NFKD").toLowerCase().trim(),
    statusForRecord: record => record.management.status,
    openRoVisibleRecords: () => records,
    localDateKey: () => "2026-10-24",
    clarificationFor: () => null,
    isClosedManagement: management => management.status === "Closed",
    adminCloseoutState: () => ({
      active: false, overdue: false, needsCommitment: false, dueToday: false,
      blocker: "", taskDate: null, taskOverdue: false, taskDueToday: false,
      taskDaysLate: 0, closeDate: null, closeOverdue: false,
      closeDueToday: false, closeDaysLate: 0
    }),
    validManagerReviewDate: () => false,
    reviewStatusDetail: () => "",
    renderRecentlyReviewed() {}
  });
  vm.runInContext(sortSource + "\n" + tableSource + "\nthis.renderForTest = renderTable;", context);
  return { ui, table, render: context.renderForTest };
}

function percentile(values, ratio) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.ceil(ordered.length * ratio) - 1];
}

function measure(records, query, expectedRows) {
  const h = harness(records);
  h.ui.searchInput.value = query;
  for (let i = 0; i < 3; i++) h.render();
  const times = [];
  for (let i = 0; i < 15; i++) {
    const start = performance.now();
    h.render();
    times.push(performance.now() - start);
  }
  const children = h.table.children.length === 1 && h.table.children[0].fragment
    ? h.table.children[0].children
    : h.table.children;
  const rowCount = children.filter(row => row.dataset?.id).length;
  assert.equal(rowCount, expectedRows, "the synthetic result count must remain complete");
  return {
    p50Ms: +percentile(times, 0.5).toFixed(3),
    p95Ms: +percentile(times, 0.95).toFixed(3),
    rows: rowCount
  };
}

test("synthetic Open RO search, sort, and rendered-table baseline reports p50/p95", () => {
  const records = syntheticRecords(2100);
  const full = measure(records, "", 2100);
  const search = measure(records, "Synthetic Guest 0123", 1);
  const empty = measure(records, "NO-SUCH-SYNTHETIC-RO", 0);
  const result = {
    dataset: "synthetic-2100-open-ros",
    samplesPerScenario: 15,
    scenarios: { fullTable: full, representativeSearch: search, emptySearch: empty },
    timingScope: "production renderTable filter/sort/row-construction path in synthetic Node CI; excludes real browser layout and installed OneDrive I/O"
  };
  console.log("#58-04 Open RO synthetic interaction baseline:", JSON.stringify(result));
  for (const scenario of Object.values(result.scenarios)) {
    assert.ok(Number.isFinite(scenario.p50Ms) && Number.isFinite(scenario.p95Ms));
  }
});
