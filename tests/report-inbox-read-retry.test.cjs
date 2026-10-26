"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const startToken = "  async function folderWatchScan(";
const endToken = "  async function autoSurveyFolder(";
const start = app.indexOf(startToken);
const end = app.indexOf(endToken, start + startToken.length);
assert.ok(start >= 0 && end > start, "production Report Inbox scanner boundary exists");
const folderWatchScan = app.slice(start, end);

test("Report Inbox retries a temporary file read failure, confirms stability, and imports once", async () => {
  const folderWatch = { timer: null, busy: false, pending: new Map(), lastChecked: "", state: "OFF", message: "" };
  const model = { root: { name: "Synthetic Workspace" }, autoImport: {} };
  const diagnostics = [];
  const statuses = [];
  const writes = [];
  const imported = [];
  let scanCount = 0;

  const candidate = {
    name: "synthetic-sapr.xlsx",
    relativePath: "Report Inbox/synthetic-sapr.xlsx",
    signature: "synthetic-signature",
    location: "report-inbox"
  };
  const readFailure = {
    name: candidate.name,
    relativePath: candidate.relativePath,
    location: "report-inbox",
    readError: true
  };
  const window = { scrollX: 0, scrollY: 0, scrollTo() {} };
  const context = vm.createContext({
    model, folderWatch, window, writeAuthority: { canWrite: true }, workspaceConnectionBusy: false, postConnectionScanBusy: false,
    dailyImportBusy: false, appointmentImportBusy: false,
    AUTO_IMPORT_PATH: ["data", "auto-import.json"],
    folderWatchEnabled: () => true,
    permission: async () => "granted",
    watchStatus: (state, message) => statuses.push({ state, message }),
    watchCandidates: async () => {
      scanCount += 1;
      return scanCount === 1 ? [readFailure] : [candidate];
    },
    candidateNeedsImport: () => true,
    autoSurveyFolder: async signatures => {
      imported.push([...signatures]);
      return { imported: ["synthetic-sapr.xlsx"], retained: [], learned: [] };
    },
    writeJson: async (path, value) => writes.push({ path, value: structuredClone(value) }),
    recordDiagnostic: (category, message) => diagnostics.push({ category, message }),
    now: () => "2026-10-23T12:00:00.000Z",
    renderAll() {}, renderSetup() {}, renderRecovery() {},
    Promise, Map, Set, Object, Array, String, Boolean, JSON, Error, console
  });
  vm.runInContext(folderWatchScan + "\nthis.scan=folderWatchScan;", context);

  await context.scan("retry");
  assert.equal(folderWatch.pending.get(candidate.relativePath).readPending, true,
    "a temporary read error must remain retryable");
  assert.equal(imported.length, 0, "a failed read must not import");

  await context.scan("retry");
  assert.deepEqual(
    JSON.parse(JSON.stringify(folderWatch.pending.get(candidate.relativePath))),
    { signature: "synthetic-signature", confirmations: 1, firstSeenAt: "2026-10-23T12:00:00.000Z" },
    "the recovered file must begin stability confirmation instead of being silently discarded"
  );
  assert.equal(imported.length, 0, "one recovered observation is not enough to import");

  await context.scan("retry");
  assert.deepEqual(imported, [["synthetic-signature"]],
    "the same stable synthetic file must be imported once after its second confirmation");
  assert.equal(folderWatch.pending.has(candidate.relativePath), false,
    "the pending marker must clear after the stable import");
  assert.equal(folderWatch.busy, false, "the shared intake slot must release after import");
  assert.ok(diagnostics.some(item => item.category === "REPORT INBOX PENDING" && /Temporary file read failure/.test(item.message)));
});


test("overlapping Report Inbox scans share the busy guard and still import a stable source once", async () => {
  const folderWatch = { timer: null, busy: false, pending: new Map(), lastChecked: "", state: "ON", message: "" };
  const model = {
    root: { name: "Synthetic Workspace" },
    autoImport: { inboxVersion: 1, initializedAt: "2026-10-23T11:00:00.000Z" }
  };
  const candidate = {
    name: "synthetic-sapr.xlsx",
    relativePath: "Report Inbox/synthetic-sapr.xlsx",
    signature: "synthetic-signature",
    location: "report-inbox"
  };
  let reads = 0;
  let imports = 0;
  let releaseFirstRead;
  let markFirstRead;
  const firstRead = new Promise(resolve => { markFirstRead = resolve; });
  const firstGate = new Promise(resolve => { releaseFirstRead = resolve; });
  const imported = [];
  const context = vm.createContext({
    model, folderWatch, window: { scrollX: 0, scrollY: 0, scrollTo() {} },
    writeAuthority: { canWrite: true }, workspaceConnectionBusy: false, postConnectionScanBusy: false, dailyImportBusy: false, appointmentImportBusy: false,
    AUTO_IMPORT_PATH: ["data", "auto-import.json"],
    folderWatchEnabled: () => true,
    permission: async () => "granted",
    watchStatus() {},
    watchCandidates: async () => {
      reads += 1;
      if (reads === 1) {
        markFirstRead();
        await firstGate;
      }
      return [candidate];
    },
    candidateNeedsImport: () => true,
    autoSurveyFolder: async signatures => {
      imports += 1;
      imported.push([...signatures]);
      return { imported: [candidate.name], retained: [], learned: [] };
    },
    writeJson: async () => {},
    recordDiagnostic() {},
    now: () => "2026-10-23T12:00:00.000Z",
    renderAll() {}, renderSetup() {}, renderRecovery() {},
    Promise, Map, Set, Object, Array, String, Boolean, JSON, Error, console
  });
  vm.runInContext(folderWatchScan + "\nthis.scan=folderWatchScan;", context);

  const first = context.scan("poll");
  await firstRead;
  await context.scan("retry");
  assert.equal(reads, 1, "an overlapping scan must not start another inventory");
  releaseFirstRead();
  await first;
  assert.equal(imports, 0, "one observation cannot import an unstable report");

  await context.scan("poll");
  assert.deepEqual(imported, [["synthetic-signature"]], "the next stable observation imports exactly once");
  assert.equal(imports, 1);
  assert.equal(folderWatch.busy, false, "the shared scan guard releases after completion");
});


test("Report Inbox retains its stable marker and retries after a transient importer failure", async () => {
  const folderWatch = { timer: null, busy: false, pending: new Map(), lastChecked: "", state: "ON", message: "" };
  const model = {
    root: { name: "Synthetic Workspace" },
    autoImport: { inboxVersion: 1, initializedAt: "2026-10-23T11:00:00.000Z" }
  };
  const candidate = {
    name: "synthetic-sapr.xlsx",
    relativePath: "Report Inbox/synthetic-sapr.xlsx",
    signature: "synthetic-signature",
    location: "report-inbox"
  };
  const diagnostics = [];
  let imports = 0;
  const context = vm.createContext({
    model, folderWatch, window: { scrollX: 0, scrollY: 0, scrollTo() {} },
    writeAuthority: { canWrite: true }, workspaceConnectionBusy: false, postConnectionScanBusy: false, dailyImportBusy: false, appointmentImportBusy: false,
    AUTO_IMPORT_PATH: ["data", "auto-import.json"],
    folderWatchEnabled: () => true,
    permission: async () => "granted",
    watchStatus: () => {},
    watchCandidates: async () => [candidate],
    candidateNeedsImport: () => true,
    autoSurveyFolder: async () => {
      imports += 1;
      if (imports === 1) throw Error("synthetic transient importer failure");
      return { imported: [candidate.name], retained: [], learned: [] };
    },
    writeJson: async () => {},
    recordDiagnostic: (category, message) => diagnostics.push({ category, message }),
    now: () => "2026-10-23T12:00:00.000Z",
    renderAll() {}, renderSetup() {}, renderRecovery() {},
    Promise, Map, Set, Object, Array, String, Boolean, JSON, Error, console
  });
  vm.runInNewContext(folderWatchScan + "\nthis.scan=folderWatchScan;", context);

  await context.scan("poll");
  await context.scan("poll");
  assert.equal(imports, 1, "the second stable observation reaches the production importer once");
  assert.deepEqual(
    JSON.parse(JSON.stringify(folderWatch.pending.get(candidate.relativePath))),
    { signature: "synthetic-signature", confirmations: 2, firstSeenAt: "2026-10-23T12:00:00.000Z" },
    "a failed import must retain its stable source marker for retry"
  );
  assert.equal(folderWatch.busy, false, "the shared intake slot must release after the failed import");
  assert.ok(diagnostics.some(item => item.category === "REPORT INBOX WATCH" && /scan failed/.test(item.message)));

  await context.scan("retry");
  assert.equal(imports, 2, "the next eligible scan retries the same stable source");
  assert.equal(folderWatch.pending.has(candidate.relativePath), false,
    "the marker clears only after a successful import");
  assert.equal(folderWatch.busy, false, "the shared intake slot releases after the successful retry");
});
