"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function extract(text, first, last) {
  const start = text.indexOf(first);
  assert.ok(start >= 0, "Missing production entry: " + first);
  const end = text.indexOf(last, start + first.length);
  assert.ok(end > start, "Missing production boundary: " + last);
  return text.slice(start, end);
}
const transientClassifier = extract(app, "  function transientWorkspaceState(error){", "\n  function transientIntakeError(");
const connectionCore = transientClassifier + "\nfunction scheduleSavedConnectionRetry(){}\n" + extract(app, "  let workspaceConnectionBusy=false;", "  async function connect() {");
const restoreConnection = "function scheduleSavedConnectionRetry(){}\n" + extract(app, "  async function restoreConnection() {", "  function headerMap(");
const connectionStart = app.indexOf("    const connectedRoot=model.root;");
const connectionEnd = app.indexOf("\n  }\n  async function postConnectReconciliation(", connectionStart);
assert.ok(connectionStart >= 0 && connectionEnd > connectionStart);
const postConnectionJobs = app.slice(connectionStart, connectionEnd);

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("delayed essential hydration keeps startup uncommitted, responsive, and retryable after read failure", async () => {
  const handle = { name: "Synthetic Workspace", kind: "directory", queryPermission: async () => "granted" };
  const statePath = ["data", "state.json"];
  const settingsPath = ["data", "settings.json"];
  const adapterPath = ["data", "source-adapter-bootstrap.json"];
  const started = deferred();
  const hydration = deferred();
  const states = [];
  const events = [];
  const restoreErrors = [];
  const model = {
    root: null, pendingRoot: null, applicationRoot: null, workspaceConnectionCommittedRoot: null,
    state: { records: [{ customer: "Synthetic stale value" }], closedRecords: [] },
    recovery: {}
  };
  const authority = {
    canWrite: true, disableCount: 0,
    async validate() {},
    disable() { this.disableCount += 1; this.canWrite = false; }
  };
  const context = vm.createContext({
    model, writeAuthority: authority, VERSION: "0.10.17",
    folderWatch: { busy: false }, dailyImportBusy: false, appointmentImportBusy: false,
    window: { showDirectoryPicker() {}, indexedDB: {} },
    recallRoot: async () => handle,
    permission: async () => "granted",
    operationalRoot: async root => root,
    wrapOperationalRoot: root => root,
    connectedNativeRoot: null,
    document: { dispatchEvent: event => events.push(event.type) },
    Event: class { constructor(type) { this.type = type; } },
    ui: { homeConnect: { textContent: "", hidden: false } },
    SETTINGS_PATH: settingsPath,
    SOURCE_ADAPTER_BOOTSTRAP_PATH: adapterPath,
    STATE_PATH: statePath,
    APPOINTMENTS_PATH: ["data", "appointments.json"],
    PERFORMANCE_PATH: ["data", "performance.json"],
    OPERATIONAL_METRICS_PATH: ["data", "operational-metrics.json"],
    MEETING_CYCLE_PATH: ["data", "meeting-cycle.json"],
    ASSIGN_NEXT_PATH: ["data", "assign-next.json"],
    AUTO_IMPORT_PATH: ["data", "auto-import.json"],
    RECOVERY_PATH: ["data", "recovery.json"],
    rememberRoot: async () => {},
    initializeFolders: async () => {},
    recordDiagnostic: async () => {},
    readJson: async (candidate, fallback) => {
      if (candidate === statePath) {
        started.resolve();
        return hydration.promise;
      }
      if (candidate === settingsPath) return {};
      if (candidate === adapterPath) return null;
      return fallback;
    },
    writeJson: async () => {},
    setConnectionState: (state, message) => states.push({ state, message }),
    console: { error(error) { restoreErrors.push(String(error?.stack || error)); } }
  });

  vm.runInContext(connectionCore + "\n" + restoreConnection + "\nthis.restoreConnection = restoreConnection;", context);
  const reconnect = context.restoreConnection();
  const startOutcome = await Promise.race([
    started.promise.then(() => "hydrating"),
    reconnect.then(() => "settled")
  ]);
  assert.equal(startOutcome, "hydrating", "Connection failed before essential-state hydration: " + restoreErrors.join("\n"));

  let eventLoopServiced = false;
  await new Promise(resolve => setImmediate(() => { eventLoopServiced = true; resolve(); }));
  assert.equal(eventLoopServiced, true, "The delayed durable read must yield to other queued work.");
  assert.equal(model.root, handle, "The candidate root may be staged while hydration is pending.");
  assert.equal(model.workspaceConnectionCommittedRoot, null, "Pending hydration must not publish a connected root.");
  assert.equal(states.some(item => item.state === "CONNECTED"), false);

  hydration.reject(Object.assign(new Error("Synthetic online-only file hydration delay"), { name: "NotReadableError" }));
  await reconnect;

  assert.equal(model.root, null, "Failed startup must not retain the candidate as the active root.");
  assert.equal(model.pendingRoot, handle, "The saved handle remains available for retry.");
  assert.equal(model.workspaceConnectionCommittedRoot, null);
  assert.equal(authority.canWrite, false, "A failed essential read must revoke write authority.");
  assert.equal(authority.disableCount, 1);
  assert.equal(states.at(-1).state, "CONNECTION ERROR");
  assert.match(states.at(-1).message, /could not restore/i);
  assert.equal(states.some(item => item.state === "CONNECTED"), false);
  assert.ok(events.includes("moondog-workspace-changing"));
});

