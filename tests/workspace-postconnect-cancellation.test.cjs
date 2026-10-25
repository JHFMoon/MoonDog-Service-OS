"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("    const connectedRoot=model.root;");
const end = app.indexOf("\n  }\n  async function postConnectReconciliation", start);
assert.ok(start >= 0 && end > start, "production post-connection scheduler is present");
const postConnectJobs = app.slice(start, end);

test("post-connection jobs cancel before starting when the Workspace changes during an idle yield", async () => {
  const connectedRoot = { name: "Synthetic Workspace A" };
  const model = { root: connectedRoot };
  const calls = [];
  let schedule;
  let releaseIdle;
  let idleStarted;
  const idle = new Promise(resolve => { idleStarted = resolve; });

  const context = vm.createContext({
    model,
    writeAuthority: { canWrite: true },
    permissionWasPending: false,
    folderWatchScan: async () => calls.push("Report inbox"),
    ensurePreviousMonthSummary: async () => calls.push("Month-end summary"),
    ensureDailyFocus: async () => calls.push("Daily focus"),
    scanAppointmentFiles: async () => calls.push("Appointment sources"),
    scanPerformanceFiles: async () => calls.push("Performance sources"),
    ensureMeetingCycleBaseline: async () => calls.push("Meeting baseline"),
    scanRecoveryBackups: async () => calls.push("Recovery backups"),
    runVerifiedUpdateFollowup: async () => calls.push("Verified update follow-up"),
    recordDiagnostic: () => {},
    renderRecovery: () => {},
    setTimeout: (callback, delay) => {
      if (delay === 1200) {
        schedule = callback;
        return 1;
      }
      if (delay === 350) {
        releaseIdle = callback;
        idleStarted();
        return 2;
      }
      throw new Error("Unexpected scheduler delay: " + delay);
    },
    Promise, setImmediate, console
  });

  vm.runInContext(postConnectJobs, context);
  assert.equal(typeof schedule, "function", "the deferred post-connection queue is scheduled");
  const work = schedule();
  await idle;
  model.root = { name: "Synthetic Workspace B" };
  releaseIdle();
  await work;

  assert.deepEqual(calls, [],
    "no queued task may run against a different Workspace after the idle yield");
});
