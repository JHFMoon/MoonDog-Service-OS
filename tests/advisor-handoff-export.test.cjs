const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");

function selectionModel() {
  const start = app.indexOf("  function selectableHandoffAdvisors() {");
  const end = app.indexOf("  const selectedHandoffCodes = new Set();", start);
  assert.ok(start >= 0 && end > start, "handoff advisor selection must be present");
  const context = {
    model: {
      settings: { advisors: {
        "101": { number: "101", name: "Vacation Advisor", active: false, removed: false },
        "102": { number: "102", name: "Active Advisor", active: true, removed: false },
        "103": { number: "103", name: "Removed Advisor", active: true, removed: true }
      } },
      state: { records: [
        { advisorCode: "101", advisor: "Vacation Advisor" },
        { advisorCode: "104", advisor: "Unconfigured Advisor" }
      ] }
    },
    text: (value) => String(value ?? ""),
    validAdvisorIdentity: (code, name) => Boolean(code && name),
    handoffAdvisorName: (code) => ({
      "101": "Vacation Advisor",
      "102": "Active Advisor"
    }[code] || code)
  };
  vm.runInNewContext(app.slice(start, end) + "\nthis.select = selectableHandoffAdvisors;", context);
  return context.select;
}

test("handoff picker includes absent and unconfigured advisors who own open work", () => {
  const codes = selectionModel()().map((advisor) => advisor.code);
  assert.deepEqual([...codes].sort(), ["101", "102", "104"]);
});

test("handoff advisor selection adapts beyond seven without changing settings", () => {
  const select = selectionModel();
  const fixture = app.slice(app.indexOf("  function selectableHandoffAdvisors() {"), app.indexOf("  const selectedHandoffCodes = new Set();"));
  assert.doesNotMatch(fixture, /\.slice\(0,\s*7\)|max\s*[:=]\s*7/);
  assert.equal(typeof select, "function");
});

test("subset export validates exactly selected advisors and preserves normal round-trip", () => {
  assert.match(app, /async function validateWorkbookBytes\(bytes, codes = supervisorAdvisorCodes\(\)\)/);
  assert.match(app, /const expectedSheets = codes\.map\(/);
  assert.match(app, /supervisorWorkbookRecords\(codes\)\.length/);
  assert.match(app, /async function workbookBytes\(codes = supervisorAdvisorCodes\(\)\)/);
  assert.match(app, /codes\.forEach\(\(code\) => \{ const name=handoffAdvisorName\(code\)/);
  assert.match(app, /async function generateWorkbook\(announce = true\)/);
  assert.match(app, /const bytes = await workbookBytes\(\), validation = await validateWorkbookBytes\(bytes\)/);
  assert.match(app, /const bytes = await workbookBytes\(codes\), validation = await validateWorkbookBytes\(bytes, codes\)/);
  assert.match(app, /await validateWorkbookBytes\(saved, codes\)/);
});

test("handoff export remains independent of Supervisor Workbook recovery and Settings", () => {
  const start = app.indexOf("  async function generateAdvisorHandoffWorkbook(requestedCodes) {");
  const end = app.indexOf("  async function saveState(", start);
  assert.ok(start > 0 && end > start);
  const body = app.slice(start, end);
  assert.match(body, /writeBytes\(\["exports", name\], bytes\)/);
  assert.match(body, /Advisor Handoff - /);
  assert.match(body, /await addHistory\("advisor-handoff-export"/);
  assert.doesNotMatch(body, /model\.recovery\.supervisorWorkbook\s*=/);
  assert.doesNotMatch(body, /model\.settings\.supervisorWorkbook\s*=/);
});

test("Open RO page gets visible, accessible handoff action", () => {
  assert.match(app, /heading\.after\(host\)/);
  assert.match(app, /Export Advisor Handoff XLSX/);
  assert.match(app, /aria-expanded="false" aria-controls="handoffPanel"/);
  assert.match(app, /Select all/);
  assert.match(app, /renderAdvisorHandoff\(\); const records/);
  assert.match(app, /ensureOpenRoRetrievalUi\(\);ensureAdvisorHandoffUi\(\)/);
});
