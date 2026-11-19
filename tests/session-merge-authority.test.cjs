"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = path => fs.readFileSync(path, "utf8");
const contract = read(path.join(root, "docs/RELEASE-AUTHORIZATION.md"));
const guard = read(path.join(root, ".github/workflows/guarded-pr-merge.yml"));
const risk = read(path.join(root, "scripts/beta_change_risk.py"));
const pipeline = read(path.join(root, "scripts/pipeline_guard.py"));
const site = read(path.join(root, ".github/workflows/repair-center-pages.yml"));

test("single-session path avoids mandatory GitHub owner-review ritual only after bootstrap", () => {
  assert.match(contract, /specific protected scope in the active ChatGPT conversation/);
  assert.match(contract, /no separate GitHub owner-review submission is required/);
  assert.match(contract, /formal exact-head owner-attested GitHub PR review is \*\*optional after this bootstrap\*\*/);
  assert.match(contract, /This change to the release contract itself must still follow the prior policy/);
  assert.match(contract, /cannot approve or merge itself/);
});

test("protected automation cannot automatically merge its own controls", () => {
  assert.match(risk, /if path\.startswith\("\.github\/"\)/);
  assert.match(risk, /return "protected"/);
  assert.match(guard, /if \[ "\$DECISION" = "protected" \]; then/);
  assert.match(guard, /Protected change requires the manual merge route/);
  assert.match(guard, /if \[ "\$FINAL_DECISION" = "protected" \]; then/);
  assert.match(pipeline, /Automatic merge refuses trusted automation\/proof changes/);
});

test("no ChatGPT authorization can waive security checks or Stable approval", () => {
  assert.match(contract, /Stop on failed privacy\/integrity checks/);
  assert.match(contract, /A Stable promotion PR requires separate owner authorization/);
  assert.match(contract, /real-store operations approval boundaries/);
  assert.match(guard, /Publication Check/);
  assert.match(guard, /Clean Install Proof/);
  assert.match(site, /Public Repository History Safety Audit/);
  assert.match(site, /python3 scripts\/verify_repair_center_gate\.py/);
  assert.match(site, /Deploy GitHub Pages/);
});
