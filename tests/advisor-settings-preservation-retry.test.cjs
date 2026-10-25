"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function source(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "Missing production settings boundary: " + start);
  return app.slice(a, b);
}
const persistence = source("  function persistSettingsSnapshot(", "  async function saveSettingsAutosave(");
const lifecycle = source("  async function updateAdvisorLifecycle(", "  async function reconcileSaprAdvisors(");

function fixture() {
  let failWrite = false;
  const calls = [];
  const model = {
    root: {name: "Synthetic workspace"},
    settings: {
      updatedAt: "before",
      store: {name: "Synthetic saved name"},
      advisors: {"101": {
        number: "101", name: "Synthetic Advisor", removed: true,
        setupRequired: true, active: true, participation: {}
      }}
    }
  };
  const ui = {
    storeName: {value: "Unsaved synthetic store-name draft"},
    settingsSaveStatus: {dataset: {}, textContent: ""}
  };
  const context = vm.createContext({
    model, ui, SETTINGS_PATH: ["data", "settings.json"], structuredClone,
    settingsWriteChain: Promise.resolve(), settingsAutosaveRevision: 0,
    writeJson: async (_path, snapshot) => {
      calls.push({type: "write", snapshot: structuredClone(snapshot)});
      if (failWrite) throw new Error("Synthetic disk denial");
    },
    now: () => "2026-10-23T10:00:00.000Z",
    writeAuthority: {canWrite: true},
    renderAdvisorSettings: () => calls.push({type: "renderAdvisorSettings",
      setupRequired: model.settings.advisors["101"].setupRequired}),
    renderSupervisorWorksheetOrder: () => calls.push({type: "renderSupervisorWorksheetOrder"}),
    renderAll: () => calls.push({type: "renderAll"}),
    renderSetup: () => calls.push({type: "renderSetup",
      setupRequired: model.settings.advisors["101"].setupRequired}),
    renderSettings: () => calls.push({type: "renderSettings"}),
    addHistory: async (type) => calls.push({type: "history", event: type})
  });
  vm.runInContext(
    persistence + "\n" + lifecycle +
    "\nthis.updateAdvisorLifecycle=updateAdvisorLifecycle;" +
    "this.markAdvisorSetupReviewed=markAdvisorSetupReviewed;",
    context
  );
  return {context, model, ui, calls, setFail(value) { failWrite = value; }};
}

test("advisor restore preserves an unsaved synthetic settings draft", async () => {
  const f = fixture();
  await f.context.updateAdvisorLifecycle("101", "restore");
  assert.equal(f.model.settings.advisors["101"].removed, false);
  assert.equal(f.ui.storeName.value, "Unsaved synthetic store-name draft");
  assert.equal(f.calls.some(call => call.type === "renderSettings"), false,
    "restoring an advisor must not redraw unrelated settings inputs");
  assert.ok(f.calls.some(call => call.type === "renderAdvisorSettings"));
});

test("failed setup-review persistence keeps the action retryable and successful retry is durable", async () => {
  const f = fixture();
  f.setFail(true);
  await assert.rejects(
    f.context.markAdvisorSetupReviewed("101"),
    /Synthetic disk denial/
  );
  assert.equal(f.model.settings.advisors["101"].setupRequired, true,
    "failed read-back persistence must not clear the pending review in memory");
  assert.ok(f.calls.some(call => call.type === "renderAdvisorSettings" && call.setupRequired === true),
    "the restored advisor controls must still offer the review action");
  assert.ok(f.calls.some(call => call.type === "renderSetup" && call.setupRequired === true));
  assert.equal(f.ui.settingsSaveStatus.dataset.saveState, "error");

  f.setFail(false);
  await f.context.markAdvisorSetupReviewed("101");
  assert.equal(f.model.settings.advisors["101"].setupRequired, false);
  assert.equal(f.calls.at(-1).type, "history");
  assert.equal(f.calls.at(-1).event, "advisor-setup-reviewed");
  assert.equal(f.ui.settingsSaveStatus.dataset.saveState, "saved");
  assert.equal(f.calls.filter(call => call.type === "write").length, 2,
    "the retry writes through the production serialized settings snapshot helper");
});

test("routine renderAll does not redraw the entire settings form", () => {
  const renderAll = source("  function renderAll() {", "  const renderAllWithCanonicalSourceLabels=");
  assert.doesNotMatch(renderAll, /renderSettings\s*\(/);
});
