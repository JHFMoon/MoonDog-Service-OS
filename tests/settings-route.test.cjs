const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("registered System Updates route reveals its card and hides unrelated settings", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "assets", "daily-ops.js"), "utf8");
  const registration = source.slice(source.indexOf("  const settingsFeatures="), source.indexOf("  const esc="));
  const routing = source.slice(source.indexOf("  function settingsCategory("), source.indexOf("  function goTools("));
  assert.ok(registration.startsWith("  const settingsFeatures="));
  assert.ok(routing.startsWith("  function settingsCategory("));
  const card = { classList: { hidden: false, toggle(name, hidden) {
    if (name === "daily-settings-hidden") this.hidden = hidden;
  } } };
  const unrelated = { classList: { hidden: false, toggle(name, hidden) {
    if (name === "daily-settings-hidden") this.hidden = hidden;
  } } };
  let navigated = "", scrolled = false;
  const target = { closest: () => card, scrollIntoView: () => { scrolled = true; } };
  const host = { contains: element => element === target,
    querySelectorAll: selector => selector === ".card" ? [card, unrelated] : [], prepend() {} };
  const fields = { "view-settings": host, "settings-update": target };
  const context = vm.createContext({ Object, Set, $: id => fields[id],
    go: view => { navigated = view; }, button: () => ({ classList: { add() {} } }),
    goTools() {}, say() {} });
  vm.runInContext(registration + routing + "this.route=settingsCategory;this.features=settingsFeatures;", context);
  assert.ok(context.features.some(feature => feature.key === "updates" &&
    feature.label === "System Updates" && feature.targets.includes("settings-update")));
  context.route("updates");
  assert.equal(navigated, "settings");
  assert.equal(card.classList.hidden, false);
  assert.equal(unrelated.classList.hidden, true);
  assert.equal(scrolled, true);
});
