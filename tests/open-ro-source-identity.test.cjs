const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "assets", "app.js"), "utf8");
const daily = fs.readFileSync(path.join(root, "assets", "daily-ops.js"), "utf8");

assert.match(app, /advisorCode:\s*\["advisor no"/);
assert.match(app, /technician:\s*\["technician", "technician name", "tech", "tech name"/);
assert.match(app, /function sourceAdvisorIdentity\(record\)/);
assert.match(app, /function sourceTechnicianIdentity\(record\)/);
assert.match(app, /function reconcileOpenRoSourceIdentities\(\)/);
assert.match(app, /currentOpenRo\?\.records/);
assert.match(app, /owner:\s*raw\.advisor\|\|""/);
assert.match(daily, /<b>Written by:<\/b>/);
assert.match(daily, /<b>Source technician:<\/b>/);
assert.match(daily, /Follow-up owner/);

console.log("PASS Open RO source advisor and technician identities are surfaced");
