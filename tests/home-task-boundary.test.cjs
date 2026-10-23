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

// Home auto-fill is read-only until the existing explicit Save and continue.
assert.match(daily,/m\.currentTechnician\|\|r\.technician\|\|r\.technicianCode\|\|''/);
assert.match(daily,/m\.owner\|\|r\.advisor\|\|r\.advisorCode\|\|''/);
assert.match(daily,/verify current assignment/);
assert.match(daily,/not a confirmed follow-up assignment/);
assert.match(daily,/missing customer updates and follow-up times are never guessed/);
