const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");

function syntheticReturnedWorkbookImport(keywords) {
  const start = app.indexOf("  async function importReturnedWorkbook(");
  const end = app.indexOf("  async function importSource(", start);
  assert.ok(start > 0 && end > start, "returned-workbook import boundary exists");
  const context = {
    ui: { sourceSelect: { value: "" } },
    status: () => {},
    sourceFileHandle: async () => ({
      getFile: async () => ({ arrayBuffer: async () => new ArrayBuffer(4) })
    }),
    XLSX: { read: () => ({ Props: { Keywords: keywords }, SheetNames: [] }) },
    workbookHasReturnSchema: () => true,
    validateReturnedWorkbookFreshness: () => {
      throw new Error("Reached canonical freshness validation");
    },
    text: (value) => String(value ?? "")
  };
  vm.runInNewContext(app.slice(start, end) + "\nthis.importWorkbook = importReturnedWorkbook;", context);
  return context.importWorkbook;
}

test("an outbound advisor handoff cannot be imported after its filename is changed", async () => {
  const runImport = syntheticReturnedWorkbookImport("MoonDog Advisor Handoff Snapshot - outbound only");
  await assert.rejects(
    () => runImport("Renamed Returned Supervisor Workbook.xlsx"),
    /Advisor handoff snapshots are outbound only/,
    "the persisted workbook marker must reject the handoff before any canonical import path"
  );
});

test("an advisor handoff filename cannot masquerade as a returned supervisor workbook", async () => {
  const runImport = syntheticReturnedWorkbookImport("Service Operations Open RO Round Trip");
  await assert.rejects(
    () => runImport("Advisor Handoff - 2026-10-16 - synthetic.xlsx"),
    /Advisor handoff snapshots are outbound only/,
    "the filename guard must reject a handoff even when metadata is absent or old"
  );
});

test("a canonical supervisor workbook still reaches its existing freshness gate", async () => {
  const runImport = syntheticReturnedWorkbookImport("Service Operations Open RO Round Trip");
  await assert.rejects(
    () => runImport("Service Operations Current.xlsx"),
    /Reached canonical freshness validation/,
    "handoff rejection must not disable the supervisor workbook import validation"
  );
});
