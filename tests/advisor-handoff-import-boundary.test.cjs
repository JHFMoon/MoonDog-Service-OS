const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const ISSUANCE_PROP = "MoonDogSupervisorIssuanceV1";
const ISSUED = "mdsw1-" + "a".repeat(32);
const DIFFERENT = "mdsw1-" + "b".repeat(32);
const helperStart = app.indexOf('  const SUPERVISOR_ISSUANCE_PROP = ');
const helperEnd = app.indexOf('  function workbookHasReturnSchema(', helperStart);
const importStart = app.indexOf("  async function importReturnedWorkbook(");
const importEnd = app.indexOf("  async function importSource(", importStart);
assert.ok(helperStart > 0 && helperEnd > helperStart, "Supervisor Workbook issuance helpers exist");
assert.ok(importStart > 0 && importEnd > importStart, "Supervisor Workbook return import exists");

function returnedImportFixture(options = {}) {
  const {
    keywords = "Service Operations Open RO Round Trip",
    issuance = ISSUED,
    expected = ISSUED,
    stale = false,
    xmlProperties = [ISSUED],
    zipFails = false
  } = options;
  const mutations = [];
  const book = {
    Props: { Keywords: keywords }, Custprops: issuance === null ? {} : { [ISSUANCE_PROP]: issuance },
    SheetNames: []
  };
  const context = {
    ui: { sourceSelect: { value: "" } },
    status: () => {},
    text: (value) => String(value ?? ""),
    model: { recovery: { supervisorWorkbook: expected === null ? {} : { issuanceId: expected, stale } } },
    sourceFileHandle: async () => ({ getFile: async () => ({ arrayBuffer: async () => new ArrayBuffer(4) }) }),
    XLSX: { read: () => book },
    window: { crypto: { getRandomValues: (arr) => arr.fill(0x11) } },
    JSZip: { loadAsync: async () => {
      if (zipFails) throw new Error("synthetic invalid ZIP");
      return { file: (name) => name === "docProps/custom.xml" && xmlProperties !== null
        ? { async: async () => "<Properties/>" } : null };
    } },
    DOMParser: class {},
    parsedXml: () => ({
      getElementsByTagNameNS: () => (xmlProperties || []).map((id) => ({
        getAttribute: (key) => key === "name" ? ISSUANCE_PROP : "",
        textContent: id
      }))
    }),
    workbookHasReturnSchema: () => true,
    validateReturnedWorkbookFreshness: () => { throw new Error("Reached canonical freshness validation"); },
    backupState: async () => { mutations.push("backup"); throw new Error("Reached prohibited state mutation"); }
  };
  vm.runInNewContext(
    app.slice(helperStart, helperEnd) + "\n" + app.slice(importStart, importEnd)
      + "\nthis.importWorkbook = importReturnedWorkbook; this.issue = newSupervisorWorkbookIssuance;",
    context
  );
  return { run: context.importWorkbook, issue: context.issue, mutations };
}

test("outbound advisor handoff is rejected after its filename is changed", async () => {
  const { run } = returnedImportFixture({ keywords: "MoonDog Advisor Handoff Snapshot - outbound only" });
  await assert.rejects(() => run("Renamed Returned Supervisor Workbook.xlsx"), /Advisor handoff snapshots are outbound only/);
});

test("handoff filename cannot masquerade as a returned Supervisor Workbook", async () => {
  const { run } = returnedImportFixture({ keywords: "Service Operations Open RO Round Trip" });
  await assert.rejects(() => run("Advisor Handoff - 2026-10-16 - synthetic.xlsx"), /Advisor handoff snapshots are outbound only/);
});

test("valid issued Supervisor Workbook reaches the original freshness gate after harmless rename", async () => {
  const { run, mutations } = returnedImportFixture();
  await assert.rejects(() => run("Arbitrary-Renamed-Official.xlsx"), /Reached canonical freshness validation/);
  assert.deepEqual(mutations, []);
});

for (const [caseName, options] of [
  ["renamed metadata-stripped handoff", { issuance: null, xmlProperties: null }],
  ["mismatched issuance", { issuance: DIFFERENT }],
  ["missing saved recovery issuance", { expected: null }],
  ["obsolete Supervisor Workbook after issuance rotation", { expected: DIFFERENT }],
  ["custom XLSX property removed", { xmlProperties: null }],
  ["duplicate XLSX custom issuance properties", { xmlProperties: [ISSUED, ISSUED] }],
  ["XML issuance mismatch", { xmlProperties: [DIFFERENT] }],
  ["invalid XLSX package", { zipFails: true }]
]) {
  test(caseName + " fails closed before any state write", async () => {
    const { run, mutations } = returnedImportFixture(options);
    await assert.rejects(() => run("Renamed-Current.xlsx"), /Supervisor Workbook issuance could not be verified/);
    assert.deepEqual(mutations, [], "no backup or state mutation on rejected return");
  });
}

for (const stale of [true, undefined, null, "unknown"]) {
  test("stale state " + String(stale) + " rejects before backup and freshness", async () => {
    const { run, mutations } = returnedImportFixture({ stale });
    await assert.rejects(() => run("Official-Synthetic.xlsx"), /Supervisor Workbook is stale or its current status cannot be verified/);
    assert.deepEqual(mutations, []);
  });
}

