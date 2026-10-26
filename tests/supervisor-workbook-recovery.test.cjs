const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function extract(startToken, endToken) {
  const start = app.indexOf(startToken);
  const end = app.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0 && end > start, `could not extract ${startToken}`);
  return app.slice(start, end);
}
function load(source, globals = {}) {
  const context = vm.createContext({ model: {}, verifyCompleteRoImport: async () => ({}), workbookIsHandoff: () => false, workbookHasReturnIdentity: () => false, ...globals });
  vm.runInContext(source, context);
  return context;
}

const staleMarker = extract("  async function markSupervisorWorkbookStale(", "  function newWorkbookIssuanceId");
const issuancePersistence = extract("  async function persistSupervisorWorkbookIssuance(", "  function newWorkbookIssuanceId");
const issuanceValidation = [
  "const RETURN_ISSUANCE_CELL = 'Q1';",
  "const RECOVERY_PATH = ['data', 'recovery.json'];",
  "const text = value => String(value ?? '');",
  extract("  function workbookIssuanceId(", "  async function markSupervisorWorkbookStale(")
].join("\n");
const operationLock = extract("  let supervisorWorkbookOperationTail = Promise.resolve();", "  const dailyPickedSources");
const publicOperations = [
  extract("  async function importCdkRepairOrdersDocx(", "  async function importCdkRepairOrdersDocxUnlocked("),
  extract("  async function importReturnedWorkbook(", "  async function importReturnedWorkbookUnlocked("),
  extract("  async function importSource(", "  async function importSourceUnlocked("),
  extract("  async function generateWorkbook(", "  async function generateWorkbookUnlocked(")
].join("\n");
const sourceImport = extract("  async function importSourceUnlocked(", "\n\n  const timeMinutes");
const ownerProvenance = extract("  function ownerAssignmentSourceForManagerSave(", "  function pruneClosedRecords(");
const returnedImport = ownerProvenance + "\n" + extract("  async function importReturnedWorkbookUnlocked(", "\n\n  async function importSource(");
const cdkImport = extract("  async function importCdkRepairOrdersDocxUnlocked(", "  function parseTechnicianVideoPlaybook");

function importFailureHarness() {
  const writes = [];
  const globals = {
    model: { state: { records: [{ id: "prior" }], closedRecords: [] }, recovery: {} },
    ui: { sourceSelect: { value: "synthetic.xlsx" } },
    status() {},
    sourceFileHandle: async () => ({ getFile: async () => ({ lastModified: 0, arrayBuffer: async () => new ArrayBuffer(1) }) }),
    XLSX: { read: () => ({ SheetNames: ["Synthetic"], Sheets: {} }) },
    workbookHasReturnSchema: () => false,
    legacyReport: () => ({ records: [{ id: "incoming", ro: "synthetic" }], sheetName: "Synthetic", format: "synthetic" }),
    findTable: () => null,
    reconcileRecordSourceIdentity() {},
    now: () => "2026-10-17T12:00:00.000Z",
    mergeCompleteOpenRoRecords: (records) => ({ records, closedRecords: [], closedCount: 0, reopenedCount: 0 }),
    markSupervisorWorkbookStale: async () => { throw new Error("synthetic stale persistence failure"); },
    backupState: async () => writes.push("backup"),
    writeBytes: async () => writes.push("source-copy"),
    writeJson: async () => writes.push("state"),
    retainDailyReport: async () => writes.push("daily-report"),
    saveOpenRoWorkload: async () => writes.push("workload"),
    ensureDailyFocus: async () => writes.push("daily-focus"),
    addHistory: async () => writes.push("history"),
    renderAll() {},
    docxText: async () => "synthetic docx",
    parseCdkRepairOrdersDocx: () => ({ records: [{ id: "incoming", ro: "synthetic" }], format: "synthetic", summary: {}, validation: {} })
  };
  const context = load(`${sourceImport}\n${cdkImport}\nglobalThis.importSource = importSourceUnlocked; globalThis.importCdk = importCdkRepairOrdersDocxUnlocked;`, globals);
  return { context, writes };
}

test("source XLSX import performs no backup, source, state, or history write if stale marking fails", async () => {
  const { context, writes } = importFailureHarness();
  await assert.rejects(context.importSource("synthetic.xlsx"), /stale persistence failure/);
  assert.deepEqual(writes, []);
});

