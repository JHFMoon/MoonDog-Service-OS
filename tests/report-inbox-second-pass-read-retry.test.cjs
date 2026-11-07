"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const first = app.indexOf("  async function folderWatchScan(");
const last = app.indexOf("  async function importReturnedWorkbook(", first);
assert.ok(first >= 0 && last > first, "Production Report Inbox watcher and import path exist");
const production = app.slice(first, last);

function candidate(name, serial) {
  const relativePath = "Report Inbox/" + name;
  return {
    name, relativePath, location: "inbox",
    signature: relativePath + "|3|" + serial,
    file: {lastModified: serial, async arrayBuffer() {
      return new Uint8Array([1, 2, 3]).buffer;
    }}
  };
}
function harness({onlyUnreadable = false, csvPreview = false, unexpectedPreviewError = false} = {}) {
  const root = {name: "Synthetic Workspace"};
  const extension = csvPreview ? "csv" : "xlsx";
  const good = candidate("synthetic-good." + extension, 100);
  const bad = candidate("synthetic-deferred." + extension, 200);
  const sources = onlyUnreadable ? [bad] : [good, bad];
  let failedPreview = false;
  if (csvPreview) {
    good.file.slice = () => ({text: async () => "advisor name,total ros,vir printed/emailed"});
    bad.file.slice = () => ({text: async () => {
      if (!failedPreview) {
        failedPreview = true;
        const error = new Error("Synthetic metadata preview failure");
        error.name = unexpectedPreviewError ? "TypeError" : "NotReadableError";
        throw error;
      }
      return "advisor name,total ros,vir printed/emailed";
    }});
  }
  const deferred = {...bad, file: undefined, readError: {name: "NotReadableError"}};
  const model = {root, autoImport: {seen: {}, inboxVersion: 1, initializedAt: "2026-11-02T12:00:00Z"}};
  const pending = new Map(sources.map(source => [source.relativePath, {
    signature: source.signature, confirmations: 1, firstSeenAt: "2026-11-02T12:00:00Z"
  }]));
  const folderWatch = {timer: null, busy: false, pending, lastChecked: "", state: "ON", message: ""};
  const imports = [], writes = [], errors = [];
  let inventoryReads = 0;
  const context = vm.createContext({
    model, folderWatch, Map, Set, Object, Array, Promise, Boolean, JSON, Date,
    Uint8Array, Error, console,
    writeAuthority: {canWrite: true},
    workspaceConnectionBusy: false, workspaceRecoveryBusy: false, postConnectionScanBusy: false,
    dailyImportBusy: false, appointmentImportBusy: false,
    AUTO_IMPORT_PATH: ["data", "auto-import.json"],
    window: {scrollX: 0, scrollY: 0, scrollTo() {}},
    folderWatchEnabled: () => true, permission: async () => "granted",
    watchCandidates: async () => {
      inventoryReads++;
      return inventoryReads === 2 && !csvPreview
        ? (onlyUnreadable ? [deferred] : [good, deferred]) : sources;
    },
    candidateNeedsImport: item => !model.autoImport.seen?.[item.signature],
    transientIntakeError: error => error?.name === "NotReadableError",
    classifyImportFile: async () => "sor",
    processClassifiedCandidate: async item => {
      imports.push(item.name);
      return {saved: true, deleted: true};
    },
    sourceLocations: new Map(), now: () => "2026-11-02T12:01:00Z",
    writeJson: async (target, value) => writes.push({target: target.join("/"), value: structuredClone(value)}),
    recordDiagnostic: (kind, message) => {if (/error|failed/i.test(kind)) errors.push(message);},
    status() {}, watchStatus() {}, renderAll() {}, renderSetup() {}, renderRecovery() {},
    scanFiles: async () => {}
  });
  vm.runInContext(production + "\nthis.scanInbox = folderWatchScan;", context);
  return {good, bad, model, folderWatch, imports, writes, errors, run: () => context.scanInbox("poll")};
}

test("an unreadable second-pass source cannot abort a healthy confirmed Report Inbox import", async () => {
  const h = harness();
  await h.run();
  assert.deepEqual(h.imports, [h.good.name], "healthy report must import exactly once");
  assert.equal(h.model.autoImport.seen[h.good.signature].kind, "sor");
  assert.equal(h.model.autoImport.seen[h.bad.signature], undefined, "unreadable report cannot be marked imported");
  assert.equal(h.folderWatch.pending.has(h.good.relativePath), false, "verified healthy marker clears");
  assert.equal(h.folderWatch.pending.get(h.bad.relativePath).confirmations, 2,
    "unreadable report retains stability confirmation for retry");
  assert.equal(h.folderWatch.busy, false, "watch slot must release normally");
  assert.deepEqual(h.errors, [], "temporary file access must not fail entire watch batch");

  await h.run();
  assert.deepEqual(h.imports, [h.good.name, h.bad.name],
    "recovered file imports on next confirmed pass without repeating healthy import");
  assert.equal(h.folderWatch.pending.has(h.bad.relativePath), false);
  assert.equal(h.model.autoImport.seen[h.bad.signature].kind, "sor");
  assert.equal(h.folderWatch.busy, false);
});

test("only-unreadable second-pass source remains retryable without ledger writes", async () => {
  const h = harness({onlyUnreadable: true});
  await h.run();
  assert.deepEqual(h.imports, []);
  assert.deepEqual(h.writes, [], "no ledger update or source write is warranted");
  assert.equal(h.model.autoImport.seen[h.bad.signature], undefined);
  assert.equal(h.folderWatch.pending.get(h.bad.relativePath).confirmations, 2);
  assert.equal(h.folderWatch.busy, false);
  await h.run();
  assert.deepEqual(h.imports, [h.bad.name], "recovered source must still import");
});


test("transient CSV preview read failure defers only the locked file, then retries it", async () => {
  const h = harness({csvPreview: true});
  await h.run();
  assert.deepEqual(h.imports, [h.good.name], "healthy CSV must import despite the other preview lock");
  assert.equal(h.model.autoImport.seen[h.bad.signature], undefined,
    "preview failure cannot claim import or mutate the bad source's ledger");
  assert.equal(h.folderWatch.pending.has(h.good.relativePath), false);
  assert.equal(h.folderWatch.pending.get(h.bad.relativePath).confirmations, 2,
    "stable confirmation must survive preview failure for next scan");
  assert.equal(h.folderWatch.busy, false, "watch should release after partial success");
  assert.deepEqual(h.errors, [], "a transient preview lock must not fail entire intake");
  await h.run();
  assert.deepEqual(h.imports, [h.good.name, h.bad.name],
    "recovered CSV should import exactly once without reprocessing the healthy source");
  assert.equal(h.folderWatch.pending.has(h.bad.relativePath), false);
});

test("a sole CSV preview lock does not create a false ledger update and remains retryable", async () => {
  const h = harness({onlyUnreadable: true, csvPreview: true});
  await h.run();
  assert.deepEqual(h.imports, []);
  assert.deepEqual(h.writes, [], "a preview failure cannot issue an unrelated workspace write");
  assert.equal(h.model.autoImport.seen[h.bad.signature], undefined);
  assert.equal(h.folderWatch.pending.get(h.bad.relativePath).confirmations, 2);
  await h.run();
  assert.deepEqual(h.imports, [h.bad.name]);
});

test("nontransient preview error falls through to ordinary validation instead of hiding source", async () => {
  const h = harness({csvPreview: true, unexpectedPreviewError: true});
  await h.run();
  assert.deepEqual(h.imports, [h.good.name, h.bad.name],
    "ordering-only preview errors do not permanently suppress a valid source");
  assert.equal(h.folderWatch.pending.size, 0);
  assert.deepEqual(h.errors, []);
});
