"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function section(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "production function boundaries exist: " + start);
  return app.slice(a, b);
}
const candidateNeedsImport = section("  function candidateNeedsImport(", "  function transientWorkspaceState(");
const autoSurveyFolder = section("  async function autoSurveyFolder(", "  async function importReturnedWorkbook(");
const digest = async bytes => crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex");

function setup({ mode = "appointment-removal-failed" } = {}) {
  const state = { present: true, bytes: new Uint8Array([1, 2, 3]), imports: 0, removals: 0, moved: 0, history: [], status: [], ledger: [] };
  const name = "synthetic-appointments.xlsx";
  const relativePath = "01 - DROP REPORTS HERE/" + name;
  const signature = relativePath + "|3|12345";
  const model = { autoImport: { seen: {} } };
  const item = {
    name, location: "inbox", relativePath, signature,
    file: { lastModified: 12345, arrayBuffer: async () => state.bytes.slice().buffer }
  };
  const context = vm.createContext({
    model,
    now: () => "2026-10-29T15:00:00Z",
    watchCandidates: async () => state.present ? [item] : [],
    sha256: digest,
    classifyImportFile: async () => "appointments",
    processClassifiedCandidate: async (_candidate, _kind, bytes, deletion) => {
      assert.equal(deletion, true);
      assert.equal((await digest(bytes)), (await digest(state.bytes)));
      state.imports++;
      if (mode === "import-fails") throw Object.assign(new Error("Source not readable"), { name: "NotReadableError" });
      if (mode === "cleanup-throws" && state.imports === 1)
        throw Object.assign(new Error("Synthetic delete permission lost"), { name: "NotAllowedError", sourceCleanupFailure: true });
      if (mode === "appointment-removal-failed" && state.imports === 1)
        return { saved: true, deleted: false, retainedReason: "Synthetic permission loss" };
      state.removals++; state.present = false;
      return { saved: true, deleted: true };
    },
    removeSourceEntryWithByteGuard: async (_name, expected) => {
      state.removals++;
      assert.equal(await digest(expected), await digest(state.bytes), "cleanup checks current bytes");
      state.present = false;
    },
    sourceLocations: new Map(),
    model, Map, Set, Uint8Array, JSON, Promise, Date,
    moveToLearn: async () => { state.moved++; throw Error("Should not move a successfully imported file to learning"); },
    transientIntakeError: error => error.name === "NotReadableError" || error.name === "NotAllowedError",
    recordDiagnostic() {},
    status: message => state.status.push(message),
    writeJson: async (_path, value) => state.ledger.push(JSON.parse(JSON.stringify(value))),
    AUTO_IMPORT_PATH: ["data", "auto-import.json"],
    scanFiles: async () => {},
    addHistory: async (...args) => state.history.push(args),
    sha256: digest,
    referenceOnlyHint: () => false, recognizedFamilyHint: () => false,
    console,
    // These are deliberately unreachable for a recognized synthetic report.
    referenceOnlyDocumentType: () => null
  });
  vm.runInContext(candidateNeedsImport + autoSurveyFolder + "\nthis.scan = autoSurveyFolder;", context);
  return {state, model, name, signature, context, scan: () => context.scan()};
}

test("verified auto-import removes a report and records it as imported", async () => {
  const h = setup({mode:"success"});
  const result = await h.scan();
  assert.equal(h.state.imports, 1);
  assert.equal(h.state.removals, 1);
  assert.equal(h.state.present, false);
  assert.equal(h.model.autoImport.seen[h.signature].cleanupPending, undefined);
  assert.equal(result.imported.length, 1);
  assert.match(h.state.status.at(-1), /Imported and removed 1 verified source file/);
});

for (const mode of ["appointment-removal-failed", "cleanup-throws"]) {
  test(`durable ${mode} is retained and retried without reimporting`, async () => {
    const h = setup({mode});
    const first = await h.scan();
    assert.equal(h.state.imports, 1);
    assert.equal(h.state.present, true);
    assert.equal(h.state.moved, 0);
    assert.equal(first.imported.length, 0, "must not claim deletion");
    assert.equal(first.cleanupPending.length, 1);
    assert.equal(h.model.autoImport.seen[h.signature].cleanupPending, true);
    assert.match(h.state.status.at(-1), /will retry without re-importing/);
    const second = await h.scan();
    assert.equal(h.state.imports, 1, "retry never reimports a durable report");
    assert.equal(h.state.removals, 1);
    assert.equal(h.state.present, false);
    assert.equal(h.model.autoImport.seen[h.signature].cleanupPending, false);
    assert.equal(second.cleaned.length, 1);
    assert.equal(h.state.moved, 0);
  });
}

