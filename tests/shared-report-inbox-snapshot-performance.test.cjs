"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function extract(startText, endText) {
  const start = app.indexOf(startText);
  const end = app.indexOf(endText, start + startText.length);
  assert.ok(start >= 0 && end > start, "production source boundary exists: " + startText);
  return app.slice(start, end);
}

const inboxSnapshot = extract("  async function reportInboxEntries() {", "\n  async function scanFiles(");
const scanFiles = extract("  async function scanFiles(inboxSnapshot=null) {", "\n  async function scanPerformanceFiles(");
const scanPerformance = extract("  async function scanPerformanceFiles(inboxSnapshot=null) {", "\n  async function scanAppointmentAndPerformanceFiles(");
const pairedScan = extract("  async function scanAppointmentAndPerformanceFiles() {", "\n\n  function parseCsv(");
const scanAppointment = extract("  async function scanAppointmentFiles(inboxSnapshot=null) {", "\n\n  function parseAppointments(");

function field() {
  return {
    disabled: false, children: [],
    replaceChildren(...items) { this.children = [...items]; },
    add(item) { this.children.push(item); }
  };
}
function makeContext(extra = {}) {
  const ui = {
    sourceSelect: field(), importButton: field(),
    performanceSourceSelect: field(), importPerformance: field(),
    appointmentSource: field(), importAppointments: field()
  };
  const model = {
    autoImport: { seen: {} },
    root: { async *entries() {} }
  };
  function Option(label, value) { this.label = label; this.value = value; }
  return {
    ui, model,
    sourceLocations: new Map(),
    directory: async () => ({ async *entries() {} }),
    returnedWorkbookCandidate: () => false,
    Option,
    recordDiagnostic: () => {},
    ...extra
  };
}
function makeFile(name, kind = "file") { return [name, { name, kind }]; }

test("Report Inbox entry collection reads the directory once and preserves handle identities", async () => {
  const original = [["synthetic.xlsx", { kind: "file" }]];
  let directoryReads = 0;
  const context = vm.createContext(makeContext({
    reportInbox: async create => {
      assert.equal(create, false, "listing never creates or mutates the Report Inbox");
      return { async *entries() { directoryReads += 1; yield* original; } };
    }
  }));
  vm.runInContext(inboxSnapshot + "\nthis.readInbox=reportInboxEntries;", context);

  const result = await context.readInbox();

  assert.equal(directoryReads, 1);
  assert.strictEqual(result[0][1], original[0][1], "the snapshot retains the original file handle");
  assert.deepEqual(result.map(([name]) => name), ["synthetic.xlsx"]);
});

test("read-only report selectors consume one shared inbox snapshot without relisting the folder", async () => {
  const inboxListing = [
    makeFile("appointments.xlsx"),
    makeFile("Open RO current.xlsx"),
    makeFile("pre-ros.pdf"),
    makeFile("~$sync.xlsx"),
    makeFile("folder", "directory")
  ];
  const context = vm.createContext(makeContext({
    reportInbox: async () => { throw new Error("snapshot consumers must not relist the inbox"); }
  }));
  vm.runInContext(
    inboxSnapshot + scanFiles + scanPerformance + scanAppointment +
    "\nthis.scanFiles=scanFiles; this.scanPerformance=scanPerformanceFiles; this.scanAppointments=scanAppointmentFiles;",
    context
  );

  await context.scanFiles(inboxListing);
  await context.scanPerformance(inboxListing);
  await context.scanAppointments(inboxListing);

  assert.deepEqual(context.ui.sourceSelect.children.map(item => item.value).filter(Boolean),
    ["appointments.xlsx", "Open RO current.xlsx"]);
  assert.deepEqual(context.ui.performanceSourceSelect.children.map(item => item.value).filter(Boolean),
    ["appointments.xlsx"]);
  assert.deepEqual(context.ui.appointmentSource.children.map(item => item.value).filter(Boolean),
    ["appointments.xlsx", "Open RO current.xlsx", "pre-ros.pdf"]);
  assert.equal(context.sourceLocations.get("Open RO current.xlsx"), "inbox");
});

test("the post-connect appointment and performance scans share one enumerated snapshot", async () => {
  const snapshot = [["synthetic.xlsx", { kind: "file" }]];
  let enumerations = 0;
  const seen = [];
  const context = vm.createContext(makeContext({
    reportInboxEntries: async () => { enumerations += 1; return snapshot; },
    scanAppointmentFiles: async entries => { seen.push(["appointments", entries]); },
    scanPerformanceFiles: async entries => { seen.push(["performance", entries]); }
  }));
  vm.runInContext(pairedScan + "\nthis.scanPaired=scanAppointmentAndPerformanceFiles;", context);

  await context.scanPaired();

  assert.equal(enumerations, 1);
  assert.equal(seen.length, 2);
  assert.strictEqual(seen[0][1], snapshot);
  assert.strictEqual(seen[1][1], snapshot);
});

test("read-only connection shares its inbox enumeration across selector scans", () => {
  assert.match(app, /const reportInboxSnapshot = reportInboxEntries\(\);[\s\S]*reportInboxSnapshot\.then\(entries => scanFiles\(entries\)\)[\s\S]*reportInboxSnapshot\.then\(entries => scanAppointmentFiles\(entries\)\)[\s\S]*reportInboxSnapshot\.then\(entries => scanPerformanceFiles\(entries\)/);
  assert.match(app, /Appointment and performance sources.*scanAppointmentAndPerformanceFiles/);
});