test("CDK DOCX import performs no backup, source, state, or history write if stale marking fails", async () => {
  const { context, writes } = importFailureHarness();
  await assert.rejects(context.importCdk({ name: "synthetic.docx" }, new ArrayBuffer(1)), /stale persistence failure/);
  assert.deepEqual(writes, []);
});

test("returned workbook performs no backup, state, or history write if stale marking fails", async () => {
  const writes = [], events = [];
  const context = load(`${returnedImport}\nglobalThis.importReturned = importReturnedWorkbookUnlocked;`, {
    ui: { sourceSelect: { value: "synthetic-return.xlsx" } }, status() {},
    sourceFileHandle: async () => ({ getFile: async () => ({ arrayBuffer: async () => new ArrayBuffer(1) }) }),
    XLSX: { read: () => ({ SheetNames: ["Synthetic"], Sheets: {} }) },
    workbookHasReturnSchema: () => true,
    validateReturnedWorkbookIssuance: async () => events.push("issuance-validated"),
    validateReturnedWorkbookFreshness: () => events.push("freshness-validated"),
    markSupervisorWorkbookStale: async () => { events.push("invalidation"); throw new Error("synthetic stale persistence failure"); },
    backupState: async () => writes.push("backup"),
    writeJson: async () => writes.push("state"),
    addHistory: async () => writes.push("history")
  });
  await assert.rejects(context.importReturned("synthetic-return.xlsx"), /stale persistence failure/);
  assert.deepEqual(events, ["issuance-validated", "freshness-validated", "invalidation"]);
  assert.deepEqual(writes, []);
});

test("stale invalidation propagates durable write failures", async () => {
  const context = load(`const RECOVERY_PATH=['data','recovery.json'];\n${staleMarker}`, {
    model: { state: { records: [] }, recovery: {} },
    now: () => "2026-10-17T12:00:00.000Z",
    supervisorWorkbookRecords: () => [],
    writeJson: async () => { throw new Error("synthetic recovery write failure"); },
    readJson: async () => null
  });
  await assert.rejects(context.markSupervisorWorkbookStale("synthetic source import"), /recovery write failure/);
});

test("stale invalidation rejects recovery readback mismatches", async () => {
  const context = load(`const RECOVERY_PATH=['data','recovery.json'];\n${staleMarker}`, {
    model: { state: { records: [] }, recovery: {} },
    now: () => "2026-10-17T12:00:00.000Z",
    supervisorWorkbookRecords: () => [],
    writeJson: async () => {},
    readJson: async () => ({ supervisorWorkbook: { stale: false } })
  });
  await assert.rejects(context.markSupervisorWorkbookStale("synthetic source import"), /read-back verification failed/);
});

const issuanceId = "123e4567-e89b-42d3-a456-426614174000";
function issuedBook(id = issuanceId) { return { SheetNames: ["Synthetic Advisor"], Sheets: { "Synthetic Advisor": { Q1: { v: id } } } }; }

test("returned workbook fails closed when durable recovery is missing", async () => {
  const context = load(issuanceValidation, { readJson: async () => null });
  await assert.rejects(context.validateReturnedWorkbookIssuance(issuedBook()), /recovery data is missing.*Generate a new workbook/);
});

test("returned workbook rejects stale recovery and mismatched issuance", async (t) => {
  const stale = load(issuanceValidation, { readJson: async () => ({ supervisorWorkbook: { stale: true, issuanceId } }) });
  await t.test("stale issuance", async () => assert.rejects(stale.validateReturnedWorkbookIssuance(issuedBook()), /marked stale.*Generate a new workbook/));
  const mismatch = load(issuanceValidation, { readJson: async () => ({ supervisorWorkbook: { stale: false, issuanceId: "123e4567-e89b-42d3-a456-426614174001" } }) });
  await t.test("mismatched issuance", async () => assert.rejects(mismatch.validateReturnedWorkbookIssuance(issuedBook()), /not the latest verified issuance.*Generate a new workbook/));
});

test("legacy returned workbook without issuance field asks the user to regenerate", async () => {
  const context = load(issuanceValidation, { readJson: async () => ({ supervisorWorkbook: { stale: false, issuanceId } }) });
  await assert.rejects(context.validateReturnedWorkbookIssuance(issuedBook("")), /legacy Supervisor Workbook has no issuance ID.*Generate a new workbook/);
});

