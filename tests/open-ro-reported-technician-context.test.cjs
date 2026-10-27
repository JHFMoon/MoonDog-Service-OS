"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function productionBetween(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "actual Open RO production boundary remains present");
  return app.slice(a, b);
}
const sourceTechnician = productionBetween("  function sourceTechnicianIdentity(", "  function sourceAdvisorIdentity(");
const openEditor = productionBetween("  function openEdit(id, origin = \"table\")", "  function editValidationError(");

function harness() {
  const record = {
    id: "synthetic-101", ro: "SYN-101",
    advisor: "Synthetic Advisor", advisorCode: "100",
    customer: "Synthetic Customer", vehicle: "Synthetic vehicle", vin: "",
    technicianCode: "317", technician: "Unresolved source text",
    sourceFields: { "Source Status": "Being Repaired" },
    management: { status: "Being Repaired", owner: "Synthetic Manager",
      nextAction: "Check repaired synthetic vehicle", reviewDate: "2026-10-27",
      communication: "Updated", note: "Synthetic history",
      adminCloseout: { blocker: "", taskDate: "", expectedCloseDate: "" } }
  };
  const model = { state: { records: [record] }, selectedId: null, editOrigin: "table",
    openRoSaveInFlight: false };
  const item = value => ({ value, textContent: "", hidden: false, dataset: {},
    focus() {} });
  const ui = {
    dialogTitle: item(""), editPosition: item(""), editClarification: item(""),
    editValidation: item(""), editStatus: item(""), editStatusDetail: item(""),
    editStatusDetailOther: item(""), editOwner: item(""),
    editNextAction: item(""), editReviewDate: item(""),
    editAdminBlocker: item(""), editAdminTaskDate: item(""),
    editAdminCloseDate: item(""), editAdminChangeReason: item(""),
    editCommunication: item(""), editNote: item(""),
    recordSummary: { children: [], replaceChildren() { this.children = []; },
      append(element) { this.children.push(element); } },
    editDialog: { open: false, showModal() { this.open = true; } }
  };
  const context = vm.createContext({
    model, ui, Date, String,
    text: value => String(value ?? ""),
    sourceFieldValue: () => "",
    ALIASES: { technicianCode: [], technician: [] },
    technicianDirectory: () => ({
      "317": { displayName: "Synthetic Resolved Technician" }
    }),
    resolveTechnicianName: () => "",
    visibleRecordIds: () => [record.id], visibleFocusIds: () => [record.id],
    clarificationFor: () => "", statusForRecord: () => "Being Repaired",
    selectableStatusesFor: () => ["Being Repaired"],
    populateSelect: (select, options) => { select.value = options[0]; },
    updateStatusDetailEditor() {}, renderCdkStatusIndicator() {},
    loadAdminCloseoutEvidence() {},
    restoreSelectValue: (select, value) => { select.value = value; },
    normalizeCommunication: value => value,
    COMMUNICATION_STATUSES: ["Updated", "Needs update"],
    requestAnimationFrame: callback => callback(),
    document: { createElement: tag => ({ tagName: tag, textContent: "" }) },
    status: () => {}
  });
  vm.runInContext(sourceTechnician + "\n" + openEditor +
    "\nthis.openForTest=openEdit;this.identityForTest=sourceTechnicianIdentity;", context);
  return { context, record, model, ui };
}

test("quick Open RO editor identifies technician from source rather than manager-owned assignment", () => {
  const h = harness();
  assert.equal(h.context.openForTest(h.record.id), true);
  const texts = h.ui.recordSummary.children.map(item => item.textContent);
  assert.ok(texts.includes("Synthetic Customer"), "customer context is retained");
  assert.ok(texts.includes("Technician (reported source): Synthetic Resolved Technician"),
    "technician source identity is shown without claiming a manager confirmation");
  assert.equal(h.ui.editOwner.value, "Synthetic Manager",
    "displaying source technician cannot replace saved manager follow-up ownership");
  assert.equal(h.ui.editDialog.open, true);
});

test("quick Open RO editor does not manufacture an assigned technician when the source is missing", () => {
  const h = harness();
  h.record.technicianCode = "";
  h.record.technician = "";
  assert.equal(h.context.openForTest(h.record.id), true);
  const texts = h.ui.recordSummary.children.map(item => item.textContent);
  assert.ok(texts.includes("Technician: Not confirmed by source"));
  assert.ok(!texts.some(item => item.startsWith("Technician (reported source):")),
    "missing identity is not silently replaced from the manager's owner field");
});

test("source identity resolver prioritizes the coded, report-backed technician display name", () => {
  const h = harness();
  const technician = h.context.identityForTest(h.record);
  assert.equal(technician.code, "317");
  assert.equal(technician.name, "Synthetic Resolved Technician");
  assert.equal(h.record.technician, "Unresolved source text",
    "source fields are read-only during identity presentation");
});
