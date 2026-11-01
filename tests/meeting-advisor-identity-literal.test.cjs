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