test("verified revision fallback persists its issuance ID as current durable recovery", async () => {
  const model = { state: { records: [] }, recovery: {} };
  const context = load(`const RECOVERY_PATH=['data','recovery.json'];\n${issuancePersistence}`, {
    model, now: () => "2026-10-17T12:00:00.000Z", writeJson: async () => {},
    readJson: async () => model.recovery
  });
  const record = await context.persistSupervisorWorkbookIssuance("revision.xlsx", issuanceId, { recordCount: 1 });
  assert.equal(record.fileName, "revision.xlsx");
  assert.equal(model.recovery.supervisorWorkbook.issuanceId, issuanceId);
  assert.equal(model.recovery.supervisorWorkbook.stale, false);
});

test("failed issuance recovery verification leaves the in-memory issuance stale", async () => {
  const model = { state: { records: [] }, recovery: {} };
  const context = load(`const RECOVERY_PATH=['data','recovery.json'];\n${issuancePersistence}`, {
    model, now: () => "2026-10-17T12:00:00.000Z", writeJson: async () => {},
    readJson: async () => ({ supervisorWorkbook: { stale: false, issuanceId: "different" } })
  });
  await assert.rejects(context.persistSupervisorWorkbookIssuance("revision.xlsx", issuanceId, { recordCount: 1 }), /read-back verification failed/);
  assert.equal(model.recovery.supervisorWorkbook.stale, true);
});

test("issuance IDs are cryptographic UUID v4 values", () => {
  const source = extract("  function newWorkbookIssuanceId(", "  async function workbookBytes(");
  const context = load(source, { crypto: require("node:crypto").webcrypto });
  const first = context.newWorkbookIssuanceId(), second = context.newWorkbookIssuanceId();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(first, second);
});

test("generated workbook embeds issuance ID in a hidden locked field", async () => {
  const source = [
    "const RETURN_ID_HEADER='__MoonDog RO ID', RETURN_BASELINE_HEADER='__MoonDog Last Update', RETURN_STATUS_ID_HEADER='__MoonDog Status ID', RETURN_ISSUANCE_CELL='Q1';",
    extract("  async function workbookBytes(issuanceId,", "  async function generateWorkbook(")
  ].join("\n");
  let capturedBook;
  const toCell = ({ r, c }) => `${String.fromCharCode(65 + c)}${r + 1}`;
  const context = load(source, {
    model: { state: { records: [{ id: "synthetic-ro", advisorCode: "A", ro: "synthetic", management: {} }] }, settings: { storeName: "Synthetic" } },
    handoffAdvisorName: () => "Synthetic Advisor", workbookSheetName: () => "Synthetic Advisor A", supervisorAdvisorCodes: () => ["A"], ADVISOR_NAMES: { A: "Synthetic Advisor" },
    text: (value) => String(value ?? ""), statusForRecord: () => "Open", normalizeCommunication: () => "", resolveStatusId: () => "",
    protectEditableWorkbook: async (bytes) => bytes,
    validateWorkbookBytes: async (bytes, expectedId) => { assert.equal(expectedId, issuanceId); return {}; },
    XLSX: { utils: {
      book_new: () => ({}),
      json_to_sheet: () => ({ "!ref": "A1:P2" }),
      decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 1, c: 16 } }),
      encode_range: () => "A1:Q2", encode_cell: toCell,
      book_append_sheet: (book, sheet, name) => { book.Sheets ||= {}; book.Sheets[name] = sheet; capturedBook = book; }
    }, write: () => new Uint8Array([1]) }
  });
  const issuanceId = "123e4567-e89b-42d3-a456-426614174000";
  await context.workbookBytes(issuanceId);
  const sheet = capturedBook.Sheets["Synthetic Advisor A"];
  assert.equal(sheet.Q1.v, issuanceId);
  assert.equal(sheet.Q1.s.protection.locked, true);
  assert.equal(sheet["!cols"][16].hidden, true);
  assert.equal(sheet["!protect"].selectLockedCells, true);
});

