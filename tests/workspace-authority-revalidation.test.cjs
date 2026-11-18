"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function extract(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, "Production source exists: " + start);
  return app.slice(from, to);
}
const gate = extract("  let workspaceConnectionBusy=false;", "  async function completeWorkspaceConnection(");
const revalidation = extract("  let authorityRevalidationTimer=null", '  window.addEventListener("focus"');

function defer() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return {promise, release};
}

function fixture() {
  const rootA = {name: "Synthetic A"}, rootB = {name: "Synthetic B"};
  const timers = new Map(), validations = [], states = [];
  let timerId = 0;
  const context = vm.createContext({
    connectedNativeRoot: rootA,
    model: {connectionState: "CONNECTED", root: {async isSameEntry(workspace) { return workspace === context.connectedNativeRoot; }}},
    operationalRoot: async root => root,
    offerReplacementForSavedFolder: () => {
      context.model.connectionState = "SAVED HANDLE UNAVAILABLE";
      states.push(context.model.connectionState);
    },
    writeAuthority: {
      reason: "PERMISSION_REQUIRED", canWrite: false,
      validate: async root => { validations.push(root); return false; }
    },
    completeWorkspaceConnection: async selected => { context.connectedNativeRoot = selected; },
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, {callback, delay});
      return id;
    },
    clearTimeout: id => timers.delete(id),
    renderSetup() {},
    startFolderWatch() {},
    setConnectionState: state => { context.model.connectionState = state; states.push(state); },
    status() {}
  });
  vm.runInContext(gate + revalidation +
    "\nthis.schedule = scheduleAuthorityRevalidation; this.connect = finishConnection;", context);
  async function tick() {
    const [id, {callback}] = timers.entries().next().value;
    timers.delete(id);
    return callback();
  }
  return {rootA, rootB, timers, validations, states, context, tick};
}

test("a saved-root revalidation cannot start during a different Workspace connection", async () => {
  const f = fixture();
  const connection = defer(), started = defer();
  f.context.schedule(f.rootA);
  f.context.completeWorkspaceConnection = async selected => {
    started.release();
    await connection.promise;
    f.context.connectedNativeRoot = selected;
    f.context.schedule(selected);
  };
  const switching = f.context.connect(f.rootB, false);
  await started.promise;
  await f.tick();
  assert.deepEqual(f.validations, []);
  connection.release();
  await switching;
  assert.equal(f.timers.size, 1);
  await f.tick();
  assert.deepEqual(f.validations, [f.rootB]);
});

test("a connection cannot replace the root during write revalidation", async () => {
  const f = fixture();
  const validation = defer();
  f.context.writeAuthority.validate = async root => {
    f.validations.push(root);
    return validation.promise;
  };
  f.context.schedule(f.rootA);
  const checking = f.tick();
  await assert.rejects(f.context.connect(f.rootB, false), {code: "WORKSPACE_CONNECTION_BUSY"});
  assert.equal(f.context.connectedNativeRoot, f.rootA);
  validation.release(false);
  await checking;
  await f.context.connect(f.rootB, false);
  assert.equal(f.context.connectedNativeRoot, f.rootB);
});

test("a new Workspace gets its own revalidation timer and retry budget", async () => {
  const f = fixture();
  f.context.schedule(f.rootA);
  await f.tick();
  assert.equal([...f.timers.values()][0].delay, 2500);
  await f.context.connect(f.rootB, false);
  f.context.schedule(f.rootB);
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].delay, 1200);
  await f.tick();
  assert.deepEqual(f.validations, [f.rootA, f.rootB]);
});

test("automatic write revalidation stops before the validator when the Workspace has disappeared", async () => {
  const f = fixture();
  f.context.operationalRoot = async () => {
    throw Object.assign(Error("Synthetic Workspace is missing"), {name: "NotFoundError"});
  };
  f.context.schedule(f.rootA);
  await f.tick();
  assert.deepEqual(f.validations, []);
  assert.deepEqual(f.states, ["SAVED HANDLE UNAVAILABLE"]);
  f.context.schedule(f.rootA, true);
  assert.equal(f.timers.size, 0);
});

test("a different Workspace at the saved location cannot acquire write authority automatically", async () => {
  const f = fixture();
  f.context.operationalRoot = async () => f.rootB;
  f.context.schedule(f.rootA);
  await f.tick();
  assert.deepEqual(f.validations, []);
  assert.deepEqual(f.states, ["SAVED HANDLE UNAVAILABLE"]);
  f.context.schedule(f.rootA, true);
  assert.equal(f.timers.size, 0);
});

test("an interrupted Fresh hold stops automatic write revalidation before initialization", async () => {
  const f = fixture();
  f.context.operationalRoot = async () => {
    throw Object.assign(Error("Synthetic Fresh hold"), {code: "FRESH_RESET_INCOMPLETE"});
  };
  f.context.schedule(f.rootA);
  await f.tick();
  assert.deepEqual(f.validations, []);
  assert.deepEqual(f.states, ["CONNECTION ERROR"]);
  assert.equal(f.context.model.pendingRoot, f.rootA);
  assert.equal(f.context.model.freshResetRecoveryRoot, f.rootA);
  assert.equal(f.timers.size, 0);
});

