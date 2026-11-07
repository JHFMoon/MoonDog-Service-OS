"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "assets", "moondog-update-settings.js"), "utf8");
const first = source.indexOf("  function paintUpdateProgress() {");
const last = source.indexOf("  function render() {", first);
assert.ok(first >= 0 && last > first, "Production progress functions must be available");

function harness() {
  let clock = 1000;
  const state = { busy: true, progress: null, progressChangedAt: 0, progressStalled: false };
  const fields = new Map();
  const field = id => {
    if (!fields.has(id)) fields.set(id, {
      hidden: false, className: "", textContent: "", style: {},
      attributes: new Map(),
      setAttribute(name, value) { this.attributes.set(name, String(value)); },
      removeAttribute(name) { this.attributes.delete(name); }
    });
    return fields.get(id);
  };
  const context = vm.createContext({
    state, field, flushUi: async () => {},
    Date: { now: () => clock }
  });
  vm.runInContext(source.slice(first, last) +
    "\nglobalThis.progressApi = { paintUpdateProgress, setProgress, clearProgress, checkProgressStall };", context);
  return { state, field, api: context.progressApi, tick(ms) { clock += ms; } };
}

test("progress stays visible while idle and shows no false zero-percent measurement", async () => {
  const h = harness();
  h.api.clearProgress();
  assert.equal(h.field("updateProgress").hidden, false);
  assert.equal(h.field("updateProgressPercent").textContent, "Ready");
  assert.equal(h.field("updateProgressState").textContent, "IDLE");
  assert.equal(h.field("updateProgressTrack").attributes.has("aria-valuenow"), false);
  await h.api.setProgress({ phase: "check", percent: null,
    label: "Checking for updates", detail: "Reading manifest" });
  assert.equal(h.field("updateProgressPercent").textContent, "Working");
  assert.equal(h.field("updateProgressBar").className, "indeterminate");
  assert.equal(h.field("updateProgressTrack").attributes.has("aria-valuenow"), false);
});

test("progress watchdog identifies a stalled step after 30 seconds without inventing progress", async () => {
  const h = harness();
  await h.api.setProgress({ phase: "verify-package", percent: 17,
    label: "Verifying update package", detail: "Checking integrity" });
  assert.equal(h.field("updateProgressPercent").textContent, "17%");
  assert.equal(h.field("updateProgressTrack").attributes.get("aria-valuenow"), "17");
  h.tick(29999);
  h.api.checkProgressStall();
  assert.equal(h.state.progressStalled, false);
  h.tick(1);
  h.api.checkProgressStall();
  assert.equal(h.state.progressStalled, true);
  assert.match(h.field("updateProgressState").textContent, /STALLED/);
  assert.equal(h.field("updateProgressPercent").textContent, "17%");
  h.tick(3000);
  await h.api.setProgress({ phase: "install", percent: 31,
    label: "Installing update", detail: "Writing verified package" });
  assert.equal(h.state.progressStalled, false);
  assert.match(h.field("updateProgressState").textContent, /WORKING/);
});

test("finished, stopped and idle operations never report a false stall", async () => {
  const h = harness();
  await h.api.setProgress({ phase: "error", percent: null,
    label: "Update stopped", detail: "Permission not granted" });
  h.tick(90000);
  h.api.checkProgressStall();
  assert.equal(h.state.progressStalled, false);
  assert.match(h.field("updateProgressState").textContent, /STOPPED/);
  await h.api.setProgress({ phase: "complete", percent: 100, label: "Complete" });
  h.tick(90000);
  h.api.checkProgressStall();
  assert.equal(h.state.progressStalled, false);
  assert.equal(h.field("updateProgressPercent").textContent, "100%");
  h.api.clearProgress();
  assert.equal(h.field("updateProgressState").textContent, "IDLE");
});
