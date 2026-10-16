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
        { advisorCode: "103", advisor: "Removed Advisor" },
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

test("handoff picker includes absent and unconfigured owners but excludes explicitly removed advisors", () => {
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


function handoffIdentityModel() {
  const start = app.indexOf("  function handoffRecordOwner(");
  const end = app.indexOf("  function supervisorWorkbookRecords(", start);
  assert.ok(start >= 0 && end > start, "identity-scoped handoff resolver exists");
  const records = [
    { id: "A", advisorCode: "101", advisor: "Shared Name" },
    { id: "B", advisorCode: "102", advisor: "Shared Name" },
    { id: "C", advisorCode: "", advisor: "Shared Name" },
    { id: "D", advisorCode: "", advisor: "Unique Name" },
    { id: "E", advisorCode: "", advisor: "Unverified" },
    { id: "F", advisorCode: "104", advisor: "Removed Advisor" }
  ];
  const roster = [
    { code: "101", name: "Shared Name" },
    { code: "102", name: "Shared Name" },
    { code: "103", name: "Unique Name" }
  ];
  const context = {
    model: { state: { records }, settings: { advisors: {
      "101": { number: "101", name: "Shared Name" },
      "102": { number: "102", name: "Shared Name" },
      "103": { number: "103", name: "Unique Name" },
      "104": { number: "104", name: "Removed Advisor", removed: true }
    } } },
    selectableHandoffAdvisors: () => roster,
    norm: (value) => String(value ?? "").trim().toLowerCase(),
    text: (value) => String(value ?? "")
  };
  vm.runInNewContext(app.slice(start, end) + "\nthis.owner = handoffRecordOwner; this.records = handoffRecords;", context);
  return { context, records, roster };
}

test("handoff assigns explicit codes but never leaks duplicate display names", () => {
  const { context, records, roster } = handoffIdentityModel();
  assert.equal(context.owner(records[0], roster), "101");
  assert.equal(context.owner(records[1], roster), "102");
  assert.equal(context.owner(records[2], roster), null);
  assert.equal(context.owner(records[3], roster), "103");
  assert.equal(context.owner(records[4], roster), null);
  assert.equal(context.owner(records[5], roster), null);
  assert.deepEqual(Array.from(context.records(["101"]), (row) => row.id), ["A"]);
  assert.deepEqual(Array.from(context.records(["102"]), (row) => row.id), ["B"]);
});

test("selected subsets, zero selections and all advisors preserve unique RO ownership", () => {
  const { context } = handoffIdentityModel();
  assert.deepEqual(Array.from(context.records([]), (row) => row.id), []);
  assert.deepEqual(Array.from(context.records(["103"]), (row) => row.id), ["D"]);
  assert.deepEqual(Array.from(context.records(["101", "102", "103"]), (row) => row.id), ["A", "B", "D"]);
  const ids = ["101", "102", "103"].flatMap((code) => Array.from(context.records([code]), (row) => row.id));
  assert.equal(new Set(ids).size, ids.length, "no RO appears in multiple advisor tabs");
});

test("removed duplicate identity also makes name-only assignment ambiguous", () => {
  const { context, records, roster } = handoffIdentityModel();
  context.model.settings.advisors["105"] = { number: "105", name: "Unique Name", removed: true };
  assert.equal(context.owner(records[3], roster), null);
  assert.deepEqual(Array.from(context.records(["103"]), (row) => row.id), []);
});

test("handoff-only scoping leaves canonical workbook import intact and reports Needs Review", () => {
  assert.match(app, /handoff \? handoffRecords\(codes\)\.length : supervisorWorkbookRecords\(codes\)\.length/);
  assert.match(app, /handoff \? handoffRecordsForCode\(code\) : model\.state\.records\.filter/);
  assert.match(app, /workbookBytes\(codes, true\)/);
  assert.match(app, /validateWorkbookBytes\(saved, codes, true\)/);
  assert.match(app, /Needs Review:.*records.*excluded/);
  assert.match(app, /Advisor Handoff - \$\{localDateKey\(\)\} - \$\{Date\.now\(\)\}/);
  assert.match(app, /const bytes = await workbookBytes\(\), validation = await validateWorkbookBytes\(bytes\)/);
});
