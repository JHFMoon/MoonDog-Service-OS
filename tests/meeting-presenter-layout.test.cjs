"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/meeting-presenter.css"), "utf8");
const runtime = fs.readFileSync(path.join(root, "assets/meeting.css"), "utf8");
const active = "#view-meeting.meeting-scoreboard.presentation-active";

function rule(selector) {
  const start = source.indexOf(selector + "{");
  assert.notEqual(start, -1, "Missing CSS rule: " + selector);
  const left = start + selector.length + 1;
  const right = source.indexOf("}", left);
  assert.notEqual(right, -1);
  return source.slice(left, right);
}

test("TV advisor cards use six explicit, nonoverlapping tracks", () => {
  const card = rule(active + ' .meeting-v3-advisor[data-slide-active="true"]');
  assert.match(card, /grid-template-rows:minmax\(0,1\.05fr\).*minmax\(14px,\.2fr\)/);

  const expected = [
    ["h3", "1/-1", "1"],
    [".advisor-period-label", "1", "2"],
    [".advisor-week-gross", "1", "3"],
    [".advisor-week-change", "1", "4"],
    [".exact-gross", "1", "5"],
    [".active-gross-bar", "1", "6"],
    [".advisor-daily-need", "2", "2 / span 2"],
    [".advisor-survey", "2", "4"],
    [".next-win", "2", "5 / span 2"],
  ];
  for (const [selector, column, row] of expected) {
    const css = rule(".presentation-active .meeting-v3-advisor " + selector);
    assert.ok(css.includes("grid-column:" + column + ";"), selector + " column");
    assert.ok(css.includes("grid-row:" + row + ";"), selector + " row");
  }
  const gross = rule(".presentation-active .meeting-v3-advisor .advisor-week-gross");
  assert.match(gross, /max-width:100%/);
  assert.match(gross, /font-size:clamp\(32px,4\.1cqw,72px\)/);
  assert.match(gross, /white-space:normal!important/);
  assert.match(gross, /overflow-wrap:anywhere/);
});

test("generated CSS mirrors presenter source and fullscreen selector stays valid", () => {
  const start = "/* BEGIN GENERATED MEETING LAYOUT (see src/meeting-presenter.css) */";
  const end = "/* END GENERATED MEETING LAYOUT */";
  assert.equal(runtime.split(start).length, 2);
  assert.equal(runtime.split(end).length, 2);
  assert.equal(runtime.split(start)[1].split(end)[0].trim(), source.trim());
  assert.doesNotMatch(source, /\\nbody\.meeting-fullscreen/);
  assert.match(source, /\nbody\.meeting-fullscreen/);
  assert.match(source, /grid-template-rows:repeat\(9,auto\)!important/);
});
