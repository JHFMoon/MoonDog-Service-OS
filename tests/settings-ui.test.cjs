const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("connected CSS marker reports the installed Beta without a second app-folder picker", async () => {
  const packageFile = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "updates", "packages", "moondog-0.10.7-beta.1.json"), "utf8"));
  const css = Buffer.from(packageFile.files[0].contentBase64, "base64").toString("utf8");
  const fields = new Map();
  const listeners = new Map();
  const checks = [];
  const field = id => {
    if (!fields.has(id)) fields.set(id, { textContent: "", disabled: false,
      value: "", hidden: false, addEventListener: (type, handler) => listeners.set(id + ":" + type, handler) });
    return fields.get(id);
  };
  const card = { className: "", id: "", innerHTML: "", querySelector: selector => field(selector.slice(1)) };
  let mountedInSettings = false;
  const host = { querySelector: selector => selector === ".settings-sections" ?
    { append: value => { assert.equal(value, card); mountedInSettings = true; } } : null };
  const events = new Map();
  const root = { name: "Test-App", getDirectoryHandle: async (name, options) => {
    assert.equal(name, "assets"); assert.equal(options.create, false);
    return { getFileHandle: async (file, fileOptions) => {
      assert.equal(file, "product-settings.css"); assert.equal(fileOptions.create, false);
      return { getFile: async () => ({ text: async () => css }) };
    } };
  } };
  const context = vm.createContext({
    document: { getElementById: id => id === "view-settings" ? host : null,
      createElement: () => card, addEventListener: (name, handler) => events.set(name, handler) },
    MoonDogInstalledVersion: "0.10.6-freshness",
    __moondogSettingsModel: { root },
    MoonDogUpdateCheck: { check: async options => { checks.push(options); return { status: "up-to-date", version: "0.10.7-beta.1" }; } },
    localStorage: { getItem: () => '{"channel":"beta","lastCheck":"2099-01-01T00:00:00Z"}', setItem: () => {} },
    showDirectoryPicker: () => { throw new Error("Application root must not be reselected"); },
    Date
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "updates", "settings-ui.js"), "utf8");
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(field("updateInstalledVersion").textContent, "0.10.7-beta.1");
  assert.equal(mountedInSettings, true);
  assert.equal(field("updateInstalledChannel").textContent, "Beta");
  assert.equal(card.innerHTML.includes("selectUpdateApp"), false);
  assert.equal(card.innerHTML.includes("selectUpdateBackup"), false);
  assert.equal(source.includes("showDirectoryPicker"), false);
  assert.equal(source.includes("backupDirectoryHandle"), false);
  assert.match(field("updateFolders").textContent, /backups\/system-updates\//);
  assert.doesNotMatch(card.innerHTML.replace(/id="[^"]+"/g, ""), /MoonDog|separate backup folder/);
  assert.doesNotMatch(field("updateFolders").textContent, /MoonDog/);
  assert.match(field("updateFolders").textContent, /Connected application folder: Test-App/);
  await listeners.get("checkMoonDogUpdate:click")();
  assert.equal(checks.at(-1).currentVersion, "0.10.7-beta.1");
  assert.equal(checks.at(-1).channel, "beta");
});

test("update offer and preview expire on channel or check changes; recovery stays hidden without an interrupted backup", async () => {
  const fields = new Map(), listeners = new Map(), documentListeners = new Map();
  const field = id => {
    if (!fields.has(id)) fields.set(id, { textContent: "", disabled: false, hidden: false, value: "",
      addEventListener: (type, handler) => listeners.set(id + ":" + type, handler) });
    return fields.get(id);
  };
  const card = { innerHTML: "", querySelector: selector => field(selector.slice(1)) };
  const root = { name: "Test-App", getDirectoryHandle: async () => { throw Object.assign(new Error("missing"), { name: "NotFoundError" }); } };
  let offered = { status: "newer-version", channel: "beta", version: "0.10.7-beta.2",
    packageUrl: "https://example.test/beta.json", sha256: "a".repeat(64) };
  let recoverable = [];
  const context = vm.createContext({
    document: { getElementById: id => id === "view-settings" ? {
      querySelector: () => ({ append: () => {} }) } : null,
      createElement: () => card, addEventListener: (name, handler) => documentListeners.set(name, handler) },
    MoonDogInstalledVersion: "0.10.6-freshness", __moondogSettingsModel: { root },
    MoonDogUpdateCheck: { check: async () => offered },
    MoonDogUpdateInstall: { listBackups: async () => recoverable },
    localStorage: { getItem: () => '{"channel":"beta","lastCheck":"2099-01-01T00:00:00Z"}', setItem: () => {} }, Date
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "updates", "settings-ui.js"), "utf8"), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(field("recoverMoonDogUpdate").hidden, true);
  await listeners.get("checkMoonDogUpdate:click")();
  assert.equal(field("installMoonDogUpdate").disabled, false);
  field("updatePlan").textContent = "stale preview"; field("updatePlan").hidden = false;
  field("updateChannel").value = "stable"; listeners.get("updateChannel:change")();
  assert.equal(field("installMoonDogUpdate").disabled, true);
  assert.equal(field("updatePlan").textContent, "");
  assert.equal(field("updatePlan").hidden, true);
  offered = { status: "up-to-date", channel: "stable", version: "0.10.6" };
  await listeners.get("checkMoonDogUpdate:click")();
  assert.equal(field("installMoonDogUpdate").disabled, true);
  recoverable = ["MoonDog-Update-Backup-test"];
  documentListeners.get("moondog-data")();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(field("recoverMoonDogUpdate").hidden, false);
});
