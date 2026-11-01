"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const first = "Object.entries(ADVISOR_NAMES).forEach(([code, name]) => { const entity = latest.advisors?.[code]";
const start = app.indexOf(first);
const ending = "advisors.append(card); }); }";
const end = app.indexOf(ending, start);
assert.ok(start >= 0 && end > start, "production unified Meeting advisor renderer must exist");
const renderer = app.slice(start, end + "advisors.append(card); });".length);

test("configurable Meeting advisor identity is literal text with and without verified SAPR", () => {
  const name = '<img src=x onerror="synthetic-name"> & Friendly Advisor';
  const code = '104</span><img src=x onerror="synthetic-code">';
  for (const hasSapr of [false, true]) {
    const nodes = {};
    const cards = [];
    const document = {
      createElement(tag) {
        assert.equal(tag, "article");
        return {
          className: "",
          set innerHTML(value) { this.markup = value; },
          get innerHTML() { return this.markup || ""; },
          querySelector(selector) {
            return nodes[selector] ||= { textContent: "" };
          }
        };
      }
    };
    const context = {
      ADVISOR_NAMES: { [code]: name },
      latest: { advisors: hasSapr ? { [code]: { totalGross: 100, cpGross: 75 } } : {} },
      surveys: {},
      npsSummary: () => ({ responses: 0, nps: null }),
      document,
      advisors: { append(card) { cards.push(card); } },
      performancePlan: () => ({}),
      configuredNumber: () => null,
      meetingSetting: () => null,
      advisorMeetingWins: () => [],
      advisorNextWin: () => ({ label: "THIS WEEK", value: "FOLLOW THROUGH" }),
      performanceFormat: () => "$100"
    };
    vm.runInNewContext(renderer, context);
    assert.equal(cards.length, 1);
    assert.match(cards[0].markup, /<header><strong><\/strong><span><\/span><\/header>/);
    assert.ok(!cards[0].markup.includes(name), "editable advisor name must not enter HTML markup");
    assert.ok(!cards[0].markup.includes(code), "editable advisor code must not enter HTML markup");
    assert.equal(nodes["header strong"].textContent, name);
    assert.equal(nodes["header span"].textContent, "ADVISOR " + code);
    assert.match(cards[0].markup, hasSapr ? /advisor-scoreline/ : /SAPR detail is unavailable/);
  }
});


test("active and retained Meeting V3 advisor cards render configured identity through textContent", () => {
  const variants = [
    ["function renderMeetingV3()", "meetingRoster.forEach((advisor) => {", "advisors.append(card); });"],
    ["function renderMeetingV3Accurate()", "roster.forEach((advisor) => {", "advisorRows.push({ code, name, window, goal, csi, next }); });"]
  ];
  const name = '<img src=x onerror="synthetic-active"> & Service Advisor';
  const code = "104";
  for (const [functionMark, loopMark, endMark] of variants) {
    const functionStart = app.indexOf(functionMark);
    const nextFunction = app.indexOf("\n  function ", functionStart + functionMark.length);
    const bounded = app.slice(functionStart, nextFunction > functionStart ? nextFunction : undefined);
    const loopStart = bounded.indexOf(loopMark);
    const loopEnd = bounded.indexOf(endMark, loopStart);
    assert.ok(functionStart >= 0 && loopStart >= 0 && loopEnd > loopStart,
      "production Meeting V3 advisor loop exists: " + functionMark);
    const source = bounded.slice(loopStart, loopEnd + endMark.length);
    for (const hasSapr of [false, true]) {
      const cards = [], heading = { textContent: "" }, attached = [];
      const document = { createElement: () => ({
        className: "", dataset: {},
        classList: { toggle() {} },
        set innerHTML(value) { this.markup = value; },
        get innerHTML() { return this.markup || ""; },
        querySelector(selector) { assert.equal(selector, "h3"); return heading; }
      }) };
      const entity = { totalGross: 200, cpGross: 100 };
      const context = {
        meetingRoster: [{ number: code }], roster: [{ number: code }],
        advisorDisplayName: () => name,
        latest: { advisors: hasSapr ? { [code]: entity } : {} },
        end: "2026-10-30", surveys: {}, dealer: { responses: 0, nps: null },
        npsSummary: () => ({ responses: 0, nps: null }),
        meetingGrossWindow: () => ({ current: { total: 200, evidence: { value: 200 } }, prior: { total: 100, evidence: { value: 100 } } }),
        meetingChange: () => ({ amount: 100, percent: 100, className: "up" }),
        meetingGrossGoal: () => ({ configured: false, achieved: false, progress: 0, target: null, roundedDaily: null }),
        meetingNextWin: () => ({ achieved: false, label: "FOCUS", text: "FOLLOW THROUGH", measure: "READY", action: "UPDATE" }),
        metricEvidence: () => ({ status: "missing-source" }),
        metricEvidenceText: () => "UNVERIFIED", publicMetricState: () => "UNVERIFIED",
        performanceFormat: () => "$100", compactMoney: () => "$100", signedValue: () => "$100",
        configuredNumber: () => null, meetingSetting: () => null,
        document, advisors: { append(card) { cards.push(card); } },
        attachMeetingAdvisorTv: (...args) => { attached.push(args); },
        advisorRows: []
      };
      vm.runInNewContext(source, context);
      assert.equal(cards.length, 1, functionMark + " must display the advisor");
      assert.equal(attached.length, 1, functionMark + " presenter attachment must be preserved");
      assert.match(cards[0].markup, /<h3><\/h3>/);
      assert.ok(!cards[0].markup.includes(name), functionMark + " must not parse configured name");
      assert.equal(heading.textContent, name, functionMark + " must preserve visible name");
      assert.equal(context.advisorRows.length, functionMark.includes("Accurate") && hasSapr ? 1 : 0);
    }
  }
});
