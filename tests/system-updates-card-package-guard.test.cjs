"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const updaterPaths = [
  "assets/moondog-update-check.js",
  "assets/moondog-update-verify.js",
  "assets/moondog-update-plan.js",
  "assets/moondog-update-model.js",
  "assets/moondog-update-install.js",
  "assets/moondog-update-settings.js"
];
const read = relative => fs.readFileSync(path.join(root, relative));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

test("Dashboard loads all updater scripts in dependency order and mounts System Updates", () => {
  const html = read("index.html").toString("utf8");
  const scriptPaths = [...html.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)].map(match => match[1]);
  const loadedUpdaterPaths = scriptPaths.filter(file => updaterPaths.includes(file));
  assert.deepEqual(loadedUpdaterPaths, updaterPaths, "index.html must load every updater module once and in order");

  const settingsSource = read("assets/moondog-update-settings.js").toString("utf8");
  assert.match(settingsSource, /getElementById\("view-settings"\)/);
  assert.match(settingsSource, /querySelector\("\.settings-sections"\)/);
  const mountStart = settingsSource.indexOf('  const card = document.createElement("section");');
  const mountEnd = settingsSource.indexOf("  const field = id =>", mountStart);
  assert.ok(mountStart >= 0 && mountEnd > mountStart, "updater card mount block must remain present");

  const appended = [];
  const sections = { append: card => appended.push(card) };
  const host = { querySelector: selector => selector === ".settings-sections" ? sections : null };
  const card = { className: "", id: "", innerHTML: "" };
  const document = { createElement: tag => {
    assert.equal(tag, "section");
    return card;
  } };
  const mountBlock = settingsSource.slice(mountStart, mountEnd);
  vm.runInNewContext("(function () {\n" + mountBlock + "\n})()", { document, host });

  assert.equal(appended.length, 1, "System Updates card must mount in the settings view");
  assert.equal(appended[0].id, "settings-update");
  assert.match(appended[0].innerHTML, /<h2>System Updates<\/h2>/);
  assert.match(appended[0].innerHTML, /id="updateAvailability"/);
  assert.match(appended[0].innerHTML, /id="checkMoonDogUpdate"/);
});

test("missing settings section fails closed without inserting a detached updater card", () => {
  const settingsSource = read("assets/moondog-update-settings.js").toString("utf8");
  const mountStart = settingsSource.indexOf('  const card = document.createElement("section");');
  const mountEnd = settingsSource.indexOf("  const field = id =>", mountStart);
  assert.ok(mountStart >= 0 && mountEnd > mountStart, "updater card mount block must remain present");
  const appended = [];
  const created = [];
  const host = { querySelector: () => null };
  const document = { createElement: () => {
    const card = { innerHTML: "", id: "", className: "" };
    created.push(card);
    return card;
  } };
  const mountBlock = settingsSource.slice(mountStart, mountEnd);
  vm.runInNewContext("(function () {\n" + mountBlock + "\n})()", { document, host });
  assert.equal(created.length, 1);
  assert.deepEqual(appended, []);
});

test("trusted Beta manifest package contains byte-identical approved updater runtime files", () => {
  const manifest = JSON.parse(read("updates/manifest.json").toString("utf8"));
  const beta = manifest.beta;
  assert.equal(manifest.stable.version, "0.10.17", "this guard must not move Stable");
  assert.equal(beta.migrationRequired, false, "updater regression package must not require Workspace migration");
  const packageName = "moondog-" + beta.version + ".json";
  assert.ok(new URL(beta.packageUrl).pathname.endsWith("/updates/packages/" + packageName));
  const packageBytes = read(path.join("updates", "packages", packageName));
  assert.equal(sha256(packageBytes), beta.sha256, "manifest must identify the exact Beta package bytes");
  const bundle = JSON.parse(packageBytes.toString("utf8"));
  assert.equal(bundle.version, beta.version);
  const approved = new Set(bundle.approvedFiles || []);
  const packaged = new Map((bundle.files || []).map(file => [file.path, file]));
  const app = read("assets/app.js").toString("utf8");
  const catalogMatch = app.match(/const HANDOFF_RUNTIME_PATHS=(\[[^;]+\]);/s);
  assert.ok(catalogMatch, "reviewed runtime inventory must remain available");
  const catalog = new Set(JSON.parse(catalogMatch[1]));

  for (const file of updaterPaths) {
    assert.ok(catalog.has(file), file + " must be in the approved runtime inventory");
    assert.ok(approved.has(file), file + " must be approved by the trusted Beta package");
    const entry = packaged.get(file);
    assert.ok(entry && entry.action === "put", file + " must be present as a packaged runtime file");
    const bytes = Buffer.from(entry.contentBase64, "base64");
    assert.equal(sha256(bytes), entry.sha256, file + " package entry hash must be valid");
    assert.deepEqual(bytes, read(file), file + " Beta bytes must match the reviewed source");
  }
});