test("issued workbook identifiers use Web Crypto instead of a timestamp", () => {
  const { issue } = returnedImportFixture();
  assert.equal(issue(), "mdsw1-" + "11".repeat(16));
  assert.match(app, /window\.crypto\.getRandomValues\(random\)/);
  assert.doesNotMatch(app.slice(helperStart, helperEnd), /Math\.random\(/);
});

test("official generation persists verified issuance; handoff generation never issues one", () => {
  assert.match(app, /book\.Custprops = \{ \[SUPERVISOR_ISSUANCE_PROP\]: issuanceId \}/);
  assert.match(app, /if \(!handoff\) \{ if \(!\/\^mdsw1/);
  assert.match(app, /const issuanceId = newSupervisorWorkbookIssuance\(\), codes = supervisorAdvisorCodes\(\)/);
  assert.match(app, /await validateWorkbookBytes\(saved, codes, false, issuanceId\)/);
  assert.match(app, /await readJson\(RECOVERY_PATH, \{\}\)/);
  assert.match(app, /onDisk\.supervisorWorkbook\?\.issuanceId !== issuanceId/);
});

function sourceImportFixture(returnSchema, hasIdentity) {
  const start = app.indexOf("  async function importSource(");
  const end = app.indexOf("\n\n  const timeMinutes =", start);
  assert.ok(start > 0 && end > start, "general import entry exists");
  const calls = [];
  const context = {
    ui: { sourceSelect: { value: "" } },
    status: () => {},
    text: (value) => String(value ?? ""),
    sourceFileHandle: async () => ({ getFile: async () => ({ arrayBuffer: async () => new ArrayBuffer(4) }) }),
    XLSX: { read: () => ({ Props: {}, SheetNames: ["Sheet1"], Sheets: { Sheet1: {} } }) },
    workbookHasReturnSchema: () => returnSchema,
    workbookHasReturnIdentity: () => hasIdentity,
    importReturnedWorkbook: async () => { calls.push("returned"); throw new Error("Routed through official return import"); },
    legacyReport: () => { calls.push("generic"); throw new Error("Reached generic source importer"); }
  };
  vm.runInNewContext(app.slice(start, end) + "\nthis.importSource = importSource;", context);
  return { run: context.importSource, calls };
}

test("general import routes complete supervisor-like books through issuance validation", async () => {
  const { run, calls } = sourceImportFixture(true, true);
  await assert.rejects(() => run("Renamed-Current.xlsx"), /Routed through official return import/);
  assert.deepEqual(calls, ["returned"]);
});

test("supervisor-like books with damaged headers cannot fall back to generic import", async () => {
  const { run, calls } = sourceImportFixture(false, true);
  await assert.rejects(() => run("Damaged-Current.xlsx"), /Needs Review/);
  assert.deepEqual(calls, []);
});

test("ordinary generic source XLSX remains on the generic import path", async () => {
  const { run, calls } = sourceImportFixture(false, false);
  await assert.rejects(() => run("SYNTHETIC-Ro-Report.xlsx"), /Reached generic source importer/);
  assert.deepEqual(calls, ["generic"]);
});

test("failed recovery persistence must preserve the previously issued workbook", () => {
  const start = app.indexOf("  async function generateWorkbook(");
  const end = app.indexOf("\n\n  // A handoff is an independent", start);
  assert.ok(start > 0 && end > start, "generation path exists");
  const generation = app.slice(start, end);
  // A failed recovery.json write after overwriting the primary workbook must
  // restore its previous bytes, or the old issuance becomes unusable.
  assert.match(generation, /let previousPrimaryWorkbookBytes\s*=/,
    "capture the previously issued workbook before replacing it");
  assert.match(generation, /catch \(error\) \{[\s\S]*?previousPrimaryWorkbookBytes[\s\S]*?writeBytes\(\["exports", name\]/,
    "restore the prior workbook if recovery persistence fails");
});

test("official issuance must be checked after an actual protected XLSX roundtrip", () => {
  assert.match(app, /await validateWorkbookBytes\(saved, codes, false, issuanceId\)/);
  assert.match(app, /book\.Custprops\?\.\[SUPERVISOR_ISSUANCE_PROP\] !== issuanceId/);
});

test("returned workbook rejects stale or unverified issuance state before mutation", () => {
  const start = app.indexOf("  async function importReturnedWorkbook(");
  const end = app.indexOf("\n  ", start + 45);
  assert.ok(start >= 0, "returned workbook entrypoint exists");
  const entry = app.slice(start, start + 1500);
  const issued = entry.indexOf("await requireIssuedSupervisorWorkbook(book, bytes)");
  const stale = entry.indexOf("model.recovery?.supervisorWorkbook?.stale !== false");
  const freshness = entry.indexOf("validateReturnedWorkbookFreshness(book)");
  const mutation = app.indexOf("await backupState(", start);
  assert.ok(issued >= 0 && stale > issued && freshness > stale, "stale gate follows issuance and precedes freshness");
  assert.ok(mutation < 0 || mutation > start + stale, "stale gate precedes backup");
  assert.match(entry, /Needs Review: generate a new official Supervisor Workbook/);
});
