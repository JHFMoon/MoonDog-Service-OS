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
    workspaceConnectionBusy: false,
    postConnectionScanBusy: false,
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

const guardStart=app.indexOf("  let workspaceConnectionBusy=false;");
const guardEnd=app.indexOf("  async function finishConnection(",guardStart);
assert.ok(guardStart>=0&&guardEnd>guardStart,"production connection exclusion guard exists");
const connectionGuards=app.slice(guardStart,guardEnd);
const reconnectGateStart=app.indexOf("  async function completeWorkspaceConnection(");
const reconnectGateEnd=app.indexOf("    const permissionWasPending=model.pendingRoot===handle;",reconnectGateStart);
assert.ok(reconnectGateStart>=0&&reconnectGateEnd>reconnectGateStart);
const productionGate=app.slice(
  app.indexOf("    const connectionBlock=workspaceConnectionBlockReason();",reconnectGateStart),
  reconnectGateEnd
);
assert.match(productionGate,/workspaceConnectionBlockReason\(\)/,
  "Workspace reconnect must use the background-operation exclusion gate");

test("post-connection scans and Workspace switches exclude each other",async()=>{
  const connectedRoot={name:"Synthetic Workspace A"};
  const model={root:connectedRoot};
  const callbacks=[];
  const calls=[];
  let releaseSummary;
  let summaryStarted;
  const started=new Promise(resolve=>{summaryStarted=resolve;});
  const pendingSummary=new Promise(resolve=>{releaseSummary=resolve;});
  const context=vm.createContext({
    model,writeAuthority:{canWrite:true},folderWatch:{busy:false},
    dailyImportBusy:false,appointmentImportBusy:false,permissionWasPending:false,
    folderWatchScan:async()=>{calls.push("Report inbox");},
    ensurePreviousMonthSummary:async()=>{calls.push("Month-end summary");summaryStarted();await pendingSummary;},
    ensureDailyFocus:async()=>calls.push("Daily focus"),scanAppointmentFiles:async()=>calls.push("Appointment sources"),
    scanPerformanceFiles:async()=>calls.push("Performance sources"),ensureMeetingCycleBaseline:async()=>calls.push("Meeting baseline"),
    scanRecoveryBackups:async()=>calls.push("Recovery backups"),runVerifiedUpdateFollowup:async()=>calls.push("Verified update follow-up"),
    recordDiagnostic:()=>{},renderRecovery:()=>{},
    setTimeout:(callback,delay)=>{
      if(delay===1200){callbacks.push(callback);return callbacks.length;}
      if(delay===350){setImmediate(callback);return 99;}
      throw new Error("Unexpected scheduler delay: "+delay);
    },
    Promise,setImmediate,console
  });
  vm.runInContext(
    connectionGuards+
    "\nasync function exerciseProductionConnectionGate(handle,ask){\n"+productionGate+"\n}"+
    "\nthis.connectionBlockReason=workspaceConnectionBlockReason;"+
    "\nthis.setConnectionBusy=value=>{workspaceConnectionBusy=value;};"+
    "\nthis.exerciseProductionConnectionGate=exerciseProductionConnectionGate;",
    context
  );
  const start=s=>vm.runInContext("(function(){"+s+"}).call(this);",context);

  // A connection already in progress prevents the next background task from starting.
  context.setConnectionBusy(true);
  start(postConnectJobs);
  assert.equal(callbacks.length,1);
  await callbacks.shift()();
  assert.deepEqual(calls,[]);

  // If a maintenance task starts first, its durable work holds the reconnect gate.
  context.setConnectionBusy(false);
  start(postConnectJobs);
  const inFlight=callbacks.shift()();
  await started;
  assert.deepEqual(calls,["Report inbox","Month-end summary"]);
  assert.match(context.connectionBlockReason(),/another workspace operation/i);
  await assert.rejects(context.exerciseProductionConnectionGate({}),
    /another workspace operation/i,
    "the exact production gate rejects switching during an active scan");
  releaseSummary();
  await inFlight;
  assert.equal(context.connectionBlockReason(),"","The connection exclusion must release after the task settles.");
  await context.exerciseProductionConnectionGate({});
  assert.deepEqual(calls,[
    "Report inbox","Month-end summary","Daily focus","Appointment sources",
    "Performance sources","Meeting baseline","Recovery backups","Verified update follow-up"
  ]);
});
