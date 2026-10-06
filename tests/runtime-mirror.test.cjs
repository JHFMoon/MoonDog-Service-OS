const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const mirrors = [
  ["updates/check.js", "assets/moondog-update-check.js"],
  ["updates/verify.js", "assets/moondog-update-verify.js"],
  ["updates/package-plan.js", "assets/moondog-update-plan.js"],
  ["updates/apply-design-model.js", "assets/moondog-update-model.js"],
  ["updates/install.js", "assets/moondog-update-install.js"]
];

for (const pair of mirrors) {
  const sourcePath = pair[0], runtimePath = pair[1];
  const source = fs.readFileSync(path.join(root, sourcePath));
  const runtime = fs.readFileSync(path.join(root, runtimePath));
  assert.deepEqual(runtime, source, runtimePath + " must mirror " + sourcePath);
  assert.ok(html.includes('<script src="' + runtimePath + '"></script>'), runtimePath + " must be loaded by index.html");
}

console.log("PASS updater runtime mirrors are complete and synchronized");
