'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const readSource=require('./helpers/read-source.cjs');
const path=require('node:path');
const vm=require('node:vm');
const app=readSource(path.join(__dirname,'..','assets/app.js'));
const begin=app.indexOf('    const connectedRoot=model.root;');
const end=app.indexOf('\n  }\n  async function postConnectReconciliation',begin);
assert.ok(begin>=0&&end>begin);

test('a completed same-root reconnect invalidates an older idle post-connect queue',{timeout:5000},async()=>{
  const original={seen:{synthetic:'preserved'}};
  const current={seen:{synthetic:'new authoritative ledger'}};
  const model={root:{name:'Synthetic installation'},autoImport:original};
  let scheduled,releaseIdle,startedIdle,idleCount=0;
  const waiting=new Promise(resolve=>{startedIdle=resolve;});
  const calls=[];
  const context=vm.createContext({
    model,writeAuthority:{canWrite:true},workspaceConnectionBusy:false,
    workspaceRecoveryBusy:false,postConnectionScanBusy:false,
    folderWatch:{busy:false},dailyImportBusy:false,appointmentImportBusy:false,
    permissionWasPending:false,
    setTimeout:(callback,delay)=>{
      if(delay===1200){scheduled=callback;return 1;}
      if(delay===350){if(++idleCount===1){releaseIdle=callback;startedIdle();}else setImmediate(callback);return 2;}
      throw Error('unexpected delay');
    },
    folderWatchScan:async()=>{calls.push('stale source scan');throw Error('stop obsolete queue');},
    ensurePreviousMonthSummary:()=>{},ensureDailyFocus:()=>{},
    scanAppointmentAndPerformanceFiles:()=>{},ensureMeetingCycleBaseline:()=>{},
    scanRecoveryBackups:()=>{},runVerifiedUpdateFollowup:()=>{},
    renderRecovery:()=>calls.push('stale render'),recordDiagnostic:()=>calls.push('stale diagnostic'),
    Promise,console
  });
  vm.runInContext(app.slice(begin,end),context);
  const pending=scheduled();await waiting;
  // A reconnect may complete during the idle slice using the same native root,
  // but its reloaded authoritative records are a new connection snapshot.
  model.autoImport=current;
  releaseIdle();
  await pending;
  assert.deepEqual(calls,[]);
  assert.strictEqual(model.autoImport,current);
  assert.deepEqual(original,{seen:{synthetic:'preserved'}});
  assert.equal(context.postConnectionScanBusy,false);
});