test("post-connection maintenance yields between serialized jobs and continues after an isolated failure", async () => {
  const root = { name: "Synthetic Workspace" };
  const order = [];
  const diagnostics = [];
  let scheduledStart = null;
  let heartbeatTicks = 0;
  let active = 0;
  let maxActive = 0;
  const run = name => async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    order.push(name);
    try {
      await new Promise(resolve => setImmediate(resolve));
      if (name === "Month-end summary") throw new Error("Synthetic job failure");
    } finally {
      active -= 1;
    }
  };
  const context = vm.createContext({
    model: { root },
    permissionWasPending: false,
    workspaceConnectionBusy: false,
    postConnectionScanBusy: false,
    writeAuthority: { canWrite: true },
    renderRecovery() {},
    folderWatchScan: run("Report inbox"),
    ensurePreviousMonthSummary: run("Month-end summary"),
    ensureDailyFocus: run("Daily focus"),
    scanAppointmentFiles: run("Appointment sources"),
    scanPerformanceFiles: run("Performance sources"),
    ensureMeetingCycleBaseline: run("Meeting baseline"),
    scanRecoveryBackups: run("Recovery backups"),
    runVerifiedUpdateFollowup: run("Verified update follow-up"),
    recordDiagnostic: (kind, message) => diagnostics.push({ kind, message }),
    setTimeout: (callback, delay) => {
      if (delay === 1200) {
        scheduledStart = callback;
        return 1;
      }
      if (delay === 350) {
        setImmediate(() => { heartbeatTicks += 1; callback(); });
        return 2;
      }
      return setImmediate(callback);
    },
    setImmediate
  });

  vm.runInContext(postConnectionJobs, context);
  assert.equal(typeof scheduledStart, "function", "Post-connection work is deferred until after first render.");
  await scheduledStart();

  assert.deepEqual(order, [
    "Report inbox", "Month-end summary", "Daily focus", "Appointment sources",
    "Performance sources", "Meeting baseline", "Recovery backups", "Verified update follow-up"
  ]);
  assert.equal(maxActive, 1, "Background jobs must stay serialized.");
  assert.equal(heartbeatTicks, order.length, "The event loop gets a yield before each background job.");
  assert.equal(active, 0);
  assert.ok(diagnostics.some(item => item.kind === "POST-CONNECTION SCAN" && /Month-end summary/.test(item.message)));
  assert.ok(diagnostics.some(item => item.kind === "FOLDER CONNECTION"));
});

