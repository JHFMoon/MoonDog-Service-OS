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
  const timers = new Map(), validations = [];
  let timerId = 0;
  const context = vm.createContext({
    connectedNativeRoot: rootA,
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
    setConnectionState() {},
    status() {}
  });
  vm.runInContext(gate + revalidation +
    "\nthis.schedule = scheduleAuthorityRevalidation; this.connect = finishConnection;", context);
  async function tick() {
    const [id, {callback}] = timers.entries().next().value;
    timers.delete(id);
    return callback();
  }
  return {rootA, rootB, timers, validations, context, tick};
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
