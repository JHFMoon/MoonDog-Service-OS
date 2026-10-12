"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "assets/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/meeting-presenter.css"), "utf8");
const runtime = fs.readFileSync(path.join(root, "assets/meeting.css"), "utf8");
const begin = app.indexOf("  function meetingTvMetric(");
const end = app.indexOf("  function renderMeetingV3()", begin);
assert.ok(begin > 0 && end > begin, "TV renderer must sit next to the actual meeting source");
const functions = app.slice(begin, end);

function renderScenario({current = true, week = false, responses = 0, value = 94} = {}) {
  const context = {
    Number, Math, Intl,
    sourceFreshness: key => ({verified: current, safeForCurrent: current}),
    virMeetingEvidence: () => ({verified: current}),
    menuMeetingEvidence: () => ({verified: current}),
    csiMetricEvidence: () => ({verified: current && responses > 0}),
    latestOperationalSnapshot: key => ({advisors: {"test": key === "vir" ? {utilization:value} : {presentation:81, penetration:43}}}),
    standard: key => {
      const metrics = ["cpElr","cpHoursPerRo","mediaViewed","texting","vir","menuPresentation","menuPenetration","dealerNps"];
      const testValues = [230,2.1,86,98,92,78,42,95];
      return testValues[metrics.indexOf(key)];
    },
    performanceFormat: (n, kind) => kind === "money" ? "$" + Math.round(n).toLocaleString("en-US") : "" + Math.round(n),
    compactMoney: n => "$" + (n / 1000).toFixed(1) + "K",
    shortDate: () => "Oct 11",
    meetingChange: (a,b) => ({amount:a-b,percent: (a-b)/b*100}),
    signedValue: n => n >= 0 ? "+" + n : "" + n
  };
  const renderer = vm.runInNewContext(functions + "\nmeetingAdvisorTv;", context);
  const fields = ["totalGross","cpElr","cpHours","mediaViewed","texting"];
  const observations = [21300,215,1.9,91,100];
  const entity = Object.fromEntries(fields.map((field,index)=>[field,observations[index]]));
  return renderer("test",
    {periodEnd:"2026-10-11", validation:{saprDaysVerified:true,finalTotalsVerified:true}, saprDaysCompleted:7, saprTotalDays:23, advisors:{test:{}}},
    entity,
    {configured:true, target:Math.round(67000 + 1000), achieved:false, roundedDaily:3100, remainingDays:15},
    {current:{total:week ? 10200 : null}, prior:{total:week ? 8900 : null}},
    {label:"BRAKES", measure:"Need 1 more sale", action:"BY NEXT MEETING", achieved:false},
    {responses,nps:responses ? 100 : null});
}

