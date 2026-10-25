"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function extract(source, first, last) {
  const start = source.indexOf(first);
  assert.ok(start >= 0, "Missing production boundary: " + first);
  const end = source.indexOf(last, start + first.length);
  assert.ok(end > start, "Missing production boundary: " + last);
  return source.slice(start, end);
}
const connectionCore = extract(app, "  let workspaceConnectionBusy=false;", "  async function connect() {");
const restoreConnection = extract(app, "  async function restoreConnection() {", "  function headerMap(");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
function percentile(samples, p) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

async function measureReconnect(readDelayMs, permissionResults = ["granted"], inspectPendingRead = false) {
  const permissionSequence = [...permissionResults];
  let permissionIndex = 0;
  const handle = {
    name: "Synthetic Workspace",
    kind: "directory",
    queryPermission: async () => "granted"
  };
  const paths = {
    settings: "settings.json",
    adapter: "source-adapter-bootstrap.json",
    state: "state.json",
    appointments: "appointments.json",
    performance: "performance.json",
    metrics: "operational-metrics.json",
    meeting: "meeting-cycle.json",
    assignNext: "assign-next.json",
    autoImport: "auto-import.json",
    recovery: "recovery.json"
  };
  const fixture = {
    [paths.settings]: {
      schemaVersion: 5,
      sourceAdapters: { schemaVersion: 1, key: "synthetic" },
      advisors: {},
      setup: { completedAt: "synthetic" },
      openRo: { managementStatuses: [] }
    },
    [paths.state]: {
      records: [{ id: "synthetic-ro-1", ro: "SYN-001", customer: "Synthetic Customer" }],
      closedRecords: [],
      source: null
    },
    [paths.appointments]: { snapshots: {} },
    [paths.performance]: { snapshots: {} },
    [paths.metrics]: {},
    [paths.meeting]: {},
    [paths.assignNext]: { schemaVersion: 3, days: {}, currentOpenRo: { synthetic: true } },
    [paths.autoImport]: { seen: {} },
    [paths.recovery]: {}
  };
  const model = {
    root: null, pendingRoot: null, applicationRoot: null,
    workspaceConnectionCommittedRoot: null,
    state: { records: [], closedRecords: [] }, appointments: {},
    performance: {}, operationalMetrics: {}, meetingCycle: {},
    assignNext: {}, autoImport: {}, recovery: {}, settings: {}
  };
  const states = [];
  const completedReads = new Set();
  const requiredReadPaths = [paths.settings, paths.state, paths.appointments, paths.performance, paths.metrics, paths.meeting, paths.assignNext, paths.autoImport, paths.recovery];
  const connectedSnapshots = [];
  let signalFirstReadStarted;
  const firstReadStarted = new Promise(resolve => { signalFirstReadStarted = resolve; });
  let releaseFirstRead;
  const firstReadGate = inspectPendingRead ? new Promise(resolve => { releaseFirstRead = resolve; }) : Promise.resolve();
  let firstReadWasObserved = false;
  let activeReadCount = 0;
  let maxConcurrentReadCount = 0;
  const events = [];
  const writes = [];
  const backgroundJobs = [];
  const firstRender = { at: null, loadedRecordId: null, count: 0 };
  const ui = {
    homeConnect: { textContent: "", hidden: false },
    "view-home": { classList: { contains: value => value === "active" } }
  };
  for (const id of ["scanFiles", "refreshAppointmentFiles", "refreshPerformanceFiles", "pinMeetingVoice", "clearMeetingVoice"]) {
    ui[id] = { disabled: true };
  }

  const context = vm.createContext({
    model,
    writeAuthority: { canWrite: true, async validate() {}, disable() { this.canWrite = false; } },
    VERSION: "0.10.18-beta.synthetic",
    folderWatch: { busy: false },
    stopFolderWatch: () => {},
    dailyImportBusy: false,
    appointmentImportBusy: false,
    window: { showDirectoryPicker() {}, indexedDB: {} },
    recallRoot: async () => handle,
    permission: async () => permissionSequence[permissionIndex++] || "granted",
    operationalRoot: async root => root,
    wrapOperationalRoot: root => root,
    connectedNativeRoot: null,
    document: { dispatchEvent: event => events.push(event.type) },
    Event: class { constructor(type) { this.type = type; } },
    ui,
    SETTINGS_PATH: paths.settings,
    SOURCE_ADAPTER_BOOTSTRAP_PATH: paths.adapter,
    STATE_PATH: paths.state,
    APPOINTMENTS_PATH: paths.appointments,
    PERFORMANCE_PATH: paths.performance,
    OPERATIONAL_METRICS_PATH: paths.metrics,
    MEETING_CYCLE_PATH: paths.meeting,
    ASSIGN_NEXT_PATH: paths.assignNext,
    AUTO_IMPORT_PATH: paths.autoImport,
    RECOVERY_PATH: paths.recovery,
    rememberRoot: async () => {},
    initializeFolders: async () => {},
    recordDiagnostic: () => {},
    readJson: async (key, fallback) => {
      activeReadCount += 1;
      maxConcurrentReadCount = Math.max(maxConcurrentReadCount, activeReadCount);
      try {
        if (inspectPendingRead && key === paths.state && !firstReadWasObserved) {
          firstReadWasObserved = true;
          signalFirstReadStarted();
          await firstReadGate;
        }
        await new Promise(resolve => setTimeout(resolve, readDelayMs));
        completedReads.add(key);
        return clone(Object.prototype.hasOwnProperty.call(fixture, key) ? fixture[key] : fallback);
      } finally {
        activeReadCount -= 1;
      }
    },
    writeJson: async (key, value) => {
      writes.push({ key, value: clone(value) });
      fixture[key] = clone(value);
    },
    setConnectionState: state => {
      states.push(state);
      if (state === "CONNECTED") connectedSnapshots.push([...completedReads]);
    },
    pruneClosedRecords: rows => rows,
    normalizeControllableVinCounts: () => false,
    loadSourceAdapter: () => {},
    clearSourceAdapter: () => {},
    migratedSettings: settings => settings,
    reconcileOpenRoSourceIdentities: () => false,
    normalizeOperationalCoverage: () => false,
    openRoWorkloadSnapshot: () => ({ rows: [] }),
    saveOpenRoWorkload: async () => {},
    storeDateKey: () => "2026-10-23",
    renderSettings: () => {},
    openSetupIfRequired: () => {},
    postConnectReconciliation: undefined,
    renderAll: () => {
      firstRender.count += 1;
      if (firstRender.at === null) {
        firstRender.at = performance.now();
        firstRender.loadedRecordId = model.state.records[0]?.id || null;
      }
    },
    renderRecovery: () => {},
    startFolderWatch: () => {},
    setTimeout: (callback, delay) => {
      if (delay === 1200) {
        backgroundJobs.push(callback);
        return 1;
      }
      return setTimeout(callback, delay);
    },
    now: () => "2026-10-23T12:00:00.000Z",
    Promise, Map, Set, Object, Array, String, Boolean, Number, JSON, Error, console,
    structuredClone
  });

  vm.runInContext(
    connectionCore + "\n" + restoreConnection + "\nthis.restore=restoreConnection;",
    context
  );
  const started = performance.now();
  if (inspectPendingRead) {
    const reconnecting = context.restore();
    await firstReadStarted;
    await new Promise(resolve => setTimeout(resolve, readDelayMs * 6 + 2));
    assert.equal(model.state.records.length, 0,
      "completed parallel reads must not expose partial snapshots while the state read is pending");
    assert.equal(model.root, handle, "The candidate root may be staged while its reads are pending");
    assert.notEqual(model.workspaceConnectionCommittedRoot, model.root,
      "the staged candidate must not become the committed Workspace root before hydration completes");
    assert.equal(model.workspaceConnectionCommittedRoot, null,
      "connection readiness must stay uncommitted while an authoritative read is pending");
    assert.ok(!states.includes("CONNECTED"), "CONNECTED must not be published while an authoritative read is pending");
    assert.equal(firstRender.count, 0, "Home must not render before authoritative reads finish");
    releaseFirstRead();
    await reconnecting;
  } else {
    await context.restore();
  }
  if (permissionResults.includes("denied")) {
    assert.ok(states.includes("PERMISSION REQUIRED"),
      "a denied saved-folder permission attempt must report PERMISSION REQUIRED before retry");
  }
  if (states.includes("PERMISSION REQUIRED")) {
    assert.equal(connectedSnapshots.length, 0, "denied saved-folder access must not publish CONNECTED");
    assert.equal(completedReads.size, 0, "denied saved-folder access must not read operational snapshots");
    assert.equal(writes.length, 0, "denied saved-folder access must not write operational state");
    assert.equal(model.root, null, "denied access must not commit a Workspace root");
    assert.equal(model.pendingRoot, handle, "the saved folder remains available for explicit retry");
    await context.restore();
  }
  const finished = performance.now();

  assert.equal(maxConcurrentReadCount, 3,
    "the production reconnect path must use its three-read concurrency bound");
  assert.ok(states.includes("CONNECTED"), "the production reconnect path must reach CONNECTED");
  assert.equal(connectedSnapshots.length, 1, "the synthetic reconnect should publish readiness once");
  assert.deepEqual([...connectedSnapshots[0]].sort(), [...requiredReadPaths].sort(),
    "CONNECTED must follow every essential settings, state, report, and recovery read");
  assert.equal(model.workspaceConnectionCommittedRoot, model.root,
    "connected state must be committed only after authoritative reads finish");
  assert.equal(firstRender.loadedRecordId, "synthetic-ro-1",
    "first Home render must see the synthetic durable state, not an empty or stale placeholder");
  assert.ok(firstRender.at >= started && firstRender.at <= finished,
    "the first Home render must occur within the measured reconnect interval");
  assert.ok(firstRender.count >= 1, "the reconnect must render Home");
  assert.deepEqual(events, ["moondog-workspace-changing"]);
  assert.equal(writes.length, 1, "only the synthetic recovery-ready marker may be written");
  assert.equal(writes[0].key, paths.recovery, "reconnect must not rewrite operational source/state files");
  assert.equal(backgroundJobs.length, 1, "post-connection scans must be deferred after the first render");
  return {
    firstHomeMs: firstRender.at - started,
    totalReconnectMs: finished - started,
    maxConcurrentReadCount
  };
}