test("a changed report is never removed by a cleanup retry", async () => {
  const h = setup();
  await h.scan();
  h.state.bytes = new Uint8Array([1, 2, 4]);
  const second = await h.scan();
  assert.equal(h.state.imports, 1);
  assert.equal(h.state.removals, 0);
  assert.equal(h.state.present, true);
  assert.equal(h.state.moved, 0);
  assert.equal(second.cleanupPending.length, 1);
  assert.equal(h.model.autoImport.seen[h.signature].cleanupPending, true);
});

test("a transient import failure does not schedule deletion", async () => {
  const h = setup({mode:"import-fails"});
  const result = await h.scan();
  assert.equal(h.state.removals, 0);
  assert.equal(h.state.present, true);
  assert.equal(h.state.moved, 0);
  assert.equal(result.retained.length, 1);
  assert.equal(h.model.autoImport.seen[h.signature], undefined);
});

test("explicit Inbox source deletion cannot fall back to the root folder", async () => {
  const source = section("  async function removeSourceEntry(name) {", "  async function finishReadOnlyConnection(");
  let rootDeleted = false;
  const context = vm.createContext({
    dailyPickedSources: new Map(),
    xlsxSourceDeleteGuards: new Map(),
    sourceLocations: new Map([["synthetic.xlsx", "inbox"]]),
    model: { root: { removeEntry: async () => { rootDeleted = true; } } },
    reportInbox: async () => ({ removeEntry: async () => { throw Object.assign(new Error("Missing"), {name:"NotFoundError"}); } }),
    Map, Error
  });
  vm.runInContext(source + "\nthis.remove = removeSourceEntry;", context);
  await assert.rejects(context.remove("synthetic.xlsx"), {name:"NotFoundError"});
  assert.equal(rootDeleted, false);
});

test("automatic source byte guard also covers non-XLSX report types", () => {
  const process = section("  async function processClassifiedCandidate(", "  async function reconcileLearnedFiles(");
  assert.match(process, /const guardXlsxDelete = candidate.location !== "picked" && Boolean\(bytes\)/);
  assert.match(process, /xlsxSourceDeleteGuards.set\(candidate.name, bytes\)/);
});

test("cleanup intent is persisted before attempting source removal", async () => {
  const source = section("  async function removeSourceEntry(name) {", "  async function finishReadOnlyConnection(");
  const name = "synthetic.xlsx", signature = "01 - DROP REPORTS HERE/synthetic.xlsx|3|12345";
  const calls = [], model = {autoImport:{seen:{}},root:{removeEntry:async()=>{throw Error("Root must not be touched");}}};
  const context = vm.createContext({
    dailyPickedSources: new Map(), xlsxSourceDeleteGuards: new Map(),
    sourceLocations: new Map([[name, "inbox"]]),
    autoSourceDeleteContext: new Map([[name,{signature,relativePath:"01 - DROP REPORTS HERE/"+name,
      kind:"performance",bytes:new Uint8Array([1,2,3]).buffer}]]),
    model, now:()=> "2026-10-29T15:00:00Z", sha256:digest,
    AUTO_IMPORT_PATH:["data","auto-import.json"],
    writeJson:async()=>{calls.push("ledger");},
    reportInbox:async()=>({removeEntry:async()=>{calls.push("delete");throw Object.assign(Error("denied"),{name:"NotAllowedError"});}}),
    Map,Uint8Array,Error
  });
  vm.runInContext(source + "\nthis.remove = removeSourceEntry;", context);
  await assert.rejects(context.remove(name),{name:"NotAllowedError"});
  assert.deepEqual(calls,["ledger","delete"]);
  assert.equal(model.autoImport.seen[signature].cleanupPending,true);
  assert.equal(model.autoImport.seen[signature].cleanupSha256,await digest(new Uint8Array([1,2,3])));
});

test("source is never deleted if pending-cleanup ledger cannot be saved", async () => {
  const source = section("  async function removeSourceEntry(name) {", "  async function finishReadOnlyConnection(");
  const name = "synthetic.xlsx";
  let attempted = 0;
  const context = vm.createContext({
    dailyPickedSources:new Map(),xlsxSourceDeleteGuards:new Map(),
    sourceLocations:new Map([[name,"inbox"]]),
    autoSourceDeleteContext:new Map([[name,{signature:"synthetic",relativePath:"01 - DROP REPORTS HERE/"+name,kind:"csi",bytes:new Uint8Array([7]).buffer}]]),
    model:{autoImport:{seen:{}},root:{removeEntry:async()=>{attempted++;}}},
    now:()=> "2026-10-29T15:00:00Z",sha256:digest,
    AUTO_IMPORT_PATH:["data","auto-import.json"],
    writeJson:async()=>{throw Error("Ledger write denied");},
    reportInbox:async()=>({removeEntry:async()=>{attempted++;}}),
    Map,Uint8Array,Error
  });
  vm.runInContext(source + "\nthis.remove = removeSourceEntry;", context);
  await assert.rejects(context.remove(name),/Ledger write denied/);
  assert.equal(attempted,0);
});
