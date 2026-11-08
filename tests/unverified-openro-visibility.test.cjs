"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

test("unverified Open RO data never appears as a verified zero in visible dashboard guidance", () => {
  assert.match(html, /id="recordCount">Open RO source not verified<\/p>/);
  assert.match(html, /Verified tracker only · unavailable is not zero/);
  assert.match(html, /Missing or stale reports are not zero workload/);
  assert.match(html, /id="metricOpen">—<\/strong>/);
  assert.match(html, /id="assignRecommendation"[\s\S]*?No workload recommendation is available yet/);
});
