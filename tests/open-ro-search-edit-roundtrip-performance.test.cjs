"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function section(startText, endText) {
  const start = app.indexOf(startText);
  const end = app.indexOf(endText, start + startText.length);
  assert.ok(start >= 0 && end > start, "shipped source section exists: " + startText);
  return app.slice(start, end);
}
const production = [
  section("  function sortOpenRoRows(", "  function renderTable()"),
  section("  function renderTable()", "\n  function "),
  section("  async function writeJson(", "\n  async function "),
  section("  async function backupState(", "\n  async function "),
  section("  async function saveState(", "\n\n  function syncFilter("),
  section("  async function saveRecord(", "\n  async function closeRo(")
].join("\n");

function node(tagName) {
  return {
    tagName, children: [], dataset: {}, className: "", textContent: "",
    hidden: false, disabled: false, value: "",
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = [...children]; }
  };
}
function records(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: "synthetic-ro-" + String(index).padStart(4, "0"),
    ro: "SYN-" + String(index).padStart(4, "0"),
    advisor: "Synthetic Advisor " + (index % 8),
    advisorCode: "S" + (index % 8),
    customer: "Synthetic Guest " + String(index).padStart(4, "0"),
    vehicle: "Synthetic Vehicle " + (index % 25),
    sourceStatus: "Being Repaired",
    daysOpen: index % 19,
    sourceFields: { "Synthetic Source Status": "Being Repaired", "Synthetic Marker": "source-" + index },
    management: {
      status: "Being Repaired", nextAction: "Synthetic follow-up",
      reviewDate: index === 123 ? "2026-10-24" : "2026-10-27",
      communication: "Updated", owner: "Synthetic Existing Owner",
      note: "Synthetic existing note",
      manualAnnotation: "preserve-" + index
    }
  }));
}
function resultRows(table) {
  return table.children.flatMap(child => child.fragment ? child.children : [child])
    .filter(row => row.dataset && row.dataset.id);
}
function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * ratio) - 1];
}
function harness() {
  const sourceRecords = records(2100);
  const files = new Map();
  const diagnostics = [];
  const table = node("tbody");
  const banner = node("div");
  const ui = {
    searchInput: { value: "" }, advisorFilter: { value: "" },
    sourceStatusFilter: { value: "" }, managementStatusFilter: { value: "" },
    attentionFilter: { value: "" }, openRoSort: { value: "priority" },
    exactRoFilterNotice: { hidden: true, textContent: "" }, clarificationBanner: banner,
    recordCount: { textContent: "" }, openFirstRecord: { disabled: false }, roTable: table,
    editNextAction: { value: "Complete synthetic inspection" },
    editReviewDate: { value: "2026-10-26" }, editStatus: { value: "Being Repaired" },
    editStatusDetail: { value: "" }, editStatusDetailOther: { value: "" },
    editCommunication: { value: "Updated" }, editOwner: { value: "Synthetic New Owner" },
    editNote: { value: "Synthetic saved follow-up" }, editAdminBlocker: { value: "" },
    editAdminTaskDate: { value: "" }, editAdminCloseDate: { value: "" },
    editAdminChangeReason: { value: "" }, editValidation: { hidden: true, textContent: "" }
  };
  const model = {
    selectedId: null, editOrigin: "table",
    state: { appVersion: "synthetic", updatedAt: "2026-10-24T11:00:00.000Z",
      records: sourceRecords, closedRecords: [], reviewQueue: [] }
  };
  let businessDate = "2026-10-24";
  let permissionGranted = false;
  let savedFollowups = 0;
  const context = vm.createContext({
    model, ui, VERSION: "synthetic-test", STATE_PATH: ["data", "current-state.json"],
    COMMUNICATION_STATUSES: ["", "Updated", "Attempted / no response", "Needs update", "Not needed"],
    TextEncoder, TextDecoder, JSON, Error, Object, Array, String, Boolean, Map, Set, Promise,
    document: {
      createElement: node,
      createDocumentFragment() { return { fragment: true, children: [], append(...children) { this.children.push(...children); } }; }
    },
    norm: value => String(value ?? "").normalize("NFKD").toLowerCase().trim(),
    statusForRecord: record => record.management.status,
    openRoVisibleRecords: () => model.state.records,
    localDateKey: () => businessDate,
    clarificationFor: () => null,
    isClosedManagement: management => management.status === "Closed",
    adminCloseoutState: () => ({ active: false, overdue: false, needsCommitment: false,
      dueToday: false, blocker: "", taskDate: null, taskOverdue: false,
      taskDueToday: false, taskDaysLate: 0, closeDate: null,
      closeOverdue: false, closeDueToday: false, closeDaysLate: 0 }),
    validManagerReviewDate: () => false, reviewStatusDetail: () => "",
    ensureOpenRoRetrievalUi() {}, renderRecentlyReviewed() {},
    writeAuthority: {
      requireWrite() {
        if (!permissionGranted) throw Object.assign(new Error("Synthetic permission denied"), { name: "NotAllowedError" });
      }
    },
    async writeBytes(pathParts, bytes) { files.set(pathParts.join("/"), Uint8Array.from(bytes)); },
    async readJson(pathParts, fallback = null) {
      const bytes = files.get(pathParts.join("/"));
      return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : fallback;
    },
    recordDiagnostic: (kind, message) => diagnostics.push({ kind, message }),
    stamp: () => "20261024-120000",
    slug: value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    now: () => "2026-10-24T12:00:00.000Z",
    canonicalReviewStatus: value => value,
    resolveStatusId: () => "synthetic-being-repaired",
    statusDetailsFor: () => [],
    normalizedStatusDetail: () => "",
    statusAllowedForSave: () => true,
    editValidationError(message) {
      ui.editValidation.textContent = message;
      ui.editValidation.hidden = false;
      throw new Error(message);
    },
    visibleRecordIds: () => resultRows(table).map(row => row.dataset.id),
    visibleFocusIds: () => resultRows(table).map(row => row.dataset.id),
    dailySaveAdditions: null,
    finishSavedOpenRo: async () => { savedFollowups += 1; return true; }
  });
  vm.runInContext(production + [
    "this.renderForTest = renderTable;",
    "this.saveForTest = saveRecord;",
    "this.setBusinessDate = value => { businessDate = value; };",
    "this.setPermission = value => { permissionGranted = value; };",
    "this.getFiles = () => files;",
    "this.getDiagnostics = () => diagnostics;",
    "this.getSavedFollowups = () => savedFollowups;"
  ].join("\n"), context);
  return { context, model, ui, table, sourceRecords };
}

