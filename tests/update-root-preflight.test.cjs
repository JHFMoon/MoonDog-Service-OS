"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "assets", "moondog-update-settings.js"), "utf8");
const missing = () => Object.assign(new Error("Missing synthetic file"), { name: "NotFoundError" });
const manifest = {
  format: "service-operations-dashboard-clean-install", formatVersion: 1, version: "0.10.17",
  applicationRoot: "System Files", workspaceRoot: "System Files/Workspace",
  launcher: "00 - OPEN DASHBOARD.html", workspaceProtectedFromUpdates: true,
  files: [{ path: "System Files/index.html", sha256: "a".repeat(64) }]
};

function folder({ name = "Outer Dashboard", systemPresent = true, index = true,
                  workspace = true, cleanManifest = null, denied = false } = {}) {
  const calls = [];
  const system = {
    kind: "directory",
    isSameEntry: async other => other === system,
    getDirectoryHandle: async (child, options) => {
      calls.push("system/directory:" + child);
      assert.equal(options.create, false);
      if (child !== "Workspace" || !workspace) throw missing();
      return { kind: "directory" };
    },
    getFileHandle: async (child, options) => {
      calls.push("system/file:" + child);
      assert.equal(options.create, false);
      if (child !== "index.html" || !index) throw missing();
      return { kind: "file" };
    }
  };
  const root = {
    name, kind: "directory",
    resolve: async target => target === system ? ["System Files"] : null,
    getDirectoryHandle: async (child, options) => {
      calls.push("root/directory:" + child);
      assert.equal(options.create, false);
      if (denied) throw Object.assign(new Error("Access denied"), { name: "NotAllowedError" });
      if (child !== "System Files" || !systemPresent) throw missing();
      return system;
    },
    getFileHandle: async (child, options) => {
      calls.push("root/file:" + child);
      assert.equal(options.create, false);
      if (child !== "INSTALLATION-MANIFEST.json" || !cleanManifest) throw missing();
      return { kind: "file", getFile: async () => ({
        size: JSON.stringify(cleanManifest).length,
        text: async () => JSON.stringify(cleanManifest)
      }) };
    }
  };
  return { root, system, calls };
}

function harness(selected, updateStatus = "newer-version") {
  const fields = new Map(), listeners = new Map(), events = [];
  const model = { applicationRoot: selected.root };
  let connectClicks = 0;
  function field(id) {
    if (!fields.has(id)) fields.set(id, {
      textContent: "", value: "", disabled: false, hidden: false, style: {},
      setAttribute() {}, removeAttribute() {}, addEventListener(type, callback) {
        listeners.set(id + ":" + type, callback);
      }
    });
    return fields.get(id);
  }
  const card = { innerHTML: "", querySelector: selector => field(selector.slice(1)) };
  const document = {
    getElementById: id => id === "view-settings" ?
      { querySelector: () => ({ append() {} }) } :
      id === "connectButton" ? { disabled: false, click() { connectClicks++; } } : null,
    createElement: () => card, querySelector: () => null, addEventListener() {}
  };
  const context = vm.createContext({
    document, MoonDogInstalledVersion: "0.10.17",
    __moondogSettingsModel: model,
    __moondogMaintenance: { runtimePaths: ["index.html", "assets/app.js"] },
    MoonDogUpdateCheck: { check: async () => ({
      status: updateStatus, channel: "beta", version: "0.10.18-beta.425",
      packageUrl: "https://example.test/software-only.json", sha256: "b".repeat(64)
    }) },
    MoonDogUpdateInstall: { listBackups: async () => [],
      apply: async () => { events.push("apply"); throw Error("unexpected write"); } },
    MoonDogPackageVerification: { verify: async () => { events.push("package"); throw Error("unexpected network"); } },
    localStorage: { getItem: () => JSON.stringify({ channel: "beta" }), setItem() {} },
    setTimeout() {}, Date, requestAnimationFrame: fn => fn()
  });
  vm.runInContext(source, context);
  return {
    model, events, field, context, connectClicks: () => connectClicks,
    async settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); },
    async check() { await listeners.get("checkMoonDogUpdate:click")(); },
    async install() { await listeners.get("installMoonDogUpdate:click")(); },
    choose() { listeners.get("chooseUpdateFolder:click")(); }
  };
}

