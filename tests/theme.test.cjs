const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "..", "assets", "daily-ops.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "assets", "daily-ops.css"), "utf8");
const match = script.match(/function installThemeToggle\(\)\{[\s\S]*?\n  \}/);

test("theme changes immediately, defaults to Light, and persists only in browser storage", () => {
  assert.ok(match);
  for (const remembered of [null, "dark"]) {
    const saved = [], handlers = new Map(), html = { dataset: {} }, meta = { value: null,
      setAttribute: (_, value) => { meta.value = value; } };
    const control = { setAttribute() {}, addEventListener: (name, handler) => handlers.set(name, handler) };
    const actions = { append: value => assert.equal(value, control) };
    const context = vm.createContext({ document: { documentElement: html,
      createElement: () => control, querySelector: selector => selector === ".top-actions" ? actions : meta },
      localStorage: { getItem: () => remembered, setItem: (key, value) => saved.push([key, value]) } });
    vm.runInContext(`(${match[0]})()`, context);
    assert.equal(html.dataset.theme, remembered || "light");
    assert.equal(meta.value, remembered || "light");
    assert.match(control.textContent, remembered ? /Light mode/ : /Dark mode/);
    handlers.get("click")();
    assert.equal(html.dataset.theme, remembered ? "light" : "dark");
    assert.deepEqual(saved, [["service-operations-hub-theme-v1", remembered ? "light" : "dark"]]);
  }
});

test("dark palette covers key controls and print returns to white", () => {
  for (const selector of [".theme-toggle", "input,select,textarea", "table,thead,tbody,tr,th,td",
    "button.primary", ".status.error", "[role=\"dialog\"]", "button,.nav-item"])
    assert.ok(css.includes(selector), selector);
  assert.match(css, /@media print\{[\s\S]*background:#fff!important/);
  const luminance = hex => {
    const values = hex.match(/\w\w/g).map(part => parseInt(part, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
  };
  const light = luminance("e8f1f7"), dark = luminance("0c1520");
  assert.ok((light + 0.05) / (dark + 0.05) >= 7);
});
