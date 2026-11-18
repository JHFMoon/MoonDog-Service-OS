"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  async function scanRecoveryBackups()");
const end = app.indexOf("  // A validated backup can become stale", start);
assert.ok(start >= 0 && end > start, "Production backup inventory code exists");

function fixture(directory, readFileBytes) {
  const listeners = {};
  const select = {
    value: "", options: [],
    replaceChildren(...options) { this.options = options; this.value = ""; },
    append(option) { this.options.push(option); }
  };
  const ui = {restoreBackupSelect: select, restoreBackupDetails: {}, restoreBackup: {}};
  const model = {root: {id: "A"}};
  const context = vm.createContext({
    model, ui, directory, readFileBytes,
    document: {addEventListener: (name, listener) => { listeners[name] = listener; }},
    Option: function(label, value) { this.label = label; this.value = value; },
    validateBackupBytes: async bytes => ({manifest: {
      createdAt: "2026-11-04T18:00:00Z",
      label: bytes[0] === 1 ? "Synthetic A" : "Synthetic B",
      appVersion: "test-version", recordCounts: {openRos: 1}
    }})
  });
  vm.runInContext(app.slice(start, end) + "\nthis.scan = scanRecoveryBackups; this.selectBackup = refreshRecoveryBackupSelection;", context);
  return {model, ui, select, scan: context.scan, selectBackup: context.selectBackup, listeners};
}

function backupDirectory(id, beforeGet = async () => {}) {
  return {async *entries() {
    yield [`MoonDog Full Backup - ${id}.zip`, {
      kind: "file",
      async getFile() {
        await beforeGet();
        return {arrayBuffer: async () => Uint8Array.of(id === "A" ? 1 : 2).buffer};
      }
    }];
  }};
}

test("a late backup inventory from the preceding Workspace cannot replace the selected Workspace list", async () => {
  let release, reading;
  const blocked = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { reading = resolve; });
  const home = fixture(async () => home.model.root.id === "A"
    ? backupDirectory("A", async () => { reading(); await blocked; })
    : backupDirectory("B"));
  const scanA = home.scan();
  await started;
  home.model.root = {id: "B"};
  await home.scan();
  assert.match(home.select.options[1].value, /B\.zip$/);
  release();
  await scanA;
  assert.match(home.select.options[1].value, /B\.zip$/);
});

test("an installation with no backup directory has an empty list and the inventory creates no folder", async () => {
  const creates = [];
  const home = fixture(async (_path, create) => {
    creates.push(create);
    if (home.model.root.id === "A") return backupDirectory("A");
    throw Object.assign(Error("Missing directory"), {name: "NotFoundError"});
  });
  await home.scan();
  home.model.root = {id: "B"};
  await home.scan();
  assert.deepEqual(creates, [false, false]);
  assert.deepEqual(home.select.options.map(option => option.value), [""]);
  assert.match(home.ui.restoreBackupDetails.textContent, /no validated backups/i);
  assert.equal(home.ui.restoreBackup.disabled, true);
});

test("a pending backup verification cannot re-enable Restore after changing Workspaces", async () => {
  let release, reading;
  const blocked = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { reading = resolve; });
  const home = fixture(async () => backupDirectory(home.model.root.id), async () => {
    reading();
    await blocked;
    return Uint8Array.of(1);
  });
  await home.scan();
  home.select.value = home.select.options[1].value;
  const pending = home.selectBackup();
  await started;
  assert.equal(home.ui.restoreBackup.disabled, true, "Restore waits for verification");
  home.model.root = {id: "B"};
  home.listeners["moondog-workspace-changing"]();
  assert.equal(home.select.value, "");
  await home.scan();
  const bMessage = home.ui.restoreBackupDetails.textContent;
  release();
  await pending;
  assert.equal(home.ui.restoreBackup.disabled, true);
  assert.equal(home.ui.restoreBackupDetails.textContent, bMessage);
  assert.match(home.select.options[1].value, /B\.zip$/);
  home.select.value = home.select.options[1].value;
  await home.selectBackup();
  assert.equal(home.ui.restoreBackup.disabled, false);
  assert.match(home.ui.restoreBackupDetails.textContent, /VALIDATED/);
});

test("an unreadable catalogue clears options and distinguishes unknown from an empty directory", async () => {
  const home = fixture(async () => {
    if (home.model.root.id === "A") return backupDirectory("A");
    throw Object.assign(Error("Synthetic access denied"), {name: "NotAllowedError"});
  });
  await home.scan();
  home.model.root = {id: "B"};
  await assert.rejects(home.scan(), /Synthetic access denied/);
  assert.deepEqual(home.select.options.map(option => option.value), [""]);
  assert.match(home.ui.restoreBackupDetails.textContent, /couldn't list backups/i);
  assert.equal(home.ui.restoreBackup.disabled, true);
});
