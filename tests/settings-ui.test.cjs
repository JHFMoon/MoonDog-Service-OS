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
  const host = { append: value => assert.equal(value, card) };
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
  assert.equal(card.innerHTML.includes("selectUpdateApp"), false);
  assert.match(field("updateFolders").textContent, /Connected application folder: Test-App/);
  await listeners.get("checkMoonDogUpdate:click")();
  assert.equal(checks.at(-1).currentVersion, "0.10.7-beta.1");
  assert.equal(checks.at(-1).channel, "beta");
});