test("full synthetic Open RO table search stays measured, complete, and current after business-date rollover", () => {
  const h = harness();
  const scenarios = [
    { query: "", expected: 2100 },
    { query: "Synthetic Guest 0123", expected: 1 },
    { query: "NO-SUCH-SYNTHETIC-RO", expected: 0 }
  ];
  const results = {};
  for (const scenario of scenarios) {
    h.ui.searchInput.value = scenario.query;
    const spans = [];
    for (let sample = 0; sample < 15; sample++) {
      const start = performance.now();
      h.context.renderForTest();
      spans.push(performance.now() - start);
      assert.equal(resultRows(h.table).length, scenario.expected);
    }
    results[scenario.query || "all"] = {
      p50Ms: +percentile(spans, 0.5).toFixed(3),
      p95Ms: +percentile(spans, 0.95).toFixed(3),
      rows: resultRows(h.table).length
    };
  }

  h.ui.searchInput.value = "SYN-00123";
  h.context.renderForTest();
  assert.equal(resultRows(h.table).length, 1);
  assert.equal(resultRows(h.table)[0].dataset.id, "synthetic-ro-0123");
  assert.match(resultRows(h.table)[0].className, /commitment-due/);
  h.context.setBusinessDate("2026-10-25");
  h.context.renderForTest();
  assert.match(resultRows(h.table)[0].className, /commitment-overdue/,
    "the renderer recalculates business-date state instead of retaining a stale row");
  console.log("#58-06 synthetic Open RO search/render p50/p95:", JSON.stringify({
    dataset: "synthetic-2100-open-ros", samplesPerScenario: 15,
    timingScope: "shipped renderTable filter/sort/row construction in a synthetic DOM; excludes browser layout and installed OneDrive I/O",
    scenarios: results
  }));
  for (const result of Object.values(results)) {
    assert.ok(Number.isFinite(result.p50Ms) && Number.isFinite(result.p95Ms));
  }
});

test("search-selected Open RO save fails closed on permission loss, then retries without losing source or manual fields", async () => {
  const h = harness();
  h.ui.searchInput.value = "SYN-00123";
  h.context.renderForTest();
  const matched = resultRows(h.table);
  assert.equal(matched.length, 1, "production search selects one synthetic row");
  h.model.selectedId = matched[0].dataset.id;
  const original = JSON.parse(JSON.stringify(h.model.state));
  const event = { preventDefault() {} };

  const denied = await h.context.saveForTest(event);
  assert.equal(denied, undefined, "permission denial must not complete an unverified save");
  assert.deepEqual(JSON.parse(JSON.stringify(h.model.state)), original,
    "failed save restores the exact pre-edit source and manager snapshot");
  assert.equal(h.ui.editValidation.hidden, false);
  assert.match(h.ui.editValidation.textContent, /could not save/);
  assert.equal(h.context.getFiles().size, 0, "no backup or state file is written without permission");

  h.context.setPermission(true);
  const saved = await h.context.saveForTest(event);
  assert.equal(saved, true, "retry succeeds after synthetic permission is restored");
  const disk = await h.context.readJson(["data", "current-state.json"], null);
  const record = disk.records.find(item => item.id === "synthetic-ro-0123");
  const prior = original.records.find(item => item.id === "synthetic-ro-0123");
  assert.equal(record.management.owner, "Synthetic New Owner");
  assert.equal(record.management.nextAction, "Complete synthetic inspection");
  assert.equal(record.management.reviewDate, "2026-10-26");
  assert.equal(record.management.note, "Synthetic saved follow-up");
  assert.deepEqual(record.sourceFields, prior.sourceFields,
    "manager editing never replaces source-report fields");
  assert.equal(record.management.manualAnnotation, prior.management.manualAnnotation,
    "unrelated manual metadata survives the full search/edit/read-back round trip");
  assert.deepEqual(JSON.parse(JSON.stringify(h.model.state)), disk,
    "in-memory state matches the production durable read-back snapshot");
  assert.equal(h.context.getFiles().size, 2, "the retry writes the protective backup and new state");
  assert.equal(h.context.getSavedFollowups(), 1, "post-save completion follows verified persistence only");
  assert.ok(h.context.getDiagnostics().some(item => item.kind === "DURABLE WRITE FAILED"));
  assert.ok(h.context.getDiagnostics().some(item => item.kind === "DURABLE WRITE"));
});
