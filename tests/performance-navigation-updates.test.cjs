"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("Beta checks retry silent failures and refresh successful manifests every 30 minutes while visible", async () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "assets", "moondog-update-settings.js"), "utf8");
  const fields = new Map(), events = new Map(), scheduled = [];
  const item = id => {
    if (!fields.has(id)) fields.set(id, { textContent: "", disabled: false, hidden: false, value: "",
      style: {}, className: "", setAttribute() {}, addEventListener() {} });
    return fields.get(id);
  };
  const card = { innerHTML: "", querySelector: selector => item(selector.slice(1)) };
  const host = { querySelector: () => ({ append() {} }) };
  let clock = Date.parse("2026-10-12T21:00:00.000Z");
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const root = { name: "Workspace", async getDirectoryHandle() {
    throw Object.assign(new Error("No test asset"), { name: "NotFoundError" });
  } };
  let calls = 0;
  const result = () => ++calls === 1 ? { status: "silent" } : {
    status: "newer-version", version: "0.10.18-beta.46", channel: "beta",
    packageUrl: "https://example.test/beta.json", sha256: "a".repeat(64)
  };
  const saved = {};
  const context = vm.createContext({
    document: {
      hidden: false, querySelector: () => null,
      getElementById: id => id === "view-settings" ? host : null,
      createElement: () => card,
      addEventListener: (name, handler) => events.set("document:" + name, handler)
    },
    MoonDogInstalledVersion: "0.10.17",
    __moondogSettingsModel: { applicationRoot: root },
    MoonDogUpdateCheck: { check: async () => result() },
    MoonDogUpdateInstall: { listBackups: async () => [] },
    localStorage: { getItem: key => saved[key] || "{}", setItem: (key, value) => { saved[key] = value; } },
    Date: Clock,
    setTimeout: (callback, delay) => {
      const scheduledItem = { callback, delay };
      scheduled.push(scheduledItem);
      return { unref() {} };
    },
    addEventListener: (name, handler) => events.set("global:" + name, handler)
  });
  vm.runInContext(src, context);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const initial = scheduled.find(t => t.delay === 2000);
  const periodic = scheduled.find(t => t.delay === 5 * 60 * 1000);
  assert.ok(initial && periodic, "Visible startup and bounded retry must both be scheduled");

  initial.callback();
  await flush();
  assert.equal(calls, 1, "first automatic check runs on startup");

  // Failure is silent, but does not count as a successful manifest check.
  const preferences = JSON.parse(saved["moondog-public-update-preferences-v1"]);
  assert.equal(preferences.lastCheck, null);
  clock += 6 * 60 * 1000;
  periodic.callback();
  await flush();
  assert.equal(calls, 2, "a failed fetch is retried automatically");
  assert.match(item("updateAvailability").textContent, /Beta 0.10.18-beta.46 available/);

  clock += 1 * 60 * 1000;
  events.get("global:focus")();
  const onFocus = scheduled.at(-1);
  assert.equal(onFocus.delay, 1500);
  onFocus.callback();
  await flush();
  assert.equal(calls, 2, "success throttles repeated checks");

  clock += 30 * 60 * 1000;
  scheduled.findLast(t => t.delay === 5 * 60 * 1000).callback();
  await flush();
  assert.equal(calls, 3, "a visible session rechecks after thirty minutes");
});