test("saved-folder reconnect retries safely after synthetic permission denial", async () => {
  const measured = await measureReconnect(2, ["denied", "granted"]);
  assert.ok(Number.isFinite(measured.firstHomeMs) && measured.firstHomeMs > 0);
  assert.ok(Number.isFinite(measured.totalReconnectMs) && measured.totalReconnectMs >= measured.firstHomeMs);
});

test("production reconnect keeps the Workspace uncommitted until an authoritative read resolves", async () => {
  const measured = await measureReconnect(2, ["granted"], true);
  assert.ok(Number.isFinite(measured.firstHomeMs) && measured.firstHomeMs > 0);
});

test("synthetic reconnect uses a bounded snapshot-read batch and reaches usable Home", async () => {
  const samples = [];
  const total = [];
  const concurrency = [];
  for (let sample = 0; sample < 9; sample += 1) {
    const measured = await measureReconnect(2);
    samples.push(measured.firstHomeMs);
    total.push(measured.totalReconnectMs);
    concurrency.push(measured.maxConcurrentReadCount);
  }

  const boundedBatch = {
    scenario: "production saved-folder reconnect core; synthetic in-memory handles; 2 ms per essential JSON read; bounded parallel reads; no OneDrive/device claim",
    samples: samples.map(value => Number(value.toFixed(2))),
    maxConcurrentSnapshotReads: Math.max(...concurrency),
    firstUsableHomeMs: {
      p50: Number(percentile(samples, 0.5).toFixed(2)),
      p95: Number(percentile(samples, 0.95).toFixed(2))
    },
    totalReconnectMs: {
      p50: Number(percentile(total, 0.5).toFixed(2)),
      p95: Number(percentile(total, 0.95).toFixed(2))
    }
  };
  console.log("Synthetic connection-to-Home bounded-batch result", JSON.stringify(boundedBatch));
  assert.ok(Number.isFinite(boundedBatch.firstUsableHomeMs.p50) && boundedBatch.firstUsableHomeMs.p50 > 0);
  assert.ok(Number.isFinite(boundedBatch.firstUsableHomeMs.p95) && boundedBatch.firstUsableHomeMs.p95 >= boundedBatch.firstUsableHomeMs.p50);
});
