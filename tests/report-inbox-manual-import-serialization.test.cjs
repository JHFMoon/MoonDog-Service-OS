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

for (const busyImport of ["dailyImportBusy", "appointmentImportBusy"]) {
  test(`Report Inbox yields to a manual ${busyImport} and retries the same stable report`, async () => {
    const candidate = {
      name: "synthetic-sapr.xlsx",
      relativePath: "Report Inbox/synthetic-sapr.xlsx",
      signature: "synthetic-signature",
      location: "report-inbox"
    };
    const folderWatch = {
      timer: null, busy: false, pending: new Map(), lastChecked: "", state: "ON", message: ""
    };
    const model = {
      root: { name: "Synthetic Workspace" },
      autoImport: { inboxVersion: 1, initializedAt: "2026-10-24T12:00:00.000Z" }
    };
    const calls = { reads: 0, imports: 0, writes: 0 };
    let dailyImportBusy = busyImport === "dailyImportBusy";
    let appointmentImportBusy = busyImport === "appointmentImportBusy";
    const context = vm.createContext({
      model,
      folderWatch,
      writeAuthority: { canWrite: true },
      get dailyImportBusy() { return dailyImportBusy; },
      get appointmentImportBusy() { return appointmentImportBusy; },
      AUTO_IMPORT_PATH: ["data", "auto-import.json"],
      folderWatchEnabled: () => true,
      permission: async () => "granted",
      watchStatus() {},
      watchCandidates: async () => {
        calls.reads += 1;
        return [candidate];
      },
      candidateNeedsImport: () => true,
      autoSurveyFolder: async signatures => {
        calls.imports += 1;
        assert.deepEqual(signatures, ["synthetic-signature"]);
        return { imported: [candidate.name], retained: [], learned: [] };
      },
      writeJson: async () => { calls.writes += 1; },
      recordDiagnostic() {},
      now: () => "2026-10-24T12:00:01.000Z",
      renderAll() {},
      renderSetup() {},
      renderRecovery() {},
      window: { scrollX: 0, scrollY: 0, scrollTo() {} },
      Promise, Map, Set, Object, Array, String, Boolean, JSON, Error, console
    });
    vm.runInContext(folderWatchScan + "; this.scan = folderWatchScan;", context);

    await context.scan("poll");
    assert.equal(calls.reads, 0, "the watcher must not enumerate files during a manual import");
    assert.equal(calls.imports, 0, "the watcher must not invoke the importer during a manual import");
    assert.equal(folderWatch.busy, false, "a deferred scan must not strand the shared intake slot");
    assert.equal(folderWatch.pending.size, 0, "a deferred scan must not create partial candidate state");
    assert.equal(calls.writes, 0, "a deferred scan must not mutate intake metadata");

    dailyImportBusy = false;
    appointmentImportBusy = false;
    await context.scan("retry");
    assert.equal(calls.reads, 1, "the next eligible scan must enumerate the report");
    assert.equal(calls.imports, 0, "one observation must still wait for stability confirmation");
    assert.deepEqual(
      JSON.parse(JSON.stringify(folderWatch.pending.get(candidate.relativePath))),
      {
        signature: "synthetic-signature",
        confirmations: 1,
        firstSeenAt: "2026-10-24T12:00:01.000Z"
      },
      "the recovered candidate must retain a deterministic first-seen marker"
    );

    await context.scan("retry");
    assert.equal(calls.reads, 2);
    assert.equal(calls.imports, 1, "the stable report must be imported exactly once after the manual import ends");
    assert.equal(folderWatch.pending.has(candidate.relativePath), false, "successful import clears the pending marker");
    assert.equal(folderWatch.busy, false, "the shared intake slot releases after import");
    assert.equal(calls.writes, 0, "initialized synthetic intake metadata remains unchanged");
  });
}
