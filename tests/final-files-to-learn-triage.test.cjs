const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
new vm.Script(app);

for (const token of [
  "cdk-repair-orders-docx-v2-split-fields",
  "parts-quality-alert-v1",
  "service-consulting-audit-v1",
  "customer-outreach-transcript-v1",
  "technician-video-standard-v1",
  "known-non-service",
  "non-service-source-retired"
]) assert.ok(app.includes(token), `missing ${token}`);

assert.ok(app.includes("parseCdkRepairOrdersDocx"));
assert.ok(app.includes("activeRecords.length!==expectedOpen"));
assert.ok(app.includes("closedExcluded:true"));
assert.ok(app.includes('family==="service-consulting-audit"?20:4'));
assert.ok(app.includes("supplementalManagerAttention"));
assert.ok(app.includes("PARTS QUALITY ALERT"));
assert.ok(app.includes("OUTREACH FOLLOW-UP"));
assert.ok(app.includes("SERVICE CONSULTING ACTION"));

const referenceOnly = app.slice(app.indexOf("function referenceOnlyDocumentType"), app.indexOf("function parsePartsQualityAlert"));
assert.ok(referenceOnly.includes("incident-claim"));
assert.ok(referenceOnly.includes("collision-estimate"));
assert.ok(!referenceOnly.includes("quality-inspection-request"));
assert.ok(!referenceOnly.includes("training-playbook"));
assert.ok(!referenceOnly.includes("customer-outreach-transcript"));

console.log("PASS final learned-source triage is syntax-valid and routes useful vs non-service files explicitly");
