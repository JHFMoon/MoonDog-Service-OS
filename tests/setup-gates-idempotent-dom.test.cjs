"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");

const source = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = source.indexOf("  function renderSetupGates(){");
const end = source.indexOf("  const BACKUP_FILES=", start);
assert.ok(start >= 0 && end > start, "Actual production Setup gate function is present");
const production = source.slice(start, end);
const optimized = 'if(banner){const hidden=!message,html=message?`<strong>UPDATE REQUIRED</strong><span>${message}</span>`:"";if(banner.hidden!==hidden)banner.hidden=hidden;if(banner.innerHTML!==html)banner.innerHTML=html;}';
const prior = 'if(banner){banner.hidden=!message;banner.innerHTML=message?`<strong>UPDATE REQUIRED</strong><span>${message}</span>`:"";}';
assert.equal(production.split(optimized).length - 1, 1, "Must execute exactly one shipped optimized DOM site");
const beforeProduction = production.replace(optimized, prior);

function makeBanner() {
  let html = "";
  return {
    className: "", hidden: false, writes: 0,
    get innerHTML() { return html; },
    set innerHTML(next) { this.writes++; html = next; }
  };
}
function makeSection() {
  return {
    banner: null,
    querySelector(selector) {
      assert.equal(selector, ":scope > .setup-required-banner");
      return this.banner;
    },
    prepend(banner) { assert.equal(this.banner, null); this.banner = banner; }
  };
}
function harness(usePrevious = false, initial = {}) {
  const flags = {sapr:false, appointments:false, openRo:false, workload:false, ...initial};
  const sections = {};
  const ui = {};
  for(const view of ["home","performance","meeting","arrivals","assign-next","open-ro"]) {
    sections[view] = makeSection();
    ui["view-" + view] = sections[view];
  }
  const context = vm.createContext({
    ui, document: {createElement: () => makeBanner()},
    sourceFreshness: family => ({safeForCurrent: !!flags[family]}),
    activeWorkloadSnapshot: () => flags.workload ? {sourceType:"open-ro"} : null
  });
  vm.runInContext((usePrevious ? beforeProduction : production) +
    "\nthis.renderGates=renderSetupGates;", context);
  return {flags, sections, render: context.renderGates};
}
function snapshot(h) {
  return Object.fromEntries(Object.entries(h.sections).map(([key, section]) => [
    key, section.banner ? {
      hidden: section.banner.hidden,
      html: section.banner.innerHTML,
      className: section.banner.className
    } : null
  ]));
}
function writeCount(h) {
  return Object.values(h.sections).reduce((n, section) => n+(section.banner?.writes || 0), 0);
}
function percentile(values, q) {
  const sorted = [...values].sort((a,b) => a-b);
  return Number(sorted[Math.ceil(sorted.length*q)-1].toFixed(4));
}

test("current production banners remain unchanged across repeated identical Home refreshes", () => {
  const h = harness();
  h.render();
  assert.equal(Object.values(h.sections).filter(s => s.banner).length, 5);
  const expected = snapshot(h), writes = writeCount(h);
  for(let i=0;i<25;i++) h.render();
  assert.deepEqual(snapshot(h), expected, "Same gate state and operational guidance");
  assert.equal(writeCount(h), writes, "No duplicate HTML writes on unchanged source state");
  assert.equal(h.sections.home.banner, null, "No artificial Home gate");
});

test("real source-confidence transitions hide, clear and restore banners immediately", () => {
  const h = harness();
  h.render();
  h.flags.sapr = true; h.flags.appointments = true;
  h.flags.openRo = true; h.flags.workload = true;
  h.render();
  for(const view of ["performance","meeting","arrivals","assign-next","open-ro"]) {
    const banner = h.sections[view].banner;
    assert.equal(banner.hidden, true, view + " gate must clear");
    assert.equal(banner.innerHTML, "");
  }
  const clearedWrites = writeCount(h);
  h.render();
  assert.equal(writeCount(h), clearedWrites);
  h.flags.sapr = false; h.flags.openRo = false;
  h.render();
  for(const view of ["performance","meeting","open-ro"]) {
    assert.equal(h.sections[view].banner.hidden, false, view + " gate must return");
    assert.match(h.sections[view].banner.innerHTML, /UPDATE REQUIRED/);
  }
  for(const view of ["arrivals","assign-next"])
    assert.equal(h.sections[view].banner.hidden, true, view + " must remain cleared");
});

test("already-verified sources do not create empty banners", () => {
  const h = harness(false, {sapr:true,appointments:true,openRo:true,workload:true});
  h.render(); h.render();
  assert.ok(Object.values(h.sections).every(s => !s.banner));
  assert.equal(writeCount(h), 0);
});

test("paired synthetic DOM churn probe preserves output and reports p50/p95", () => {
  const previous = harness(true), current = harness(false);
  previous.render(); current.render();
  const before = [], after = [], runsPerSample=100;
  for(let i=0;i<24;i++) {
    const sample = (h, results) => {
      const started = performance.now();
      for(let j=0;j<runsPerSample;j++) h.render();
      results.push((performance.now()-started)/runsPerSample);
    };
    if(i%2===0){sample(previous,before);sample(current,after);}
    else{sample(current,after);sample(previous,before);}
  }
  assert.deepEqual(snapshot(current), snapshot(previous), "No visible status changes");
  assert.equal(writeCount(current), 5, "One initial HTML write per required banner");
  assert.equal(writeCount(previous), 5+24*runsPerSample*5, "Historical code rewrote every banner");
  console.log("58-setup-gates-synthetic-dom-probe " + JSON.stringify({
    fixture:"Five synthetic guidance banners; 24 paired runs of 100 refreshes in Node VM (not browser/OneDrive)",
    before:{p50ms:percentile(before,.5),p95ms:percentile(before,.95)},
    after:{p50ms:percentile(after,.5),p95ms:percentile(after,.95)},
    oldHtmlWrites:writeCount(previous),newHtmlWrites:writeCount(current)
  }));
});
