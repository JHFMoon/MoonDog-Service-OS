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
const recentStart=app.indexOf("  function renderRecentlyReviewed(){");
const recentEnd=app.indexOf("\n  // Sorting is presentation-only",recentStart);
assert.ok(recentStart>=0&&recentEnd>recentStart,"exercise shipped Recently Reviewed DOM renderer");
const recentSource=app.slice(recentStart,recentEnd);
const optimizedGuard="if(!ui.recentlyReviewedPanel?.hidden)renderRecentlyReviewed();";
assert.equal(tableSource.split(optimizedGuard).length,2,"one guarded hidden-panel call");

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
      communication: "Updated",
      managerReviewedOn: i % 3 === 0 ? "2026-10-24" : ""
    }
  }));
}

function harness(records,{legacy=false,reviewPanelVisible=false}={}) {
  const table = element("tbody"),reviewPanel=element("div");
  reviewPanel.hidden=!reviewPanelVisible;
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
    roTable: table,
    recentlyReviewedPanel: reviewPanel
  };
  const context = vm.createContext({
    ui,
    model: { state: { reviewQueue: [],records } },
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
    validManagerReviewDate: record => Boolean(record.management.managerReviewedOn),
    trustedManagerReviewTime: record => record.management.updatedAt || "",
    reviewStatusDetail: () => ""
  });
  // Reconstruct only the legacy unguarded invocation for a SAME-input timing
  // baseline. Both alternatives still execute the extracted production DOM
  // functions with identical records and fabricated browser nodes.
  const renderSource=legacy?tableSource.replace(optimizedGuard,"renderRecentlyReviewed();"):tableSource;
  vm.runInContext(recentSource+"\n"+sortSource+"\n"+renderSource+
    "\nlet recentBuilds=0; const productionRecentRenderer=renderRecentlyReviewed;"+
    "\nrenderRecentlyReviewed=function(){recentBuilds++;return productionRecentRenderer();};"+
    "\nthis.renderForTest=renderTable;this.getRecentBuilds=()=>recentBuilds;"+
    "\nthis.openRecentForTest=()=>{ui.recentlyReviewedPanel.hidden=false;renderRecentlyReviewed();};",context);
  return { ui, table, render: context.renderForTest,
    recentBuilds:context.getRecentBuilds,openRecent:context.openRecentForTest };
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

test("hidden Recently Reviewed panel stays deferred, opens with fresh rows and updates while visible",()=>{
  const rows=syntheticRecords(2100),h=harness(rows);
  h.ui.searchInput.value="Synthetic Guest 0012";
  h.render();
  assert.equal(h.recentBuilds(),0,"hidden reviewed panel must not perform extra DOM work");
  assert.equal(h.ui.recentlyReviewedPanel.children.length,0);
  h.openRecent(); // mirrors the shipped Recently Reviewed button click path
  assert.equal(h.recentBuilds(),1);
  assert.equal(h.ui.recentlyReviewedPanel.children.length,15,
    "opening the previously hidden panel builds the current top fifteen entries");
  h.ui.searchInput.value="Synthetic Guest 0045";
  h.render();
  assert.equal(h.recentBuilds(),2,"open panel keeps updating when source/filter changes");
  h.ui.recentlyReviewedPanel.hidden=true;h.render();
  assert.equal(h.recentBuilds(),2,"closing the panel avoids repeated work");
  h.openRecent();
  assert.equal(h.recentBuilds(),3,"reopening refreshes current reviewed rows");
});

test("paired same-data Open RO search p50/p95 measures hidden reviewed-panel work removal",()=>{
  const records=syntheticRecords(2100),unchanged=JSON.stringify(records);
  const before=harness(records,{legacy:true}),after=harness(records);
  const n=24,oldTimes=[],newTimes=[];
  for(let i=0;i<3;i++){before.render();after.render();}
  for(let i=0;i<n;i++){
    const query=["Synthetic Guest 0012","Synthetic Advisor 4","SYN-0100"][i%3];
    for(const [h,values] of [[before,oldTimes],[after,newTimes]]){
      h.ui.searchInput.value=query;
      const start=performance.now();h.render();values.push(performance.now()-start);
    }
  }
  const oldP50=percentile(oldTimes,.50),oldP95=percentile(oldTimes,.95);
  const newP50=percentile(newTimes,.50),newP95=percentile(newTimes,.95);
  const summary={dataset:"synthetic-2100-open-ros",pairedSamples:n,
    before:{p50Ms:+oldP50.toFixed(3),p95Ms:+oldP95.toFixed(3)},
    after:{p50Ms:+newP50.toFixed(3),p95Ms:+newP95.toFixed(3)},
    savedP50Ms:+(oldP50-newP50).toFixed(3),savedP95Ms:+(oldP95-newP95).toFixed(3),
    p50ChangePercent:+((newP50-oldP50)/Math.max(oldP50,.001)*100).toFixed(1),
    p95ChangePercent:+((newP95-oldP95)/Math.max(oldP95,.001)*100).toFixed(1),
    timingScope:"production Open RO filter+table and actual Recently Reviewed DOM renderer; synthetic Node VM, not installed browser layout/OneDrive"};
  console.log("#58-04 hidden review panel paired timing",JSON.stringify(summary));
  assert.equal(before.recentBuilds(),n+3,"legacy path rebuilt hidden panel each time");
  assert.equal(after.recentBuilds(),0,"optimized path avoided unnecessary hidden work");
  assert.equal(JSON.stringify(records),unchanged,"search and review must not mutate source records");
  assert.ok(Number.isFinite(newP50)&&Number.isFinite(newP95),"real timing samples were recorded");
});
