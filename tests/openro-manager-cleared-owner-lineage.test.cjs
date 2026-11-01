"use strict";

// #59-01: production-function regression for intentional manager-owned blanks.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function slice(begin, end, name) {
  const start = app.indexOf(begin), stop = app.indexOf(end, start + begin.length);
  assert.ok(start >= 0 && stop > start, "Missing production " + name);
  return app.slice(start, stop);
}

const reconcile = slice("  function reconcileRecordSourceIdentity(", "  function reconcileOpenRoSourceIdentities(", "Open RO source identity reconciliation");
const merge = slice("  function defaultManagementFor(", "  async function importCdkRepairOrdersDocx(", "Open RO manager ownership and full-roster merge");

function harness(records = [], closedRecords = []) {
  const model = { assignNext: { currentOpenRo: { records: [] } },
    state: { records, closedRecords } };
  const ctx = vm.createContext({
    model,
    text: value => String(value ?? ""),
    sourceAdvisorIdentity: record => ({ code: record.advisorCode, name: record.advisor }),
    sourceTechnicianIdentity: () => ({}),
    CLOSED_RO_RETENTION_DAYS: 45,
    canonicalCdkStatus: status => status === "Open" ? "Open" : "",
    norm: value => String(value ?? "").trim().toLowerCase()
  });
  vm.runInContext(reconcile + "\n" + merge +
    "\nthis.reconcileRecordSourceIdentity = reconcileRecordSourceIdentity;" +
    "\nthis.ownerAssignmentSourceForManagerSave = ownerAssignmentSourceForManagerSave;" +
    "\nthis.ownerAssignmentSourceForWorkbook = ownerAssignmentSourceForWorkbook;" +
    "\nthis.mergeCompleteOpenRoRecords = mergeCompleteOpenRoRecords;", ctx);
  return { ctx, model };
}

test("explicit manager clearing an owner produces a durable distinct authority marker", () => {
  const { ctx } = harness();
  const prior = { owner: "Synthetic Advisor", ownerAssignmentSource: "source-writer" };
  assert.equal(ctx.ownerAssignmentSourceForManagerSave(prior, "", "Synthetic Advisor", true), "manager-cleared");
  assert.equal(ctx.ownerAssignmentSourceForManagerSave({ owner: "", ownerAssignmentSource: "manager-cleared" },
    "", "Synthetic Advisor", false), "manager-cleared");
  assert.equal(ctx.ownerAssignmentSourceForManagerSave(prior, "", "Synthetic Advisor", false), "");
  assert.equal(ctx.ownerAssignmentSourceForManagerSave(prior, "Manager Selected", "Synthetic Advisor", true), "manager-confirmed");
});

test("source identity reconciliation does not silently undo a manager-cleared owner", () => {
  const { ctx } = harness();
  const record = { ro: "SYN-101", advisor: "Updated Advisor", advisorCode: "A2",
    management: { owner: "", ownerAssignmentSource: "manager-cleared", updatedAt: "2026-11-01T14:00:00Z" } };
  ctx.reconcileRecordSourceIdentity(record);
  assert.equal(record.management.owner, "");
  assert.equal(record.management.ownerAssignmentSource, "manager-cleared");
  assert.equal(record.advisor, "Updated Advisor", "source-owned advisor is still allowed to refresh");
});

test("legacy unassigned rows still inherit the verified source advisor", () => {
  const { ctx } = harness();
  const record = { ro: "SYN-102", advisor: "Synthetic Advisor", advisorCode: "A1",
    management: { owner: "", ownerAssignmentSource: "" } };
  ctx.reconcileRecordSourceIdentity(record);
  assert.equal(record.management.owner, "Synthetic Advisor");
  assert.equal(record.management.ownerAssignmentSource, "source-writer");
});

test("workbook round trip retains manager-cleared ownership provenance", () => {
  const { ctx } = harness();
  const preserved = { owner: "", ownerAssignmentSource: "manager-cleared" };
  assert.equal(ctx.ownerAssignmentSourceForWorkbook(preserved, "", "Updated Advisor"), "manager-cleared");
  assert.equal(ctx.ownerAssignmentSourceForWorkbook({ owner: "", ownerAssignmentSource: "" }, "",
    "Updated Advisor"), "");
});

test("full Open RO source reimport keeps manual blank and management while updating source facts", () => {
  const original = { id: "ro-syn-103", ro: "SYN-103", advisor: "Original Advisor",
    advisorCode: "A1", sourceStatus: "Open",
    management: { owner: "", ownerAssignmentSource: "manager-cleared",
      status: "Waiting Parts", note: "Synthetic customer update",
      updatedAt: "2026-11-01T14:00:00Z" } };
  const { ctx } = harness([original]);
  const incoming = { id: "ro-syn-103", ro: "SYN-103", advisor: "Updated Advisor",
    advisorCode: "A2", sourceStatus: "Open" };
  const merged = ctx.mergeCompleteOpenRoRecords([incoming], "2026-11-01T15:00:00Z", "open-ro-xlsx");
  assert.equal(merged.records.length, 1);
  assert.equal(merged.closedCount, 0);
  const record = merged.records[0];
  ctx.reconcileRecordSourceIdentity(record);
  const afterRestart = JSON.parse(JSON.stringify(record));
  assert.equal(afterRestart.management.owner, "");
  assert.equal(afterRestart.management.ownerAssignmentSource, "manager-cleared");
  assert.equal(afterRestart.management.note, original.management.note);
  assert.equal(afterRestart.management.updatedAt, original.management.updatedAt);
  assert.equal(afterRestart.advisor, "Updated Advisor");
  assert.equal(afterRestart.advisorCode, "A2");
  assert.equal(afterRestart.cdkOperational.status, "Open");
});
