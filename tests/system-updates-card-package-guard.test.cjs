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

function mountUpdaterCard(html, settingsSource = read("assets/moondog-update-settings.js").toString("utf8")) {
  const hasSettingsHost = /<section\b[^>]*\bid="view-settings"[^>]*>/.test(html);
  const hasSettingsSections = /<div\b[^>]*\bclass="[^"]*\bsettings-sections\b[^"]*"[^>]*>/.test(html);
  const appended = [], created = [];
  const sections = { append: card => appended.push(card) };
  const host = { querySelector: selector =>
    selector === ".settings-sections" && hasSettingsSections ? sections : null };
  const document = {
    getElementById: id => id === "view-settings" && hasSettingsHost ? host : null,
    createElement: tag => {
      assert.equal(tag, "section");
      const card = { className: "", id: "", innerHTML: "" };
      created.push(card);
      return card;
    }
  };
  const mountEnd = settingsSource.indexOf("  const field = id =>", settingsSource.indexOf('  const card = document.createElement("section");'));
  assert.ok(mountEnd > 0, "updater module bootstrap and card mount block must remain present");
  vm.runInNewContext(settingsSource.slice(0, mountEnd) + "})(globalThis);", {
    document,
    localStorage: { getItem: () => null },
    MoonDogInstalledVersion: "0.10.18-beta.156"
  });
  return { appended, created };
}

test("Dashboard updater module mounts System Updates into the host declared by index.html", () => {
  const html = read("index.html").toString("utf8");
  const scriptPaths = [...html.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)].map(match => match[1]);
  assert.deepEqual(scriptPaths.filter(file => updaterPaths.includes(file)), updaterPaths,
    "index.html must load every updater module once and in dependency order");

  const result = mountUpdaterCard(html);
  assert.equal(result.created.length, 1);
  assert.equal(result.appended.length, 1, "System Updates must mount in the actual Settings host");
  assert.equal(result.appended[0].id, "settings-update");
  assert.match(result.appended[0].innerHTML, /<h2>System Updates<\/h2>/);
  assert.match(result.appended[0].innerHTML, /id="updateAvailability"/);
  assert.match(result.appended[0].innerHTML, /id="checkMoonDogUpdate"/);
});

test("updater mount regression catches missing Settings host or settings-sections container", () => {
  const html = read("index.html").toString("utf8");
  const noSettingsHost = mountUpdaterCard(html.replace('id="view-settings"', 'id="settings-view-missing"'));
  assert.equal(noSettingsHost.created.length, 0, "a renamed Settings host must prevent a false mount pass");
  assert.equal(noSettingsHost.appended.length, 0);

  const noSettingsSections = mountUpdaterCard(html.replace('class="settings-sections"', 'class="settings-container"'));
  assert.equal(noSettingsSections.created.length, 1);
  assert.equal(noSettingsSections.appended.length, 0, "a missing mount target must not report a mounted card");
});

test("trusted Beta package includes hashed approved copies of all updater scripts", () => {
  const manifest = JSON.parse(read("updates/manifest.json").toString("utf8"));
  const beta = manifest.beta;
  assert.equal(manifest.stable.version, "0.10.17", "this guard must not move Stable");
  assert.equal(beta.migrationRequired, false, "updater package must not require Workspace migration");
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
    assert.equal(sha256(Buffer.from(entry.contentBase64, "base64")), entry.sha256,
      file + " package entry hash must be valid");
  }

  const packagedIndex = packaged.get("index.html");
  assert.ok(packagedIndex && packagedIndex.action === "put", "Beta package must include its Dashboard entry point");
  const packagedIndexBytes = Buffer.from(packagedIndex.contentBase64, "base64");
  assert.equal(sha256(packagedIndexBytes), packagedIndex.sha256, "packaged Dashboard entry hash must be valid");
  const packagedSettings = packaged.get("assets/moondog-update-settings.js");
  assert.ok(packagedSettings && packagedSettings.action === "put", "Beta package must include its updater card module");
  const packagedMount = mountUpdaterCard(
    packagedIndexBytes.toString("utf8"),
    Buffer.from(packagedSettings.contentBase64, "base64").toString("utf8")
  );
  assert.equal(packagedMount.appended.length, 1, "the packaged Dashboard must mount its System Updates card");
});