test("temporary Workspace read failure retries read-only proof before enabling editing", async () => {
  const f = fixture();
  let reads = 0;
  f.context.operationalRoot = async root => {
    if (++reads === 1) throw Object.assign(Error("Synthetic temporary read failure"), {name: "NotReadableError"});
    return root;
  };
  f.context.schedule(f.rootA);
  await f.tick();
  assert.deepEqual(f.validations, []);
  assert.equal([...f.timers.values()][0].delay, 2500);
  await f.tick();
  assert.deepEqual(f.validations, [f.rootA]);
});

test("read-only proof from a superseded Workspace cannot reach the write validator", async () => {
  const f = fixture();
  const read = defer();
  f.context.operationalRoot = async () => read.promise;
  f.context.schedule(f.rootA);
  const checking = f.tick();
  f.context.model.root = { async isSameEntry() { return true; } };
  f.context.connectedNativeRoot = f.rootB;
  read.release(f.rootA);
  await checking;
  assert.deepEqual(f.validations, []);
  assert.deepEqual(f.states, []);
});

test("permission recovery keeps the committed Workspace and draft when access returns", async () => {
  const f = fixture();
  const originalWorkspace = f.context.model.root;
  const draft = { note: "Synthetic unsaved update" };
  Object.assign(f.context.model, {
    pendingRoot: f.rootA,
    workspaceConnectionCommittedRoot: originalWorkspace,
    connectionState: "PERMISSION REQUIRED",
    localDraft: draft
  });
  f.context.writeAuthority.reason = "NO_WORKSPACE";
  f.context.completeWorkspaceConnection = () => { throw Error("Automatic recovery must not reload the Workspace"); };
  let reads = 0, watchStarts = 0;
  f.context.operationalRoot = async root => {
    if (++reads === 1) throw Object.assign(Error("Synthetic permission unavailable"), {name: "NotAllowedError"});
    return root;
  };
  f.context.writeAuthority.validate = async (root, ask) => {
    assert.equal(root, f.rootA);
    assert.equal(ask, false);
    f.validations.push(root);
    f.context.writeAuthority.canWrite = true;
    return true;
  };
  f.context.startFolderWatch = () => { watchStarts++; };
  f.context.schedule(f.rootA);
  assert.equal(f.timers.size, 1);
  await f.tick();
  assert.equal(f.context.model.connectionState, "PERMISSION REQUIRED");
  assert.deepEqual(f.validations, []);
  await f.tick();
  assert.deepEqual(f.validations, [f.rootA]);
  assert.equal(f.context.model.connectionState, "CONNECTED");
  assert.equal(f.context.model.pendingRoot, null);
  assert.equal(f.context.model.root, originalWorkspace);
  assert.equal(f.context.model.localDraft, draft);
  assert.equal(watchStarts, 1);
});

test("automatic permission recovery ignores a different pending handle", async () => {
  const f = fixture();
  Object.assign(f.context.model, {
    pendingRoot: f.rootB,
    workspaceConnectionCommittedRoot: f.context.model.root,
    connectionState: "PERMISSION REQUIRED"
  });
  f.context.schedule(f.rootA, true);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.validations, []);
});

test("permission recovery stops if validation finds a controlled recovery hold", async () => {
  const f = fixture();
  Object.assign(f.context.model, {
    pendingRoot: f.rootA,
    workspaceConnectionCommittedRoot: f.context.model.root,
    connectionState: "PERMISSION REQUIRED"
  });
  f.context.writeAuthority.reason = "NO_WORKSPACE";
  f.context.writeAuthority.validate = async root => {
    f.validations.push(root);
    f.context.writeAuthority.reason = "INTERRUPTED_RESTORE";
    return false;
  };
  f.context.schedule(f.rootA);
  await f.tick();
  assert.deepEqual(f.validations, [f.rootA]);
  assert.equal(f.context.model.connectionState, "CONNECTED", "read-only recovery guidance becomes available");
  assert.equal(f.context.model.pendingRoot, f.rootA);
  f.context.schedule(f.rootA, true);
  assert.equal(f.timers.size, 0);
});

test("permission recovery keeps manual Restore available after exhausting retries", async () => {
  const f = fixture();
  Object.assign(f.context.model, {
    pendingRoot: f.rootA,
    workspaceConnectionCommittedRoot: f.context.model.root,
    connectionState: "PERMISSION REQUIRED"
  });
  let reads = 0;
  f.context.writeAuthority.reason = "NO_WORKSPACE";
  f.context.operationalRoot = async () => {
    reads++;
    throw Object.assign(Error("Synthetic permission unavailable"), {name: "NotAllowedError"});
  };
  f.context.schedule(f.rootA);
  for (let i = 0; i < 5; i++) await f.tick();
  assert.equal(reads, 5);
  assert.deepEqual(f.validations, []);
  assert.equal(f.timers.size, 0);
  assert.equal(f.context.model.connectionState, "PERMISSION REQUIRED");
  assert.equal(f.context.model.pendingRoot, f.rootA);
});
