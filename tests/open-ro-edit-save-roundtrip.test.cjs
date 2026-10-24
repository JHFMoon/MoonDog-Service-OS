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
  extract("  async function directory(", "  let diagnosticsQueue = "),
  extract("  async function writeJson(", "  async function addHistory("),
  extract("  async function saveState(", "\n\n  function syncFilter("),
  extract("  async function saveRecord(", "\n  async function closeRo(")
].join("\n");
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
function harness(failPath = null) {
  const files = new Map();
  const directories = new Set(["data", "backups"]);
  const model = { state: hostCopy(originalState), selectedId: "synthetic-ro-101", editOrigin: "table", root: null };
  const diagnostics = [];
  let finishCount = 0;
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
    editValidation: { hidden: true, textContent: "" }
  };
  const context = vm.createContext({
    model, ui, VERSION: "0.10.18-beta.synthetic",
    STATE_PATH: ["data", "current-state.json"],
    COMMUNICATION_STATUSES: ["", "Updated", "Attempted / no response", "Needs update", "Not needed"],
    TextEncoder, TextDecoder, JSON, Error, Object, Array, String, Boolean, Map, Set, Promise,
    writeAuthority: { requireWrite() {} },
    MoonDogMaintenance: {
      async safeWrite(_io, name, bytes) {
        if (name === failPath) throw Object.assign(new Error("Synthetic durable write failure"), { name: "NotReadableError" });
        files.set(name, Uint8Array.from(bytes));
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
    finishSavedOpenRo: async () => { finishCount += 1; return true; }
  });
  vm.runInContext(
    storageSource +
      "\nthis.saveForTest = saveRecord; this.readForTest = readJson; this.statePathForTest = STATE_PATH;",
    context
  );
  return { context, model, ui, files, diagnostics, get finishCount() { return finishCount; } };
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
