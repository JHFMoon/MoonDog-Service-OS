"use strict";

// #59-01: Extract the real production full-roster merge; preserve manually
// saved state when a verified new report adds the VIN to a unique open RO.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function extract(begin, end) {
  const start = app.indexOf(begin), stop = app.indexOf(end, start + begin.length);
  assert.ok(start >= 0 && stop > start, "Production Open RO source merge function missing");
  return app.slice(start, stop);
}
const functions = extract("  function defaultManagementFor(", "  async function importCdkRepairOrdersDocx(");
const VIN_A = "A".repeat(17);
const VIN_B = "B".repeat(17);
function harness(active = [], closed = []) {
  const model = { state: { records: active, closedRecords: closed } };
  const ctx = vm.createContext({
    model,
    CLOSED_RO_RETENTION_DAYS: 45,
    canonicalCdkStatus: status => status === "Open" ? "Open" : "",
    norm: value => String(value ?? "").trim().toLowerCase()
  });
  vm.runInContext(functions + "\nthis.merge = mergeCompleteOpenRoRecords;", ctx);
  return ctx.merge;
}
function oldRo(ro, extra = {}) {
  return { id: "ro-" + ro.toLowerCase(), ro, vin: "", advisor: "Old Advisor",
    sourceStatus: "Open", management: { owner: "Manager Assigned",
      ownerAssignmentSource: "manager-confirmed", status: "Waiting Parts",
      nextAction: "Check synthetic parts", note: "Manager follow-up", updatedAt: new Date().toISOString() },
    ...extra };
}
function newRo(ro, vin = VIN_A, extra = {}) {
  return { id: "ro-" + ro.toLowerCase() + "-" + vin.slice(-8).toLowerCase(),
    ro, vin, advisor: "New Advisor", sourceStatus: "Open", ...extra };
}
const now = () => new Date().toISOString();

test("verified VIN enrichment of a unique RO transfers management and updates source-owned facts", () => {
  const previous = oldRo("SYN-201");
  const results = harness([previous])([newRo("SYN-201")], now(), "open-ro-xlsx");
  assert.equal(results.closedCount, 0);
  assert.equal(results.reopenedCount, 0);
  assert.equal(results.records.length, 1);
  assert.equal(results.closedRecords.length, 0);
  const row = results.records[0];
  assert.equal(row.vin, VIN_A);
  assert.equal(row.advisor, "New Advisor");
  assert.equal(row.management.owner, "Manager Assigned");
  assert.equal(row.management.status, "Waiting Parts");
  assert.equal(row.management.nextAction, "Check synthetic parts");
  assert.equal(row.management.updatedAt, previous.management.updatedAt);
  assert.equal(row.cdkOperational.status, "Open");
  const durableRoundTrip = JSON.parse(JSON.stringify(row));
  assert.equal(durableRoundTrip.management.note, "Manager follow-up");
  assert.equal(durableRoundTrip.id, newRo("SYN-201").id);
});

test("closed VIN-less record may reopen with enriched VIN without stale closed duplicate", () => {
  const previous = oldRo("SYN-202", { closedAt: now() });
  const results = harness([], [previous])([newRo("SYN-202")], now(), "cdk-repair-orders");
  assert.equal(results.reopenedCount, 1);
  assert.equal(results.closedCount, 0);
  assert.equal(results.closedRecords.length, 0);
  assert.equal(results.records[0].management.owner, "Manager Assigned");
  assert.equal(results.records[0].closedAt, undefined);
});

test("conflicting known VINs never transfer manager-owned fields", () => {
  const previous = oldRo("SYN-203", { id: newRo("SYN-203", VIN_B).id, vin: VIN_B });
  const results = harness([previous])([newRo("SYN-203", VIN_A)], now(), "open-ro-xlsx");
  assert.equal(results.closedCount, 1);
  assert.equal(results.records[0].management.owner, "New Advisor");
  assert.equal(results.records[0].management.note, "");
});

test("colliding stable ID VIN suffixes fail closed before merging unrelated management", () => {
  const ro = "SYN-207";
  const collidingPriorVin = "B".repeat(9) + "A".repeat(8);
  const previous = { ...oldRo(ro), id: newRo(ro, VIN_A).id, vin: collidingPriorVin };
  assert.notEqual(previous.vin, VIN_A);
  assert.equal(previous.id, newRo(ro, VIN_A).id,
    "synthetic full VIN conflict shares the last-eight-character stable ID");
  assert.throws(() => harness([previous])([newRo(ro, VIN_A)], now(), "open-ro-xlsx"),
    /conflicting Open RO identity or full VIN/);
  assert.equal(previous.management.owner, "Manager Assigned");
});

test("ambiguous prior RO numbers prevent unsafe owner migration", () => {
  const one = oldRo("SYN-204");
  const two = oldRo("SYN-204", { id: "ro-syn-204-other" });
  const results = harness([one, two])([newRo("SYN-204")], now(), "open-ro-xlsx");
  assert.equal(results.closedCount, 2);
  assert.equal(results.records[0].management.owner, "New Advisor");
});

test("duplicate incoming RO numbers prevent unsafe fallback", () => {
  const previous = oldRo("SYN-205");
  const results = harness([previous])([newRo("SYN-205"), newRo("SYN-205", VIN_B)], now(), "open-ro-xlsx");
  assert.equal(results.closedCount, 1);
  assert.equal(results.records[0].management.owner, "New Advisor");
  assert.equal(results.records[1].management.owner, "New Advisor");
});

test("unchanged identity still merges manual state through the exact ID path", () => {
  const previous = oldRo("SYN-206");
  const incoming = { ...previous, advisor: "Changed Advisor", management: undefined };
  const results = harness([previous])([incoming], now(), "open-ro-xlsx");
  assert.equal(results.records[0].advisor, "Changed Advisor");
  assert.equal(results.records[0].management.owner, "Manager Assigned");
  assert.equal(results.closedCount, 0);
});
