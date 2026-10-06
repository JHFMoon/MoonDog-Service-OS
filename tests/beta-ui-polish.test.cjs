const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "assets/app.js"), "utf8");
const updates = fs.readFileSync(path.join(root, "assets/moondog-update-settings.js"), "utf8");
const settingsCss = fs.readFileSync(path.join(root, "assets/product-settings.css"), "utf8");

assert.match(app, /const VERSION = "0\.10\.8-beta\.3"/);
assert.match(app, /SERVICE OPERATIONS HUB CONNECTED/);
assert.match(app, /RECONNECTING\|RESTORING\|FOLDER ACCESS REQUIRED/);
assert.match(updates, /Last update check:/);
assert.match(updates, /state\.channel === "beta" \? "Install Beta" : "Install Update"/);
assert.match(updates, /Installed \$\{installedChannel === "beta" \? "Beta" : "Stable"\} \$\{installedVersion\}; check for newer builds/);
assert.match(settingsCss, /#settings-update\{grid-column:1\/-1;max-width:760px;width:100%\}/);

console.log("PASS Beta screenshot-state polish is present");
