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
  assert.ok(start >= 0 && end > start, "production Open RO persistence boundary exists");
  return app.slice(start, end);
}
const storageSource = [
  extract("  async function directory(", "  // Automatic diagnostics logging is intentionally disabled."),
  extract("  function ownerAssignmentSourceForManagerSave(", "  function pruneClosedRecords("),
  extract("  async function writeJson(", "  async function addHistory("),
  extract("  async function saveState(", "\n\n  function syncFilter("),
  extract("  async function saveRecord(", "\n  async function closeRo(")
].join("\n");
const draftGuardSource = extract("  let editDraftDirty = false;", "  function visibleFocusIds()");
const finishSavedSource = extract("  async function finishSavedOpenRo(", "  async function saveRecord(");
const productionHistorySource = extract("  async function addHistory(", "  function migrateOpenRoFieldIdentity(");
const originalState = {
  updatedAt: "2026-10-24T11:00:00.000Z",
  records: [{
    id: "synthetic-ro-101",
    ro: "SYN-101",
    sourceFields: { "RO Number": "SYN-101", "Source Status": "Waiting Parts" },
    management: {
      status: "Waiting Parts",
      owner: "Synthetic Previous Owner",
      nextAction: "Check the synthetic part",
      reviewDate: "2026-10-23",
      communication: "Updated",
      note: "Synthetic existing note",
      clarification: { sourceFile: "SYNTHETIC.xlsx", flaggedAt: "2026-10-24T10:00:00.000Z", reason: "Synthetic unresolved source question" },
      manualAnnotation: "Synthetic manager-entered annotation",
      adminCloseout: { blocker: null, evidence: "Synthetic closeout evidence" }
    }
  }],
  closedRecords: [],
  source: { kind: "synthetic-fixture" }
};
const hostCopy = value => JSON.parse(JSON.stringify(value));
function harness(failPath = null, failOnce = false, productionDraftFlow = false, productionHistory = false) {
  let failedOnce = false;
  const files = new Map();
  const directories = new Set(["data", "backups"]);
  const model = { state: hostCopy(originalState), selectedId: "synthetic-ro-101", editOrigin: "table", root: null };
  const diagnostics = [];
  const history = [];
  const events = [];
  let finishCount = 0;
  let dialogClosed = 0;
  function notFound() { return Object.assign(new Error("Synthetic file is absent"), { name: "NotFoundError" }); }
  function directoryHandle(prefix) {
    return {
      async getDirectoryHandle(name, options = {}) {
        const next = prefix ? prefix + "/" + name : name;
        if (!directories.has(next)) {
          if (!options.create) throw notFound();
          directories.add(next);
        }
        return directoryHandle(next);
      },
      async getFileHandle(name) {
        const fullPath = prefix ? prefix + "/" + name : name;
        return {
          async getFile() {
            if (!files.has(fullPath)) throw notFound();
            events.push(`read:${fullPath}`);
            const bytes = files.get(fullPath);
            return { async text() { return new TextDecoder().decode(bytes); } };
          }
        };
      }
    };
  }
  model.root = directoryHandle("");
  const ui = {
    editNextAction: { value: "Complete synthetic inspection" },
    editReviewDate: { value: "2026-10-26" },
    editStatus: { value: "Being Repaired" },
    editStatusDetail: { value: "" },
    editStatusDetailOther: { value: "" },
    editCommunication: { value: "Updated" },
    editOwner: { value: "Synthetic Assigned Owner" },
    editNote: { value: "Synthetic follow-up saved" },
    editAdminBlocker: { value: "" },
    editAdminTaskDate: { value: "" },
    editAdminCloseDate: { value: "" },
    editAdminChangeReason: { value: "" },
    editValidation: { hidden: true, textContent: "" },
    editDialog: { close() { dialogClosed += 1; } }
  };
  const context = vm.createContext({
    model, ui, VERSION: "0.10.18-beta.synthetic",
    STATE_PATH: ["data", "current-state.json"],
    COMMUNICATION_STATUSES: ["", "Updated", "Attempted / no response", "Needs update", "Not needed"],
    TextEncoder, TextDecoder, JSON, Error, Object, Array, String, Boolean, Map, Set, Promise,
    window: { confirm: () => true },
    addHistory: async (type, message, details) => { events.push(`history:${type}`); history.push({ type, message, details }); },
    markSupervisorWorkbookStale: async () => {},
    renderAll: () => {},
    status: () => {},
    transientWorkspaceState: () => false,
    connectedNativeRoot: null,
    scheduleAuthorityRevalidation: () => {},
    openEdit: () => {},
    writeAuthority: { requireWrite() {} },
    MoonDogMaintenance: {
      async safeWrite(_io, name, bytes) {
        if (name === failPath && (!failOnce || !failedOnce)) {
          failedOnce = true;
          throw Object.assign(new Error("Synthetic durable write failure"), { name: "NotReadableError" });
        }
        files.set(name, Uint8Array.from(bytes));
        events.push(`write:${name}`);
      }
    },
    maintenanceIO: {},
    directory: undefined,
    fileAt: undefined,
    readJson: undefined,
    writeBytes: undefined,
    writeJson: undefined,
    backupState: undefined,
    saveState: undefined,
    canonicalReviewStatus: value => value,
    resolveStatusId: () => "synthetic-being-repaired",
    statusDetailsFor: () => [],
    normalizedStatusDetail: () => "",
    statusAllowedForSave: () => true,
    editValidationError(message) {
      ui.editValidation.textContent = message;
      ui.editValidation.hidden = false;
      throw new Error(message);
    },
    visibleRecordIds: () => ["synthetic-ro-101"],
    visibleFocusIds: () => ["synthetic-ro-101"],
    dailySaveAdditions: null,
    localDateKey: () => "2026-10-24",
    now: () => "2026-10-24T12:00:00.000Z",
    stamp: () => "20261024-120000",
    slug: value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    recordDiagnostic: (kind, message) => diagnostics.push({ kind, message }),
    finishSavedOpenRo: productionDraftFlow ? undefined : async () => { finishCount += 1; return true; }
  });
  const draftSupport = productionDraftFlow ? "\n" + draftGuardSource + "\n" + finishSavedSource : "";
  const historySupport = productionHistory
    ? "\n" + productionHistorySource.replace("async function addHistory(", "async function addHistoryForTest(") + "\nthis.addHistoryForTest=addHistoryForTest;"
    : "";
  const draftExports = productionDraftFlow
    ? "\nthis.setDraftDirty=value=>{editDraftDirty=value;}; this.markDraftDirty=markEditDraftDirty; this.isDraftDirty=()=>editDraftDirty; this.guardDraftUnload=guardUnsavedEditUnload; this.setReadJsonForTest=fn=>{readJson=fn;};"
    : "";
  vm.runInContext(
    storageSource + draftSupport + historySupport +
      "\nthis.saveForTest = saveRecord; this.readForTest = readJson; this.statePathForTest = STATE_PATH;" + draftExports,
    context
  );
  if (productionHistory) context.addHistory = context.addHistoryForTest;
  return { context, model, ui, files, diagnostics, history, events, get finishCount() { return finishCount; }, get dialogClosed() { return dialogClosed; } };
}

