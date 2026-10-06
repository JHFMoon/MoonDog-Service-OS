const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const daily = fs.readFileSync(path.join(root, "assets", "daily-ops.js"), "utf8");

assert.doesNotMatch(daily, /Prepare for this arrival/i);
assert.doesNotMatch(daily, /Confirm the visit is ready for the drive/i);
assert.doesNotMatch(daily, /type:\x27arrival\x27/);
assert.doesNotMatch(daily, /task\.type===\x27arrival\x27/);
assert.match(daily, /title:\x27Make tomorrow ready\x27/);
assert.match(daily, /unresolved\.length/);
assert.match(daily, /view:\x27open-ro\x27/);

console.log("PASS Home no longer surfaces appointment-prep tasks");