test("selected private Workspace and System Files paths cannot offer a misleading installation", async () => {
  for (const name of ["Workspace subfolder", "System Files"]) {
    const f = folder({ name, systemPresent: false });
    const h = harness(f); await h.check();
    assert.equal(h.field("installMoonDogUpdate").disabled, true);
    assert.equal(h.field("chooseUpdateFolder").hidden, false);
    assert.match(h.field("updateStatus").textContent, /Can't verify the installation folder/);
    await h.install();
    assert.deepEqual(h.events, [], "no package download or install for invalid root");
    assert.ok(f.calls.every(c => c === "root/directory:System Files"), "never read private records");
    h.choose();
    assert.equal(h.connectClicks(), 1, "use the existing Connect action to ask for the right folder");
  }
});

test("valid outer installation named Workspace is accepted based on structure, not name", async () => {
  const f = folder({ name: "Workspace" });
  const h = harness(f); await h.check();
  assert.equal(h.field("installMoonDogUpdate").disabled, false);
  assert.equal(h.field("chooseUpdateFolder").hidden, true);
  assert.equal(h.field("updateFolders").textContent.includes("Workspace"), true);
  assert.equal(f.calls.includes("system/directory:Workspace"), true);
  assert.equal(f.calls.some(c => c.includes("report") || c.includes("backups")), false);
});

test("missing application entry without a recognized manifest is blocked before a package", async () => {
  const f = folder({ index: false }); const h = harness(f); await h.check();
  assert.equal(h.field("installMoonDogUpdate").disabled, true);
  assert.match(h.field("updateStatus").textContent, /no recognized clean-install identity/);
  await h.install(); assert.deepEqual(h.events, []);
});

test("recognized clean-install manifest permits later software-only entry repair", async () => {
  const f = folder({ index: false, cleanManifest: manifest });
  const h = harness(f); await h.check();
  assert.equal(h.field("installMoonDogUpdate").disabled, false);
  assert.equal(h.field("chooseUpdateFolder").hidden, true);
});

test("invalid manifest version and missing private Workspace both fail closed", async () => {
  for (const f of [
    folder({ index: false, cleanManifest: { ...manifest, version: "broken" } }),
    folder({ workspace: false })
  ]) {
    const h = harness(f); await h.check();
    assert.equal(h.field("installMoonDogUpdate").disabled, true);
    await h.install(); assert.deepEqual(h.events, []);
  }
});

test("denied Edge folder permission does not download or modify software", async () => {
  const f = folder({ denied: true }); const h = harness(f); await h.check();
  assert.equal(h.field("installMoonDogUpdate").disabled, true);
  assert.match(h.field("updateStatus").textContent, /permission/);
  await h.install(); assert.deepEqual(h.events, []);
});

test("a new explicit reconnect and update check clears an old invalid root", async () => {
  const bad = folder({ systemPresent: false });
  const good = folder({ name: "Renamed-valid-copy" });
  const h = harness(bad);
  await h.check(); assert.equal(h.field("installMoonDogUpdate").disabled, true);
  h.model.applicationRoot = good.root;
  await h.check();
  assert.equal(h.field("installMoonDogUpdate").disabled, false);
  assert.equal(h.field("chooseUpdateFolder").hidden, true);
  assert.deepEqual(h.events, []);
});

test("late folder permission loss disables an already offered update before package download", async () => {
  const f = folder(), h = harness(f);
  await h.check();
  assert.equal(h.field("installMoonDogUpdate").disabled, false);
  const previous = f.root.getDirectoryHandle;
  f.root.getDirectoryHandle = async (...args) => {
    if (args[0] === "System Files")
      throw Object.assign(new Error("Access revoked after offer"), { name: "NotAllowedError" });
    return previous(...args);
  };
  await h.install();
  assert.deepEqual(h.events, [], "late permission loss cannot start a download or write");
  assert.equal(h.field("installMoonDogUpdate").disabled, true);
  assert.equal(h.field("chooseUpdateFolder").hidden, false);
  assert.match(h.field("updateStatus").textContent, /permission/i);
});

test("missing entry after update offer refuses execution without trusted identity", async () => {
  const f = folder(), h = harness(f);
  await h.check();
  assert.equal(h.field("installMoonDogUpdate").disabled, false);
  f.system.getFileHandle = async () => { throw missing(); };
  await h.install();
  assert.deepEqual(h.events, [], "no preview or verified package download after entry vanishes");
  assert.equal(h.field("installMoonDogUpdate").disabled, true);
  assert.equal(h.field("chooseUpdateFolder").hidden, false);
  assert.match(h.field("updateStatus").textContent, /no recognized clean-install identity/);
});

test("manual already-current manifest diagnoses the wrong folder without offering an update", async () => {
  const bad = folder({ name: "Wrong private subfolder", systemPresent: false });
  const h = harness(bad, "up-to-date");
  await h.check();
  assert.equal(h.field("installMoonDogUpdate").disabled, true);
  assert.equal(h.field("chooseUpdateFolder").hidden, false);
  assert.match(h.field("updateStatus").textContent, /Can't verify the installation folder/);
  assert.equal(h.field("updateProgressLabel").textContent, "Choose Dashboard Folder");
  await h.install();
  assert.deepEqual(h.events, [], "current manifest cannot excuse an unverified installation");
  assert.ok(bad.calls.length > 0 && bad.calls.every(call => call === "root/directory:System Files"),
    "diagnostic must inspect only the public software layout, not private data");
});

test("manual already-current manifest clears folder warning after explicit valid reconnect", async () => {
  const bad = folder({ systemPresent: false });
  const good = folder({ name: "Approved outer installation" });
  const h = harness(bad, "up-to-date");
  await h.check();
  assert.equal(h.field("chooseUpdateFolder").hidden, false);
  h.choose();
  assert.equal(h.connectClicks(), 1);
  h.model.applicationRoot = good.root;
  await h.check();
  assert.equal(h.field("chooseUpdateFolder").hidden, true);
  assert.equal(h.field("updateStatus").textContent, "Update check complete.");
  assert.equal(h.field("installMoonDogUpdate").disabled, true,
    "already-current software must not offer unnecessary installation");
  assert.deepEqual(h.events, []);
});