test("Open RO production save verifies read-back, preserves source/manual fields, and clears the acknowledged clarification", async () => {
  const h = harness();
  const result = await h.context.saveForTest({ preventDefault() {} });
  assert.equal(result, true);
  const durable = await h.context.readForTest(h.context.statePathForTest, null);
  assert.deepStrictEqual(hostCopy(h.model.state), durable, "the model equals the production read-back snapshot");
  const backupPath = [...h.files.keys()].find(name => name.startsWith("backups/"));
  assert.ok(backupPath, "the prior state was backed up before the updated snapshot was written");
  assert.deepStrictEqual(
    await h.context.readForTest(backupPath.split("/"), null),
    originalState,
    "the backup retains the exact pre-edit synthetic state"
  );
  const record = durable.records[0];
  assert.equal(record.management.owner, "Synthetic Assigned Owner");
  assert.equal(record.management.nextAction, "Complete synthetic inspection");
  assert.equal(record.management.reviewDate, "2026-10-26");
  assert.equal(record.management.note, "Synthetic follow-up saved");
  assert.deepStrictEqual(record.sourceFields, originalState.records[0].sourceFields,
    "manager edits do not change source-report values");
  assert.equal(record.management.clarification, null, "a successful reviewed save clears the pending synthetic clarification");
  assert.equal(record.management.manualAnnotation, "Synthetic manager-entered annotation", "unrelated manual metadata remains intact");
  assert.deepStrictEqual(record.management.adminCloseout, originalState.records[0].management.adminCloseout);
  assert.equal(h.finishCount, 1, "post-save UI completion runs only after production read-back succeeds");
  assert.ok(h.diagnostics.some(item => item.kind === "DURABLE WRITE"));
});