test("imports and workbook generation serialize through the shared operation lock", async () => {
  const context = load(operationLock, { navigator: { locks: { request: async (_name, _options, operation) => operation() } } });
  const events = [];
  let releaseFirst;
  const first = context.withSupervisorWorkbookLock(async () => {
    events.push("first-start");
    await new Promise((resolve) => { releaseFirst = resolve; });
    events.push("first-end");
  });
  const second = context.withSupervisorWorkbookLock(async () => events.push("second"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["first-start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first-start", "first-end", "second"]);
});

test("workbook operations acquire the browser-wide exclusive lock when available", async () => {
  let request;
  const context = load(operationLock, { navigator: { locks: { request: async (...args) => { request = args.slice(0, 2); return args[2](); } } } });
  assert.equal(await context.withSupervisorWorkbookLock(async () => "locked"), "locked");
  assert.equal(request[0], "moondog-supervisor-workbook");
  assert.equal(request[1].mode, "exclusive");
});

test("workbook operations fail closed when browser-wide locks are unavailable", async () => {
  const context = load(operationLock);
  await assert.rejects(context.withSupervisorWorkbookLock(async () => "unsafe"), /cannot safely serialize Supervisor Workbook operations/);
});

test("public source, returned-workbook, DOCX, and generation operations cannot overlap", async () => {
  const source = [operationLock, publicOperations,
    "async function pause(name) { events.push(name + ':start'); if (name === 'source') await firstGate; events.push(name + ':end'); }",
    "async function importCdkRepairOrdersDocxUnlocked() { return pause('docx'); }",
    "async function importReturnedWorkbookUnlocked() { return pause('returned'); }",
    "async function importSourceUnlocked() { return pause('source'); }",
    "async function generateWorkbookUnlocked() { return pause('generate'); }",
    "globalThis.operations = [() => importSource(), () => importReturnedWorkbook(), () => importCdkRepairOrdersDocx(), () => generateWorkbook()];"
  ].join("\n");
  const events = []; let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; }), context = load(source, {
    events, firstGate,
    navigator: { locks: { request: async (_name, _options, operation) => operation() } }
  });
  const pending = context.operations.map((operation) => operation());
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["source:start"]);
  releaseFirst();
  await Promise.all(pending);
  assert.deepEqual(events, ["source:start", "source:end", "returned:start", "returned:end", "docx:start", "docx:end", "generate:start", "generate:end"]);
});

function statePersistenceFailureHarness() {
  const events = [], initialState = { records: [{ id: "prior" }], closedRecords: [], reviewQueue: [], source: { fileName: "prior.xlsx" }, updatedAt: "prior" };
  const globals = {
    model: { state: initialState, recovery: {} },
    STATE_PATH: ["data", "state.json"],
    ui: { sourceSelect: { value: "synthetic.xlsx" } },
    status() {},
    sourceFileHandle: async () => ({ getFile: async () => ({ lastModified: 0, arrayBuffer: async () => new ArrayBuffer(1) }) }),
    XLSX: {
      read: () => ({ SheetNames: ["Synthetic"], Sheets: { Synthetic: {} } }),
      utils: { sheet_to_json: () => [] }
    },
    workbookHasReturnSchema: () => false,
    legacyReport: () => ({ records: [{ id: "incoming", ro: "synthetic" }], sheetName: "Synthetic", format: "synthetic" }),
    findTable: () => null,
    reconcileRecordSourceIdentity() {},
    now: () => "2026-10-17T12:00:00.000Z",
    stamp: () => "synthetic",
    slug: (value) => value,
    mergeCompleteOpenRoRecords: (records) => ({ records, closedRecords: [], closedCount: 0, reopenedCount: 0 }),
    markSupervisorWorkbookStale: async () => events.push("stale"),
    backupState: async () => events.push("backup"),
    writeBytes: async () => events.push("source-copy"),
    writeJson: async () => { events.push("state"); throw new Error("synthetic state persistence failure"); },
    retainDailyReport: async () => events.push("daily-report"),
    saveOpenRoWorkload: async () => events.push("workload"),
    ensureDailyFocus: async () => events.push("daily-focus"),
    addHistory: async () => events.push("history"),
    renderAll() {},
    docxText: async () => "synthetic docx",
    parseCdkRepairOrdersDocx: () => ({ records: [{ id: "incoming", ro: "synthetic" }], format: "synthetic", summary: {}, validation: {} }),
    coverageTimestamp: () => "",
    internalObservationDate: () => "",
    openRoWorkloadSnapshot: () => ({})
  };
  const context = load(`${sourceImport}\n${cdkImport}\nglobalThis.importSource = importSourceUnlocked; globalThis.importCdk = importCdkRepairOrdersDocxUnlocked;`, globals);
  return { context, events, initialState };
}

