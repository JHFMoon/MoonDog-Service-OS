"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const smoke = fs.readFileSync(path.join(__dirname, "..", "scripts", "smoke_overdrive.mjs"), "utf8");

function recoverySummary(samples) {
  const start=smoke.indexOf("        const summarizeRecoveryTask=key=>({");
  const end=smoke.indexOf("        const uxWorkflow=",start);
  assert.ok(start>=0&&end>start,"packaged Chromium task summary is part of the actual Clean Install Proof runner");
  const context=vm.createContext({
    completedUxTasks:samples,
    summarizeNavigationMs:values=>{
      assert.ok(values.length===9&&values.every(Number.isFinite),
        "all nine synthetic browser samples must be present and finite");
      const valuesSorted=[...values].sort((a,b)=>a-b);
      return {p50:valuesSorted[4],p95:valuesSorted[8]};
    }
  });
  vm.runInContext(smoke.slice(start,end)+"\nthis.summarizeTask=summarizeRecoveryTask;",context);
  return context.summarizeTask;
}

test("real Clean Install Proof task summary measures all nine recovered and reconnected journeys",()=>{
  const samples=Array.from({length:9},(_,i)=>({
    interruptedSaveTask:{
      elapsedMs:200+i*10,clickCount:4,fieldEntryCount:2,scrollDistancePx:3+i,
      expectedWriteFailures:1,verifiedReadback:true,unsavedDraftPreserved:true
    },
    reconnectTask:{
      elapsedMs:100+i*5,clickCount:1,fieldEntryCount:0,scrollDistancePx:0,
      verifiedReadback:true,restoredManagerState:true
    }
  }));
  const summarize=recoverySummary(samples);
  const interrupted=summarize("interruptedSaveTask");
  const reconnect=summarize("reconnectTask");
  assert.equal(interrupted.samples,9);
  assert.equal(interrupted.verifiedReadbacks,9);
  assert.equal(interrupted.elapsedMs.p95,280);
  assert.equal(interrupted.clickCount.p50,4);
  assert.equal(reconnect.samples,9);
  assert.equal(reconnect.verifiedReadbacks,9);
  assert.equal(reconnect.elapsedMs.p95,140);
  assert.equal(reconnect.clickCount.p50,1);
});

test("a missing task measurement cannot masquerade as a passing reconnect",()=>{
  const samples=Array.from({length:9},()=>({
    interruptedSaveTask:{elapsedMs:200,clickCount:4,fieldEntryCount:2,scrollDistancePx:0,
      verifiedReadback:true},
    reconnectTask:{elapsedMs:125,clickCount:1,fieldEntryCount:0,scrollDistancePx:0,
      verifiedReadback:true}
  }));
  samples[4].reconnectTask={verifiedReadback:false};
  assert.throws(()=>recoverySummary(samples)("reconnectTask"),/all nine synthetic browser samples/);
});

test("browser smoke exercises real failed Open RO save, retry and folder-reconnect UI on synthetic data",()=>{
  assert.match(smoke,/__moondogSyntheticWorkflowFaults=injectedWorkflowFaults/,
    "one-shot fault only exists in in-memory synthetic browser folder");
  assert.match(smoke,/failNextRoBackup&&\/updated-ro-\/i\.test\(name\)/,
    "fault strikes the state backup before the intended durable RO mutation");
  assert.match(smoke,/await connectedPage\.locator\("#saveRecordClose"\)\.click\(\{timeout:5000\}\);/);
  assert.match(smoke,/waitForFunction\(\(\)=>\{\s*const dialog=document\.getElementById\("editDialog"\),error=/,
    "production form must surface the expected failure before retry");
  assert.match(smoke,/await connectedPage\.locator\("#connectButton"\)\.click\(\{timeout:5000\}\)/,
    "reconnect measurement uses the actual user-facing working-folder control");
  assert.match(smoke,/model\.workspaceConnectionCommittedRoot===model\.root&&model\.connectionState==="CONNECTED"/,
    "the connection only passes after authoritative state commits");
  assert.match(smoke,/sample\.interruptedSaveTask\.expectedWriteFailures!==1/,
    "the full browser proof refuses false success without actual fault injection");
});
