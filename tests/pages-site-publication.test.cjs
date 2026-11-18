"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "offline-distribution.yml"), "utf8");
const between = (start, end) => {
  const first = workflow.indexOf(start), last = workflow.indexOf(end, first);
  assert.ok(first >= 0 && last > first, "Expected ordered workflow section: " + start);
  return workflow.slice(first, last);
};

test("Pages checks protected main before staging the repair site", () => {
  const early = between("- name: Check out validated main source", "- name: Resolve Stable release");
  assert.match(early, /ref: main\n\s+fetch-depth: 0/);
  assert.match(early, /- name: Re-run public safety checks/);
  assert.match(early, /node --test tests\/\*\.test\.cjs/);
  assert.match(early, /python3 scripts\/audit_git_history\.py/);
  assert.match(early, /- name: Preserve reviewed Pages files from current main/);
  assert.match(early, /cp -R distribution\/site\/\. "\$SITE_DIR\/"/);
  assert.match(early, /test -f "\$SITE_DIR\/check-installation\.html"/);
});

test("Stable package remains sourced from immutable tagged release", () => {
  const stable = between("- name: Check out immutable Stable source", "- name: Prepare GitHub Pages storefront");
  assert.match(stable, /git checkout --detach "\$TAG"/);
  assert.match(stable, /git tag --points-at HEAD/);
  assert.match(stable, /python3 scripts\/check_publication\.py/);
  assert.match(stable, /python3 scripts\/build_distribution\.py[\s\S]*--output dist\/Service-Operations-Dashboard\.zip/);
  assert.match(stable, /cmp "dist\/\$asset" "\.release-check\/\$asset"/);
});

test("GitHub Pages uses separately staged reviewed main site, not Stable-tag site", () => {
  const pages = between("- name: Prepare GitHub Pages storefront", "- name: Configure GitHub Pages");
  assert.match(pages, /cp -R "\$RUNNER_TEMP\/moondog-verified-site" \.pages/);
  assert.doesNotMatch(pages, /cp -R distribution\/site/);
  assert.match(pages, /Path\("\.pages\/latest\.json"\)/);
  assert.match(pages, /release = json\.loads\(Path\("dist\/Service-Operations-Dashboard\.manifest\.json"\)/);
  assert.match(pages, /"version": release\["version"\]/);
});

test("Stable version metadata is not promoted by site publishing change", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "updates", "manifest.json"), "utf8"));
  assert.ok(/^\d+\.\d+\.\d+$/.test(manifest.stable.version), "Stable manifest stays a formal Stable version");
  assert.doesNotMatch(workflow, /gh release create.*beta/i);
});