test("generic XLSX import keeps in-memory operational state unchanged when state persistence fails", async () => {
  const { context, events, initialState } = statePersistenceFailureHarness();
  await assert.rejects(context.importSource("synthetic.xlsx"), /synthetic state persistence failure/);
  assert.equal(context.model.state, initialState);
  assert.deepEqual(events, ["stale", "backup", "source-copy", "state"]);
});

test("CDK DOCX import keeps in-memory operational state unchanged when state persistence fails", async () => {
  const { context, events, initialState } = statePersistenceFailureHarness();
  await assert.rejects(context.importCdk({ name: "synthetic.docx" }, new ArrayBuffer(1)), /synthetic state persistence failure/);
  assert.equal(context.model.state, initialState);
  assert.deepEqual(events, ["stale", "backup", "state"]);
});

test("returned workbook keeps advisor commitments unchanged when state persistence fails", async () => {
  const events = [], record = {
    id: "synthetic-ro", ro: "RO-SYNTHETIC", management: {
      statusId: "waiting", status: "Waiting", nextAction: "Prior action", reviewDate: "2026-10-20",
      communication: "Not contacted", owner: "Synthetic advisor", note: "Prior note", updatedAt: "baseline"
    }
  };
  const initialState = { records: [record], reviewQueue: [], updatedAt: "prior" };
  const row = {
    "__MoonDog RO ID": record.id, RO: record.ro, "Management status": "In Progress",
    "__MoonDog Status ID": "working", "Next action": "New action", "Commitment date": "2026-10-22",
    "Customer communication": "Contacted", Owner: "Synthetic advisor", "Update note": "New note",
    "__MoonDog Last Update": "baseline"
  };
  const context = load(`${returnedImport}\nglobalThis.importReturned = importReturnedWorkbookUnlocked;`, {
    model: { state: initialState, recovery: {} },
    STATE_PATH: ["data", "state.json"],
    RETURN_ID_HEADER: "__MoonDog RO ID",
    RETURN_BASELINE_HEADER: "__MoonDog Last Update",
    RETURN_STATUS_ID_HEADER: "__MoonDog Status ID",
    ui: { sourceSelect: { value: "synthetic-return.xlsx" } }, status() {},
    sourceFileHandle: async () => ({ getFile: async () => ({ arrayBuffer: async () => new ArrayBuffer(1) }) }),
    XLSX: { read: () => ({ SheetNames: ["Synthetic Advisor"], Sheets: { "Synthetic Advisor": {} } }), utils: { sheet_to_json: () => [row] } },
    workbookHasReturnSchema: () => true,
    validateReturnedWorkbookIssuance: async () => {},
    validateReturnedWorkbookFreshness() {},
    markSupervisorWorkbookStale: async () => events.push("stale"),
    backupState: async () => events.push("backup"),
    writeJson: async () => { events.push("state"); throw new Error("synthetic state persistence failure"); },
    addHistory: async () => events.push("history"),
    generateWorkbookUnlocked: async () => events.push("workbook"),
    renderAll() {},
    text: (value) => String(value ?? ""),
    now: () => "2026-10-17T12:00:00.000Z",
    resolveStatusId: (status, hidden) => hidden || status,
    statusById: (id) => ({ name: id === "working" ? "In Progress" : id }),
    workbookDate: (value) => value,
    normalizeCommunication: (value) => value,
    COMMUNICATION_STATUSES: ["Contacted", "Not contacted"],
    isClosedManagement: () => false
  });
  await assert.rejects(context.importReturned("synthetic-return.xlsx"), /synthetic state persistence failure/);
  assert.equal(context.model.state, initialState);
  assert.equal(record.management.nextAction, "Prior action");
  assert.equal(record.management.reviewDate, "2026-10-20");
  assert.deepEqual(events, ["stale", "backup", "state"]);
});