test("manual Open RO edit history is durably persisted after read-back with source lineage intact", async () => {
  const h = harness(null, false, true, true);
  assert.equal(await h.context.saveForTest({ preventDefault() {} }), true);

  const durable = await h.context.readForTest(h.context.statePathForTest, null);
  const record = durable.records[0];
  const historyPaths = [...h.files.keys()].filter(name => name.startsWith("data/history/") && name.endsWith(".json"));
  assert.equal(historyPaths.length, 1, "one verified manual update persists one history file");
  const audit = JSON.parse(new TextDecoder().decode(h.files.get(historyPaths[0])));
  assert.equal(audit.type, "ro-update");
  assert.equal(audit.summary, "Updated RO SYN-101");
  assert.deepStrictEqual(audit.details.before, originalState.records[0].management,
    "history records the prior manager-authored state");
  assert.deepStrictEqual(audit.details.after, record.management,
    "history records the exact durable manager-authored state");
  assert.equal(audit.details.dailyFocus, false);
  assert.deepStrictEqual(record.sourceFields, originalState.records[0].sourceFields,
    "manual management edits do not replace imported report fields");

  const stateWrite = h.events.findLastIndex(event =>
    event.startsWith("write:") && event.includes("current-state.json"));
  const stateReadback = h.events.findLastIndex(event =>
    event.startsWith("read:") && event.includes("current-state.json"));
  const historyWrite = h.events.findLastIndex(event => event === "write:"+historyPaths[0]);
  const historyReadback = h.events.findLastIndex(event => event === "read:"+historyPaths[0]);
  assert.ok(stateWrite >= 0 && stateReadback > stateWrite,
    "the production save writes and reads back the current-state file");
  assert.ok(historyWrite > stateReadback && historyReadback > historyWrite,
    "production history is written and read back only after verified state persistence");
});

test("transient Open RO write failure preserves the draft for a verified retry", async () => {
  const h = harness("data/current-state.json", true);
  const failed = await h.context.saveForTest({ preventDefault() {} });
  assert.equal(failed, undefined, "the first unverified write must not report success");
  assert.deepStrictEqual(hostCopy(h.model.state), originalState, "a failed write restores the prior authoritative model");
  assert.equal(h.ui.editNextAction.value, "Complete synthetic inspection", "the typed draft remains available for retry");
  assert.equal(h.finishCount, 0, "Save & Next does not advance on failed durability");

  const retried = await h.context.saveForTest({ preventDefault() {} });
  assert.equal(retried, true, "a later successful durable save completes the same draft");
  const durable = await h.context.readForTest(h.context.statePathForTest, null);
  assert.deepStrictEqual(hostCopy(h.model.state), durable, "the model is replaced only with verified read-back");
  assert.equal(durable.records[0].management.nextAction, "Complete synthetic inspection");
  assert.equal(durable.records[0].management.owner, "Synthetic Assigned Owner");
  assert.equal(durable.records[0].management.ownerAssignmentSource, "manager-confirmed",
    "a changed follow-up owner is recorded as an explicit manager assignment");
  assert.deepStrictEqual(durable.records[0].sourceFields, originalState.records[0].sourceFields,
    "retry does not rewrite source-report authority");
  assert.equal(durable.records[0].management.manualAnnotation, "Synthetic manager-entered annotation");
  assert.equal(h.finishCount, 1, "post-save completion runs exactly once after verified retry");
});

