"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/repair-center-pages.yml"), "utf8");
const publisher = fs.readFileSync(path.join(root, ".github/workflows/offline-distribution.yml"), "utf8");
const smoke = fs.readFileSync(path.join(root, "scripts/smoke_repair_center.mjs"), "utf8");

test("site-only workflow responds to main push security completion and optional manual dispatch", () => {
  assert.match(workflow, /workflow_run:\s*\n\s*workflows:\s*\n\s*- Public Repository History Safety Audit/);
  assert.match(workflow, /types: \[completed\]/);
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /python3 scripts\/verify_repair_center_gate\.py/);
});

test("site-only publication remains scoped to validated main, not unreviewed branches", () => {
  assert.match(workflow, /github\.event\.workflow_run\.head_sha \|\| github\.sha/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /git\/ref\/heads\/main/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /git push|gh release (upload|create)|installMoonDogUpdate/);
});

test("site deployments share original distribution lock and preserve Stable", () => {
  assert.match(workflow, /group: offline-distribution/);
  assert.match(publisher, /group: offline-distribution/);
  assert.match(workflow, /gh release view "\$TAG"/);
  assert.match(workflow, /gh release download "\$TAG"/);
  assert.match(workflow, /Service-Operations-Dashboard\.manifest\.json/);
  assert.match(workflow, /site-version\.json/);
  assert.doesNotMatch(workflow, /build_distribution\.py[\s\S]*--output/);
  assert.doesNotMatch(workflow, /git checkout --detach|stable-release\.yml|gh release upload/);
});

test("automated browser proof runs before and after Pages deployment, never with real Workspace files", () => {
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(workflow, /node scripts\/smoke_repair_center\.mjs --local \.pages/);
  assert.match(workflow, /node scripts\/smoke_repair_center\.mjs --live/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /needs: \[build-and-check, deploy\]/);
  assert.match(smoke, /showDirectoryPicker/);
  assert.match(smoke, /missing-journal/);
  assert.match(smoke, /missing-workspace/);
  assert.match(smoke, /unreadable/);
  assert.match(smoke, /No files were changed or uploaded/);
  assert.doesNotMatch(smoke, /writeFileSync|createWritable|requestPermission/);
});

test("site-only verifier has no branch or Stable promotion side effects", () => {
  assert.doesNotMatch(workflow, /git checkout\s+main|git reset\s+--hard|stable-release\.yml/);
  assert.doesNotMatch(workflow, /force: true|--force|gh api -X POST/);
  assert.match(workflow, /npx playwright install --with-deps chromium/);
});
