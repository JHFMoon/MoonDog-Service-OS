const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "updates", "manifest.json"), "utf8"));
assert.equal(manifest.beta.version, "0.10.18-beta.2");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "updates", "packages", "moondog-0.10.18-beta.2.json"), "utf8"));
assert.equal(pkg.version, manifest.beta.version);
const files = Object.fromEntries(pkg.files.filter(entry => entry.action === "put").map(entry => [
  entry.path, Buffer.from(entry.contentBase64, "base64").toString("utf8")
]));

const app = files["assets/app.js"];
const daily = files["assets/daily-ops.js"];
const css = files["assets/daily-ops.css"];
const html = files["index.html"];
const engineSource = files["assets/daily-engine.js"];
const installer = files["assets/moondog-update-install.js"];
const styles = files["assets/styles.css"];

assert.match(app, /const VERSION = "0\.10\.18-beta\.1"/);
assert.ok(!app.includes("Monday · your day off"));
assert.ok(app.includes("Sunday · no manager review"));
assert.ok(app.includes('attention === "long-2"'));
assert.ok(app.includes('attention === "long-5"'));
assert.ok(app.includes('attention === "needs-update"'));
assert.ok(app.includes('attention === "comeback"'));
assert.ok(app.includes('setAttribute("aria-current","page")'));
assert.ok(app.includes("ui.metricOpen.textContent = active.length"));
assert.ok(app.includes("You have unsaved RO changes"));
assert.ok(!app.includes("Read-only write authority guard is unavailable."));
assert.ok(app.includes("Workspace write guard is unavailable."));

assert.ok(daily.includes("CONTROL PULSE"));
assert.ok(daily.includes("Finish work before starting more"));
assert.ok(daily.includes("You have an unsaved Home update"));
assert.ok(daily.includes("['home','open-ro','assign-next','performance','meeting','tools']"));
for (const label of ["Overdue","Due today","Missing plan","2+ days","5+ days","Customer update","Comebacks"]) {
  assert.ok(daily.includes(label), label);
}
assert.ok(css.includes(".manager-control-pulse-grid"));
assert.ok(styles.includes(":focus-visible"));
assert.ok(styles.includes("prefers-reduced-motion"));
assert.ok(html.includes('<option value="long-2">Open 2+ days</option>'));
assert.ok(html.includes('<option value="long-5">Open 5+ days</option>'));
assert.ok(html.includes('<option value="needs-update">Customer update needed</option>'));
assert.ok(html.includes('<option value="comeback">Comebacks</option>'));
assert.ok(html.includes("Configured ROs per advisor"));

assert.ok(!installer.includes("Editing authority is required before installing an update."));
assert.ok(!installer.includes("Editing authority is required before recovering an update."));
assert.ok(installer.includes("explicit browser folder permission"));

const context = vm.createContext({ globalThis: {}, Intl, Date });
context.globalThis = context;
vm.runInContext(engineSource, context);
const engine = context.MoonDogDailyEngine;
const api = { closed: () => false, priority: () => 5, status: record => record.management.status || "" };
function task(record) {
  return engine.roTask({
    id: record.id, advisorCode: "1", daysOpen: record.daysOpen || 0, sourceStatus: "",
    management: { status: record.status || "", communication: record.communication || "Current",
      nextAction: "Do next thing", reviewDate: "2099-01-01", updatedAt: "2026-10-07T17:00:00Z" }
  }, api, "2026-10-07", Date.parse("2026-10-07T17:00:00Z"));
}
assert.ok(task({id:"customer",communication:"Needs update"}).rank < task({id:"waiter",status:"waiter"}).rank);
assert.ok(task({id:"comeback",status:"comeback"}).rank < task({id:"waiter",status:"waiter"}).rank);

console.log("PASS Beta 0.10.18 operational-control package is self-contained and audited");
