const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "assets/app.js"), "utf8");
const updates = fs.readFileSync(path.join(root, "assets/moondog-update-settings.js"), "utf8");
const settingsCss = fs.readFileSync(path.join(root, "assets/product-settings.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "updates/manifest.json"), "utf8"));

assert.ok(app.includes(`const VERSION = "${manifest.stable.version}"`));
assert.match(app, /SERVICE OPERATIONS DASHBOARD CONNECTED/);
assert.match(app, /RECONNECTING\|RESTORING\|FOLDER ACCESS REQUIRED/);
assert.match(updates, /Last update check:/);
// The Update UI explicitly names the data-preserving option, and the
// destructive choice remains unclickable until isolation proof is complete.
assert.match(updates, /Update Current Installation/);
assert.match(updates, /Update to Fresh Installation/);
assert.match(updates, /Selected installation folder \(parent of System Files\)/);
assert.match(app, /model\.applicationRoot = handle;/);
assert.match(updates, /freshButton\.disabled = true/);
assert.doesNotMatch(updates, /freshButton\.addEventListener\(/);
assert.match(updates, /Installed \$\{installedChannel === "beta" \? "Beta" : "Stable"\} \$\{installedVersion\}; check for newer builds/);
assert.match(settingsCss, /#settings-update\{grid-column:1\/-1;max-width:760px;width:100%\}/);

console.log("PASS current screenshot-state polish is present");