test("failed Open RO durable save retains prior clarification, source, and manual fields", async () => {
  const h = harness("data/current-state.json");
  const result = await h.context.saveForTest({ preventDefault() {} });
  assert.equal(result, undefined, "an unverified write does not complete the save");
  assert.deepStrictEqual(hostCopy(h.model.state), originalState, "the full original synthetic state is restored");
  assert.equal(h.model.state.records[0].management.clarification.reason, "Synthetic unresolved source question");
  assert.equal(h.model.state.records[0].management.manualAnnotation, "Synthetic manager-entered annotation");
  assert.deepStrictEqual(h.model.state.records[0].sourceFields, originalState.records[0].sourceFields);
  assert.equal(h.ui.editValidation.hidden, false, "the failed save remains visible and retryable");
  assert.equal(h.ui.editNextAction.value, "Complete synthetic inspection");
  assert.equal(h.finishCount, 0, "post-save completion does not run before verified persistence");
});

test("draft stays protected during failed read-back and clears only after verified retry", async () => {
  const h = harness(null, false, true);
  h.context.setDraftDirty(true);

  let releaseFirstReadback;
  let readbackStarted;
  const firstReadback = new Promise(resolve => { readbackStarted = resolve; });
  const readbackGate = new Promise(resolve => { releaseFirstReadback = resolve; });
  const originalReadJson = h.context.readForTest;
  let failFirstCurrentStateReadback = true;
  h.context.setReadJsonForTest(async (path, fallback) => {
    if (path.join("/") === "data/current-state.json" && failFirstCurrentStateReadback) {
      failFirstCurrentStateReadback = false;
      readbackStarted();
      await readbackGate;
      throw new Error("Synthetic verification read-back failure");
    }
    return originalReadJson(path, fallback);
  });

  let preventedWhilePending = false;
  const pendingUnload = { returnValue: null, preventDefault() { preventedWhilePending = true; } };
  const saving = h.context.saveForTest({ preventDefault() {} });
  await firstReadback;
  assert.equal(h.context.isDraftDirty(), true, "the draft remains dirty while production read-back is pending");
  h.context.guardDraftUnload(pendingUnload);
  assert.equal(preventedWhilePending, true, "unload remains guarded during verification");
  assert.equal(pendingUnload.returnValue, "");
  assert.equal(h.dialogClosed, 0, "the editor must stay open until verification completes");
  releaseFirstReadback();

  const failed = await saving;
  assert.equal(failed, undefined, "a failed current-state read-back does not report save success");
  assert.equal(h.context.isDraftDirty(), true, "failed verification must not clear the unsaved marker");
  assert.equal(h.ui.editNextAction.value, "Complete synthetic inspection");
  assert.deepStrictEqual(hostCopy(h.model.state), originalState, "failed verification restores the authoritative model");
  assert.equal(h.dialogClosed, 0, "failed verification leaves the editor open");

  let preventedAfterFailure = false;
  const failedUnload = { returnValue: null, preventDefault() { preventedAfterFailure = true; } };
  h.context.guardDraftUnload(failedUnload);
  assert.equal(preventedAfterFailure, true, "the native unload guard remains active after failed verification");
  assert.equal(failedUnload.returnValue, "");

  const retried = await h.context.saveForTest({ preventDefault() {} });
  assert.equal(retried, true, "the same draft can be saved after read access recovers");
  const durable = await h.context.readForTest(h.context.statePathForTest, null);
  assert.deepStrictEqual(hostCopy(h.model.state), durable);
  assert.equal(durable.records[0].management.nextAction, "Complete synthetic inspection");
  assert.equal(durable.records[0].management.owner, "Synthetic Assigned Owner");
  assert.deepStrictEqual(durable.records[0].sourceFields, originalState.records[0].sourceFields);
  assert.equal(h.context.isDraftDirty(), false, "production completion clears dirty only after successful read-back");
  assert.equal(h.dialogClosed, 1, "the production post-save path closes the editor only after verified retry");
});