test("overlapping Workspace connection attempts are rejected and retry is allowed after settle", async () => {
  const appText = app;
  const connectionLock = extract(
    appText,
    "  let workspaceConnectionBusy=false;",
    "  async function completeWorkspaceConnection("
  );
  const pending = deferred();
  let calls = 0;
  const context = vm.createContext({
    completeWorkspaceConnection: () => {
      calls += 1;
      return calls === 1 ? pending.promise : Promise.resolve("retry completed");
    }
  });
  vm.runInContext(connectionLock + "\nthis.finishConnection=finishConnection;", context);

  const first = context.finishConnection({ name: "Synthetic Workspace A" }, false);
  await Promise.resolve();
  await assert.rejects(
    context.finishConnection({ name: "Synthetic Workspace B" }, true),
    error => error && error.code === "WORKSPACE_CONNECTION_BUSY"
  );
  assert.equal(calls, 1, "A second picker cannot start a competing connection.");

  pending.resolve("first completed");
  assert.equal(await first, "first completed");
  assert.equal(
    await context.finishConnection({ name: "Synthetic Workspace B" }, true),
    "retry completed",
    "The guard releases after the first connection settles."
  );
  assert.equal(calls, 2);
});


test("failed delayed manual hydration clears the uncommitted root and keeps the handle retryable", async () => {
  const handle = { name: "Synthetic selected Workspace", kind: "directory" };
  const states = [];
  let failHydration = true;
  const model = {
    root: null, pendingRoot: null, applicationRoot: null,
    workspaceConnectionCommittedRoot: null
  };
  const authority = { canWrite: true, disable() { this.canWrite = false; } };
  const context = vm.createContext({
    model,
    writeAuthority: authority,
    folderWatch: { busy: false },
    dailyImportBusy: false,
    appointmentImportBusy: false,
    window: { showDirectoryPicker: async () => handle },
    permission: async () => "granted",
    connectedNativeRoot: null,
    __moondogDailyUI: { confirmWorkspaceChange: () => true },
    setConnectionState: (state, message) => states.push({ state, message }),
    completeWorkspaceConnection: async candidate => {
      model.root = { candidate };
      model.applicationRoot = candidate;
      model.pendingRoot = null;
      context.connectedNativeRoot = candidate;
      await new Promise(resolve => setImmediate(resolve));
      if (failHydration) throw Object.assign(new Error("Synthetic delayed essential-state read failed"), { name: "NotReadableError" });
      model.workspaceConnectionCommittedRoot = model.root;
      return "connected";
    },
    setImmediate
  });
  const connectionLock = extract(app, "  let workspaceConnectionBusy=false;", "  async function completeWorkspaceConnection(");
  const connectFunction = extract(app, "  async function connect() {", "  async function restoreConnection()");
  vm.runInContext(connectionLock + "\n" + connectFunction + "\nthis.connectWorkspace = connect;", context);

  await assert.rejects(context.connectWorkspace(), error => error?.name === "NotReadableError");
  assert.equal(model.root, null, "A failed candidate must not remain the active Workspace root.");
  assert.equal(model.applicationRoot, null);
  assert.equal(context.connectedNativeRoot, null);
  assert.equal(model.workspaceConnectionCommittedRoot, null);
  assert.equal(model.pendingRoot, handle, "The selected handle must remain available for an explicit retry.");
  assert.equal(authority.canWrite, false, "A failed essential read must leave writes disabled.");
  assert.equal(states.at(-1).state, "CONNECTION ERROR");

  await assert.rejects(context.connectWorkspace(), error => error?.name === "NotReadableError");
  assert.equal(model.root, null, "A repeated retry failure must not leave a staged root active.");
  assert.equal(model.applicationRoot, null);
  assert.equal(context.connectedNativeRoot, null);
  assert.equal(model.workspaceConnectionCommittedRoot, null);
  assert.equal(model.pendingRoot, handle);
  assert.equal(authority.canWrite, false);

  failHydration = false;
  assert.equal(await context.connectWorkspace(), "connected");
  assert.equal(model.workspaceConnectionCommittedRoot, model.root);
  assert.equal(model.pendingRoot, null);
});
