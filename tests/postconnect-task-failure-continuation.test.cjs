"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf("    const connectedRoot=model.root;");
const end=app.indexOf("\n  }\n  async function postConnectReconciliation",start);
assert.ok(start>=0&&end>start,"production post-connection scheduler is present");
const postConnectJobs=app.slice(start,end);

test("a failed post-connect task releases the scan slot and does not starve later queued work",async()=>{
  const connectedRoot={name:"Synthetic Workspace"};
  const model={root:connectedRoot};
  const calls=[];
  const busyAtEntry=[];
  const diagnostics=[];
  let delayedStart;
  let context;
  const writeAuthority={canWrite:true};
  context=vm.createContext({
    model,writeAuthority,workspaceConnectionBusy:false,postConnectionScanBusy:false,
    permissionWasPending:false,folderWatch:{busy:false},
    folderWatchScan:async reason=>{
      assert.equal(reason,"connection");
      calls.push("Report inbox");
      busyAtEntry.push(context.postConnectionScanBusy);
      throw new Error("synthetic scan failure");
    },
    ensurePreviousMonthSummary:async()=>{calls.push("Month-end summary");busyAtEntry.push(context.postConnectionScanBusy);},
    ensureDailyFocus:async()=>{calls.push("Daily focus");busyAtEntry.push(context.postConnectionScanBusy);},
    scanAppointmentFiles:async()=>{calls.push("Appointment sources");busyAtEntry.push(context.postConnectionScanBusy);},
    scanPerformanceFiles:async()=>{calls.push("Performance sources");busyAtEntry.push(context.postConnectionScanBusy);},
    ensureMeetingCycleBaseline:async()=>{calls.push("Meeting baseline");busyAtEntry.push(context.postConnectionScanBusy);},
    scanRecoveryBackups:async()=>{calls.push("Recovery backups");busyAtEntry.push(context.postConnectionScanBusy);},
    runVerifiedUpdateFollowup:async()=>{calls.push("Verified update follow-up");busyAtEntry.push(context.postConnectionScanBusy);},
    recordDiagnostic:(category,message)=>diagnostics.push({category,message}),
    renderRecovery:()=>calls.push("Recovery rendered"),
    setTimeout:(callback,delay)=>{
      if(delay===1200){delayedStart=callback;return 1;}
      if(delay===350){callback();return 2;}
      throw new Error("Unexpected scheduler delay: "+delay);
    },
    Promise,console
  });

  vm.runInContext(postConnectJobs,context);
  assert.equal(typeof delayedStart,"function","the queue schedules its initial delayed start");
  await delayedStart();

  assert.deepEqual(calls,[
    "Report inbox","Month-end summary","Daily focus","Appointment sources",
    "Performance sources","Meeting baseline","Recovery backups",
    "Verified update follow-up","Recovery rendered"
  ],"one retryable source failure must not starve independent queued maintenance");
  assert.deepEqual(busyAtEntry,Array(8).fill(true),
    "each awaited task runs within the serialized post-connection slot");
  assert.equal(context.postConnectionScanBusy,false,
    "the scheduler releases the exclusion after the queue settles");
  assert.equal(model.root,connectedRoot,"the synthetic workspace identity remains unchanged");
  assert.ok(diagnostics.some(item=>item.category==="POST-CONNECTION SCAN"&&
    item.message==="Report inbox: synthetic scan failure"),
    "the failed task is reported with its task label without aborting the queue");
  assert.ok(diagnostics.some(item=>item.category==="FOLDER CONNECTION"&&
    /Automatic reconnect completed/.test(item.message)),
    "completion is recorded after later queued work settles");
});
