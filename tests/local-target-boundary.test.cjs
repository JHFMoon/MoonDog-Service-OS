const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "assets", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "updates", "manifest.json"), "utf8"));

const numericLocalTarget = /\b(?:grossMinimum|grossStretch|storeGrossTarget|dealerNps|vir|menuPresentation|menuPenetration|mediaViewed|texting|cpElr|cpHoursPerRo)\s*:\s*-?(?:\d|\.\d)/;
const publicGoalText = /(?:(?:\bgoal\b|\btarget\b|\bminimum\b|\bstretch\b)[^\r\n]{0,28}(?:\$\s*\d|\b\d+(?:\.\d+)?%)|(?:\$\s*\d|\b\d+(?:\.\d+)?%)[^\r\n]{0,28}(?:\bgoal\b|\btarget\b|\bminimum\b|\bstretch\b))/i;

assert.doesNotMatch(app, numericLocalTarget);
assert.doesNotMatch(app, publicGoalText);
assert.match(app, /performanceStandards:\s*\{\s*vir:\s*null/);
assert.match(app, /grossMinimum:\s*null,\s*grossStretch:\s*null/);
assert.match(html, /Local Performance Targets/);
assert.match(html, /Private to this Service Operations Dashboard copy/);

for (const channel of ["stable", "beta"]) {
  const release = manifest[channel];
  const packagePath = path.join(root, "updates", "packages", `moondog-${release.version}.json`);
  const update = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  for (const file of update.files) {
    const content = Buffer.from(file.contentBase64, "base64").toString("utf8");
    assert.doesNotMatch(content, numericLocalTarget, `${channel} package leaked a local target literal in ${file.path}`);
    assert.doesNotMatch(content, publicGoalText, `${channel} package leaked public goal text in ${file.path}`);
  }
}

console.log("PASS performance targets remain protected local configuration");
