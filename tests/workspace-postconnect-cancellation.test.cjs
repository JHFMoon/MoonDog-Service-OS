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
    scanAppointmentAndPerformanceFiles: async () => calls.push("Appointment and performance sources"),
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
const finishStart=app.indexOf("  async function finishConnection(",guardStart);
const completeStart=app.indexOf("  async function completeWorkspaceConnection(",finishStart);
const gateEnd=app.indexOf("    const permissionWasPending=model.pendingRoot===handle;",completeStart);
const connectStart=app.indexOf("  async function connect() {",completeStart);
const connectEnd=app.indexOf("  async function restoreConnection()",connectStart);
assert.ok(guardStart>=0&&finishStart>guardStart&&completeStart>finishStart&&gateEnd>completeStart);
assert.ok(connectStart>gateEnd&&connectEnd>connectStart,"production connection wrapper is present");
const connectionGuards=app.slice(guardStart,finishStart);
const finishFunction=app.slice(finishStart,completeStart);
const productionGate=app.slice(completeStart,gateEnd)+
  "    return \"synthetic connected\";\n  }\n";
const productionConnect=app.slice(connectStart,connectEnd);
assert.match(productionGate,/workspaceConnectionBlockReason\(\)/,
  "production Workspace switch must use the background-operation exclusion gate");
assert.match(productionGate,/WORKSPACE_CONNECTION_BUSY/,
  "a scan-busy rejection must be classified as non-destructive");

test("post-connection scans and Workspace switches exclude each other without revoking writes",async()=>{
  const connectedRoot={name:"Synthetic Workspace A"};
  const model={root:connectedRoot,pendingRoot:null,workspaceConnectionCommittedRoot:connectedRoot};
  const callbacks=[];
  const calls=[];
  const connectionStates=[];
  let pickerCalls=0;
  let releaseSummary;
  let summaryStarted;
  const started=new Promise(resolve=>{summaryStarted=resolve;});
  const pendingSummary=new Promise(resolve=>{releaseSummary=resolve;});
  const writeAuthority={canWrite:true,disableCount:0,disable(){this.disableCount++;this.canWrite=false;}};
  const context=vm.createContext({
    model,writeAuthority,folderWatch:{busy:false},
    dailyImportBusy:false,appointmentImportBusy:false,permissionWasPending:false,
    __moondogDailyUI:{confirmWorkspaceChange:()=>true},
    window:{showDirectoryPicker:async()=>{pickerCalls++;return {name:"Synthetic Workspace B"};}},
    setConnectionState:(state,message)=>connectionStates.push({state,message}),
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
    connectionGuards+finishFunction+productionGate+productionConnect+
    "\nthis.connectWorkspace=connect;"+
    "\nthis.setConnectionBusy=value=>{workspaceConnectionBusy=value;};"+
    "\nthis.isConnectionBusy=()=>workspaceConnectionBusy;",
    context
  );
  const start=s=>vm.runInContext("(function(){"+s+"}).call(this);",context);

  // A connection already in progress prevents the next background task from starting.
  context.setConnectionBusy(true);
  start(postConnectJobs);
  assert.equal(callbacks.length,1);
  await callbacks.shift()();
  assert.deepEqual(calls,[]);

  // If maintenance starts first, the real connect wrapper rejects the switch harmlessly.
  context.setConnectionBusy(false);
  start(postConnectJobs);
  const inFlight=callbacks.shift()();
  await started;
  assert.deepEqual(calls,["Report inbox","Month-end summary"]);
  const originalRoot=model.root;
  await assert.rejects(context.connectWorkspace(),
    error=>error?.code==="WORKSPACE_CONNECTION_BUSY",
    "the production wrapper must identify a scan-busy reconnect as retryable");
  assert.equal(writeAuthority.canWrite,true,"a rejected switch must preserve current Workspace write authority");
  assert.equal(writeAuthority.disableCount,0);
  assert.equal(model.root,originalRoot,"a rejected switch must not replace the current root");
  assert.equal(connectionStates.length,0,"a transient busy rejection must not publish a connection failure");
  assert.equal(context.isConnectionBusy(),false,"the connection mutex releases after the rejection");

  releaseSummary();
  await inFlight;
  assert.equal(context.isConnectionBusy(),false);
  assert.equal(await context.connectWorkspace(),"synthetic connected","retry succeeds after the scan settles");
  assert.equal(pickerCalls,2);
  assert.equal(writeAuthority.canWrite,true);
  assert.deepEqual(calls,[
    "Report inbox","Month-end summary","Daily focus","Appointment and performance sources",
    "Meeting baseline","Recovery backups","Verified update follow-up"
  ]);
});