test("30-second TV card displays pace, eight metrics, one action and verified week state", () => {
  const html = renderScenario({current:true,week:true,responses:2});
  assert.match(html, /MONTH-TO-DATE GROSS/);
  assert.match(html, /\$21\.3K/);
  assert.ok(html.includes((68000/1000).toFixed(1)+"K goal"));
  assert.match(html, /\$3,100/);
  assert.match(html, /\$10\.2K/);
  assert.match(html, /<div class="tv-metrics" data-metric-count="8">/);
  assert.equal((html.match(/class="tv-metric /g)||[]).length,8);
  assert.match(html, /PERFORMANCE TELEMETRY/);
  assert.match(html, /RUN RATE/);
  for(const label of ["CP ELR","CP HRS / RO","MEDIA VIEWED","TEXTING","VIR","MENU SHOWN","MENU SOLD","CSI NPS"])assert.ok(html.includes(label),label);
  assert.match(html, /Need 1 more sale/);
  assert.match(html, /BY NEXT MEETING/);
  assert.match(html, /2 responses/);
});

test("missing weekly data stays small; no surveys are not scored as NPS zero",()=>{
  const html=renderScenario({current:true,week:false,responses:0});
  assert.match(html, /<strong class="pending">PENDING<\/strong>/);
  assert.match(html, /Verified daily history incomplete/);
  assert.match(html, /0 RESPONSES/);
  assert.doesNotMatch(html, /<span>CSI NPS<\/span>/);
  assert.match(html, /0 RESPONSES/);
});

test("stale dependent sources never become falsely verified advisor metrics",()=>{
  const html=renderScenario({current:false,week:false,responses:2});
  assert.match(html, /SAPR through Oct 11/);
  assert.match(html, /CSI NOT CURRENT/);
  assert.ok(!html.includes("94%"),"stale VIR value must be withheld");
  assert.ok(!html.includes("81%"),"stale menu value must be withheld");
  assert.ok(html.includes("$215"),"dated, verified SAPR values remain visible when currentness expires");
  assert.match(html, /Verified through Oct 11/);
});

test("TV-only markup does not replace compact overview and CSS runtime matches source",()=>{
  assert.match(app, /card\.insertAdjacentHTML\("beforeend", meetingAdvisorTv\(/);
  assert.match(css, /\.meeting-v3-advisor>\.advisor-tv\{display:none\}/);
  assert.match(css, /repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.tv-focus/);
  assert.match(css, /data-presenter-orientation="portrait"/);
  const start = "/* BEGIN GENERATED MEETING LAYOUT (see src/meeting-presenter.css) */";
  const finish = "/* END GENERATED MEETING LAYOUT */";
  assert.equal(runtime.split(start)[1].split(finish)[0].trim(),css.trim());
});

test("live Advisor Meeting renderer mounts the TV scorecard for both loaded and pending advisors",()=>{
  const start = app.indexOf("function renderMeetingV3Accurate()");
  const end = app.indexOf("function decorateMeetingCycle", start);
  assert.ok(start >= 0 && end > start);
  const live = app.slice(start,end);
  const mount = "attachMeetingAdvisorTv(card, code, latest,";
  assert.equal(live.split(mount).length - 1, 2, "Both current-data and missing-data paths must mount");
  assert.match(live, /attachMeetingAdvisorTv\(card, code, latest, null, null, window, null, csi\); advisors\.append\(card\); return;/);
  assert.match(live, /attachMeetingAdvisorTv\(card, code, latest, entity, goal, window, next, csi\); advisors\.append\(card\); advisorRows\.push/);
  assert.match(app, /renderMeeting = function renderMeetingWithCycle\(\) \{ renderMeetingV3Accurate\(\)/);
});
test("scorecard mounting fails safely without hiding the prior advisor content",()=>{
  const start=app.indexOf("function attachMeetingAdvisorTv(");
  const end=app.indexOf("function renderMeetingV3()",start);
  assert.ok(start>=0 && end>start);
  const source=app.slice(start,end);
  const classes=[];
  let markup="";
  const card={
    insertAdjacentHTML: (_where,text)=>{markup=text;},
    querySelector: selector=> selector===":scope > .advisor-tv" ? {} : null,
    classList: {add:value=>classes.push(value)}
  };
  const setup=vm.runInNewContext(
    "const meetingAdvisorTv=()=>'<section class=\"advisor-tv\"></section>';\n"+source+"\nattachMeetingAdvisorTv;",{console});
  setup(card,"sample",null,null,null,null,null,{responses:0});
  assert.ok(markup.includes('advisor-tv'));
  assert.deepEqual(classes,["tv-ready"]);
  const bad=vm.runInNewContext(
    "const meetingAdvisorTv=()=>{throw new Error('synthetic render failure')};\n"+source+"\nattachMeetingAdvisorTv;",
    {console:{warn(){}}});
  const original={insertAdjacentHTML(){throw new Error("unexpected insertion")},querySelector(){return null},classList:{add(){throw new Error("original content should remain")}}};
  bad(original,"sample",null,null,null,null,null,{responses:0});
});
test("TV-only CSS never hides the original card unless a new scorecard actually mounted",()=>{
  assert.match(css,/\.meeting-v3-advisor>\.advisor-tv\{display:none\}/);
  assert.match(css,/\.meeting-v3-advisor\[data-slide-active="true"\]\.tv-ready>:not\(h3\):not\(\.advisor-tv\)\{display:none!important\}/);
  assert.doesNotMatch(css, /\.meeting-v3-advisor\[data-slide-active="true"\]>:not\(h3\):not\(\.advisor-tv\)\{display:none!important\}/);
});

test("Overdrive Store fallback displays dated month-to-date only when a strict week is not verified",()=>{
  const start=app.indexOf("function renderMeetingV3Accurate()");
  const end=app.indexOf("function decorateMeetingCycle",start);
  const live=app.slice(start,end);
  assert.match(live,/renderOverdriveStoreGross\(view, latest, grossWindow\)/);
  assert.match(app,/classList\.toggle\("overdrive-partial", !weeklyReady\)/);
  assert.match(app,/7-DAY TOTAL WITHHELD/);
  assert.match(live,/view\.classList\.toggle\("overdrive-has-voice", Boolean\(voice\.quote\)\)/);
  assert.doesNotMatch(live,/grossWindow\.current\.points\.reduce\([^)]*sum/);
});
test("Overdrive responsive source/runtime design parity remains exact",()=>{
  assert.match(css,/PROJECT OVERDRIVE \/ PIT WALL/);
  assert.match(css,/\.tv-metrics\[data-metric-count="3"\]/);
  assert.match(css,/\.overdrive-store-mtd/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  const start="/* BEGIN GENERATED MEETING LAYOUT (see src/meeting-presenter.css) */";
  const end="/* END GENERATED MEETING LAYOUT */";
  assert.equal(runtime.split(start)[1].split(end)[0].trim(),css.trim());
});