test("edits made while Open RO is saving remain dirty and retryable after verified read-back", async () => {
  const h = harness(null, false, true);
  const firstWriteStarted = new Promise(resolve => { h.signalFirstWrite = resolve; });
  let releaseWrite;
  const writeGate = new Promise(resolve => { releaseWrite = resolve; });
  const originalSafeWrite = h.context.MoonDogMaintenance.safeWrite;
  let holdNextCurrentStateWrite = true;
  h.context.MoonDogMaintenance.safeWrite = async (io, name, bytes) => {
    if (name === "data/current-state.json" && holdNextCurrentStateWrite) {
      holdNextCurrentStateWrite = false;
      h.signalFirstWrite();
      await writeGate;
    }
    return originalSafeWrite(io, name, bytes);
  };

  h.context.markDraftDirty();
  const saving = h.context.saveForTest({ preventDefault() {} }, true);
  await firstWriteStarted;
  h.ui.editNextAction.value = "Late synthetic correction";
  h.context.markDraftDirty();
  releaseWrite();

  assert.equal(await saving, true, "the originally submitted version was durably saved");
  const firstDurable = await h.context.readForTest(h.context.statePathForTest, null);
  assert.equal(firstDurable.records[0].management.nextAction, "Complete synthetic inspection");
  assert.equal(h.ui.editNextAction.value, "Late synthetic correction");
  assert.equal(h.context.isDraftDirty(), true, "the later edit remains visibly unsaved");
  assert.equal(h.dialogClosed, 0, "Save & Next must not close the editor over the later edit");
  assert.equal(h.ui.editValidation.hidden, false);
  assert.match(h.ui.editValidation.textContent, /still unsaved/);

  let prevented = false;
  const unload = { returnValue: null, preventDefault() { prevented = true; } };
  h.context.guardDraftUnload(unload);
  assert.equal(prevented, true, "the native unload guard remains active until the later edit is saved");

  assert.equal(await h.context.saveForTest({ preventDefault() {} }, true), true,
    "the same retained draft can be retried through the production save path");
  const finalDurable = await h.context.readForTest(h.context.statePathForTest, null);
  assert.equal(finalDurable.records[0].management.nextAction, "Late synthetic correction");
  assert.equal(h.context.isDraftDirty(), false, "only the verified retry clears the dirty state");
  assert.equal(h.dialogClosed, 1, "the editor closes only after the late edit is durably verified");
});


test("edits entered during a failed durable write stay dirty and retryable", async () => {
  const h = harness(null, false, true);
  let signalWriteStarted;
  const firstWriteStarted = new Promise(resolve => { signalWriteStarted = resolve; });
  let releaseWrite;
  const writeGate = new Promise(resolve => { releaseWrite = resolve; });
  const originalSafeWrite = h.context.MoonDogMaintenance.safeWrite;
  let interruptFirstCurrentStateWrite = true;
  h.context.MoonDogMaintenance.safeWrite = async (io, name, bytes) => {
    if (name === "data/current-state.json" && interruptFirstCurrentStateWrite) {
      interruptFirstCurrentStateWrite = false;
      signalWriteStarted();
      await writeGate;
      throw Object.assign(new Error("Synthetic interrupted storage write"), { name: "NotReadableError" });
    }
    return originalSafeWrite(io, name, bytes);
  };

  h.context.markDraftDirty();
  const saving = h.context.saveForTest({ preventDefault() {} }, true);
  await firstWriteStarted;
  h.ui.editNextAction.value = "Late synthetic retry action";
  h.context.markDraftDirty();
  releaseWrite();

  assert.equal(await saving, undefined, "an interrupted durable write does not report success");
  assert.deepStrictEqual(hostCopy(h.model.state), originalState,
    "the model returns to its last authoritative snapshot after the write fails");
  assert.equal(h.ui.editNextAction.value, "Late synthetic retry action",
    "the newest typed value remains in the editor");
  assert.equal(h.context.isDraftDirty(), true, "the interrupted edit remains marked unsaved");
  assert.equal(h.dialogClosed, 0, "a failed Save & Next does not close or advance the editor");

  let prevented = false;
  const unload = { returnValue: null, preventDefault() { prevented = true; } };
  h.context.guardDraftUnload(unload);
  assert.equal(prevented, true, "the retained draft stays protected from accidental unload");
  assert.equal(unload.returnValue, "");

  assert.equal(await h.context.saveForTest({ preventDefault() {} }, true), true,
    "the same latest edit can be retried after storage recovers");
  const durable = await h.context.readForTest(h.context.statePathForTest, null);
  assert.equal(durable.records[0].management.nextAction, "Late synthetic retry action");
  assert.deepStrictEqual(durable.records[0].sourceFields, originalState.records[0].sourceFields,
    "retry preserves imported source authority");
  assert.equal(h.context.isDraftDirty(), false, "dirty state clears only after successful read-back");
  assert.equal(h.dialogClosed, 1, "Save & Next completes only after the retried write verifies");
});
