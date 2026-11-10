"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const begin=app.indexOf("async function runVerifiedUpdateFollowup() {");
const end=app.indexOf("const folderWatch=",begin);
assert.ok(begin>=0&&end>begin&&end-begin<10000,"extract selected production follow-up implementation");
const selectedFunction=app.slice(begin,end);
const VERSION="0.10.18-beta.409", REVISION="synthetic-parser-v1";
const BROWSER_RECEIPT="moondog-verified-update-followup-v1";

function scenario({browserReceipt=null,durable=null,parserRevision=null,lookupFails=false,switchDuring=null}={}) {
  const calls={lookup:0,layout:0,writes:0,reconcile:0,completed:0,removed:0,diagnostics:0};
  const root={name:"Synthetic Store B"};
  const model={root,applicationRoot:root,autoImport:{learnedParserRevision:parserRevision,seen:{}}};
  const otherRoot={name:"Different Synthetic Store"};
  const switchRoot=()=>{
    model.root=otherRoot;model.applicationRoot=otherRoot;
    model.autoImport={learnedParserRevision:null,seen:{}};
  };
  const storage={
    getItem:key=>key===BROWSER_RECEIPT&&browserReceipt?JSON.stringify(browserReceipt):"null",
    removeItem:key=>{assert.equal(key,BROWSER_RECEIPT);calls.removed++;}
  };
  const context=vm.createContext({
    model,writeAuthority:{canWrite:true},localStorage:storage,VERSION,
    LEARNED_PARSER_REVISION:REVISION,AUTO_IMPORT_PATH:["data","auto-import.json"],
    findVerifiedUpdateFollowup:async selected=>{
      calls.lookup++;
      assert.equal(selected,root,"durable receipt must use the connected installation");
      if(lookupFails)throw Object.assign(Error("synthetic unreadable journal"),{name:"NotReadableError"});
      if(switchDuring==="journal")switchRoot();
      return durable;
    },
    auditInstalledRuntimeLayout:async selected=>{
      assert.equal(selected,root);calls.layout++;
      if(switchDuring==="layout")switchRoot();
      return {needsReview:false,scanned:2,compatibilityIndexPresent:true};
    },
    recordDiagnostic:()=>{calls.diagnostics++;},
    reconcileLearnedFiles:async revision=>{
      assert.equal(revision,REVISION);calls.reconcile++;
      if(switchDuring==="reconcile")switchRoot();
      return {attempts:1,recovered:0,unsupported:0,skipped:1};
    },
    writeJson:async(name,value)=>{
      assert.equal(name[1],"auto-import.json");
      assert.equal(value,model.autoImport);calls.writes++;
    },
    markVerifiedUpdateFollowupComplete:async receipt=>{
      assert.equal(receipt,durable);calls.completed++;
    }
  });
  vm.runInContext(selectedFunction+"\nglobalThis.runFollowup=runVerifiedUpdateFollowup;",context);
  return {run:()=>context.runFollowup(),calls,model};
}

test("Store A browser receipt cannot cause Store B journal-less follow-up or state write",async()=>{
  const h=scenario({browserReceipt:{version:VERSION,verifiedAt:"2026-11-09T12:00:00Z"}});
  await h.run();
  assert.equal(h.calls.lookup,1);
  assert.equal(h.calls.layout,0);
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.reconcile,0);
  assert.equal(h.calls.removed,0);
  assert.equal(h.model.autoImport.learnedParserRevision,null);
});

test("unreadable selected-root journal cannot be bypassed with another store's browser receipt",async()=>{
  const h=scenario({lookupFails:true,browserReceipt:{version:VERSION}});
  await h.run();
  assert.equal(h.calls.layout,0);
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.completed,0);
  assert.equal(h.calls.removed,0);
});

test("matching selected-installation verified journal still completes follow-up",async()=>{
  const own={version:VERSION,completed:false,journal:{status:"verified"}};
  const h=scenario({durable:own,parserRevision:REVISION});
  await h.run();
  assert.equal(h.calls.layout,1);
  assert.equal(h.calls.completed,1);
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.reconcile,0);
});

test("independent changed parser revision still reconciles without a browser receipt",async()=>{
  const h=scenario({parserRevision:"older-parser"});
  await h.run();
  assert.equal(h.calls.layout,1);
  assert.equal(h.calls.reconcile,1);
  assert.equal(h.calls.writes,1);
  assert.equal(h.calls.completed,0);
  assert.equal(h.model.autoImport.learnedParserRevision,REVISION);
});

test("reconnecting a different store during awaited follow-up cannot write or complete the old store receipt",async()=>{
  for(const stage of ["journal","layout","reconcile"]){
    const h=scenario({
      durable:{version:VERSION,completed:false,journal:{status:"verified"}},
      parserRevision:stage==="reconcile"?"older-parser":REVISION,
      switchDuring:stage
    });
    await h.run();
    assert.equal(h.calls.writes,0,stage+" changed the newly connected store");
    assert.equal(h.calls.completed,0,stage+" completed an outdated installation receipt");
    assert.equal(h.calls.removed,0,stage+" touched browser-local state");
    assert.equal(h.model.root.name,"Different Synthetic Store");
    assert.equal(h.model.autoImport.learnedParserRevision,null);
    assert.equal(h.calls.layout,stage==="journal"?0:1);
  }
});


test("learned-file scanner cannot resume pending folder read into a different store",async()=>{
  const start=app.indexOf("  async function reconcileLearnedFiles(");
  const end=app.indexOf("  // Read-only catalog-to-disk",start);
  assert.ok(start>=0&&end>start&&end-start<8000,"selected production reconciler exists");
  const source=app.slice(start,end);
  for(const switchStore of [true,false]){
    const rootA={name:"Synthetic A"},rootB={name:"Synthetic B"};
    const model={root:rootA,autoImport:{seen:{},learnedFileMemo:{}}};
    let unblock,entered,writes=0;
    const pending=new Promise(resolve=>unblock=resolve);
    const started=new Promise(resolve=>entered=resolve);
    const ctx=vm.createContext({
      model,folderWatch:{busy:false},dailyImportBusy:false,appointmentImportBusy:false,
      directory:async()=>{entered();await pending;return {
        entries:async function*(){yield ["unsupported.txt",{
          kind:"file",getFile:async()=>({size:12,lastModified:1})
        }]}
      };},
      AUTO_IMPORT_PATH:["data","auto-import.json"],
      writeJson:async()=>{writes++;assert.equal(model.root,rootA);},
      recordDiagnostic:()=>{},now:()=>new Date(0).toISOString(),setTimeout,Promise
    });
    vm.runInContext(source+"\nglobalThis.retryLearnedFiles=reconcileLearnedFiles;",ctx);
    const job=ctx.retryLearnedFiles("synthetic-revision");
    await started;
    if(switchStore){
      model.root=rootB;
      model.autoImport={seen:{},learnedFileMemo:{}};
    }
    unblock();
    const result=await job;
    assert.equal(writes,switchStore?0:1);
    assert.equal(result.deferred===true,switchStore);
    assert.equal(model.root,switchStore?rootB:rootA);
  }
});

test("successful update does not create a shared-origin browser marker",()=>{
  const updater=fs.readFileSync(path.join(__dirname,"..","assets","moondog-update-settings.js"),"utf8");
  assert.doesNotMatch(updater, /localStorage\?\.setItem\(["']moondog-verified-update-followup-v1["']/);
  assert.match(updater, /The verified installer already stores the update receipt/);
});

test("Greeter output cleanup cannot append source-store history into a newly connected store",async()=>{
  const begin=app.indexOf("  async function processClassifiedCandidate(");
  const end=app.indexOf("  async function completeExactReviewedInboxSource(",begin);
  assert.ok(begin>=0&&end>begin&&end-begin<10000,"production import dispatcher extractable");
  for(const switched of [true,false]){
    const rootA={name:"Synthetic A"},rootB={name:"Synthetic B"};
    const model={root:rootA,settings:{store:{name:"Synthetic",code:"SYN"}}};
    const history=[],deletions=[],sourceLocations=new Map();
    const guards=new Map(),cleanupContext=new Map();
    const ctx=vm.createContext({
      model,sourceLocations,xlsxSourceDeleteGuards:guards,
      autoSourceDeleteContext:cleanupContext,
      removeSourceEntry:async()=>{deletions.push(model.root.name);if(switched)model.root=rootB;},
      addHistory:async()=>history.push(model.root.name),
      recordDiagnostic:()=>{},ensurePreviousMonthSummary:async()=>{},renderAll:()=>{}
    });
    vm.runInContext(app.slice(begin,end)+"\nglobalThis.dispatch=processClassifiedCandidate;",ctx);
    const candidate={name:"synthetic-greeter.pdf",location:"learn"};
    const perform=()=>ctx.dispatch(candidate,"disposable-greeter",new Uint8Array([1]).buffer,true);
    if(switched){
      await assert.rejects(perform(),/Workspace changed during Greeter cleanup/);
      assert.deepEqual(history,[],"old-store completion cannot write history to a different store");
    }else{
      await perform();
      assert.deepEqual(history,["Synthetic A"],"same-store cleanup writes its own history");
    }
    assert.deepEqual(deletions,["Synthetic A"]);
    assert.equal(guards.size,0,"source cleanup guard released after both outcomes");
    assert.equal(cleanupContext.size,0);
  }
});

test("appointment memo completion cannot write history after a store reconnect",async()=>{
  const start=app.indexOf("  async function reconcileLearnedFiles(");
  const end=app.indexOf("  // Read-only catalog-to-disk",start);
  assert.ok(start>=0&&end>start&&end-start<8000,"extract production learned-file reconciler");
  const production=app.slice(start,end);
  for(const switched of [true,false]){
    const rootA={name:"Synthetic Store A"},rootB={name:"Synthetic Store B"};
    const originalLedger={seen:{},learnedFileMemo:{}};
    const model={root:rootA,autoImport:originalLedger};
    const writes=[],history=[];
    const file={size:2,lastModified:1,
      slice:()=>({text:async()=>"advisor name,total ros,vir printed/emailed"}),
      arrayBuffer:async()=>new Uint8Array([1,2]).buffer};
    const ctx=vm.createContext({
      model,folderWatch:{busy:false},dailyImportBusy:false,appointmentImportBusy:false,
      directory:async()=>({entries:async function*(){yield ["synthetic-appointments.csv",{kind:"file",getFile:async()=>file}];}}),
      classifyImportFile:async()=>"appointments",
      processClassifiedCandidate:async()=>({retired:false}),
      writeJson:async(path,value)=>{
        assert.equal(path[1],"auto-import.json");
        assert.equal(value,originalLedger,"persist original store memo only");
        writes.push(model.root.name);
        if(switched){model.root=rootB;model.autoImport={seen:{},learnedFileMemo:{}};}
      },
      addHistory:async()=>{history.push(model.root.name);},
      recordDiagnostic:()=>{},now:()=>new Date(0).toISOString(),
      sha256:async()=>"",setTimeout,Promise,AUTO_IMPORT_PATH:["data","auto-import.json"]
    });
    vm.runInContext(production+"\nglobalThis.reconcileActual=reconcileLearnedFiles;",ctx);
    const result=await ctx.reconcileActual("synthetic-parser");
    assert.deepEqual(writes,["Synthetic Store A"]);
    assert.deepEqual(history,switched?[]:["Synthetic Store A"],"no old-store completion in new store");
    assert.equal(Boolean(result.deferred),switched);
    assert.equal(model.root,switched?rootB:rootA);
    assert.equal(model.autoImport.learnedParserRevision,undefined);
  }
});

test("failed learned-file hash cannot log into another store after reconnect",async()=>{
  const begin=app.indexOf("  async function reconcileLearnedFiles(");
  const end=app.indexOf("  // Read-only catalog-to-disk",begin);
  assert.ok(begin>=0&&end>begin&&end-begin<8000,"extract production reconciliation");
  for(const switched of [true,false]){
    const rootA={name:"Synthetic A"},rootB={name:"Synthetic B"};
    const ledgerA={seen:{},learnedFileMemo:{}},ledgerB={seen:{},learnedFileMemo:{}};
    const model={root:rootA,autoImport:ledgerA},diagnostics=[],writes=[];
    const file={size:4,lastModified:1,
      slice:()=>({text:async()=>"generic csv"}),
      arrayBuffer:async()=>new Uint8Array([1,2,3,4]).buffer};
    const ctx=vm.createContext({
      model,folderWatch:{busy:false},dailyImportBusy:false,appointmentImportBusy:false,
      directory:async()=>({entries:async function*(){yield ["synthetic.csv",{kind:"file",getFile:async()=>file}];}}),
      classifyImportFile:async()=>"synthetic-supported",
      processClassifiedCandidate:async()=>{throw new Error("synthetic import failure");},
      writeJson:async()=>{writes.push(model.root.name);},
      recordDiagnostic:()=>{diagnostics.push(model.root.name);},
      now:()=>new Date(0).toISOString(),
      sha256:async()=>{if(switched){model.root=rootB;model.autoImport=ledgerB;}return "synthetic-hash";},
      setTimeout,Promise,AUTO_IMPORT_PATH:["data","auto-import.json"]
    });
    vm.runInContext(app.slice(begin,end)+"\nglobalThis.retry=reconcileLearnedFiles;",ctx);
    const outcome=await ctx.retry("synthetic-revision");
    assert.deepEqual(diagnostics,switched?[]:["Synthetic A"],"no old-store failure diagnostic under Store B");
    assert.deepEqual(writes,switched?[]:["Synthetic A"],"only original store writes failure ledger");
    assert.equal(Boolean(outcome.deferred),switched);
    assert.equal(Object.keys(ledgerA.seen).length,switched?0:1);
    assert.equal(Object.keys(ledgerB.seen).length,0);
  }
});

test("learned-file history cannot leave cross-store diagnostics after reconnect",async()=>{
  const begin=app.indexOf("  async function reconcileLearnedFiles(");
  const end=app.indexOf("  // Read-only catalog-to-disk",begin);
  assert.ok(begin>=0&&end>begin&&end-begin<8000,"use actual production reconciler");
  for(const retired of [true,false])for(const switched of [true,false]){
    const rootA={name:"Synthetic A"},rootB={name:"Synthetic B"};
    const ledgerA={seen:{},learnedFileMemo:{}};
    const model={root:rootA,autoImport:ledgerA},history=[],diagnostics=[],writes=[];
    const file={size:3,lastModified:1,
      slice:()=>({text:async()=>"generic csv"}),
      arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};
    const ctx=vm.createContext({
      model,folderWatch:{busy:false},dailyImportBusy:false,appointmentImportBusy:false,
      directory:async()=>({entries:async function*(){yield ["synthetic.csv",{kind:"file",getFile:async()=>file}];}}),
      classifyImportFile:async()=>"synthetic-supported",
      processClassifiedCandidate:async()=>({retired}),
      addHistory:async()=>{history.push(model.root.name);if(switched){
        model.root=rootB;model.autoImport={seen:{},learnedFileMemo:{}};
      }},
      recordDiagnostic:()=>diagnostics.push(model.root.name),
      writeJson:async()=>writes.push(model.root.name),
      now:()=>new Date(0).toISOString(),sha256:async()=>"",setTimeout,Promise,
      AUTO_IMPORT_PATH:["data","auto-import.json"]
    });
    vm.runInContext(app.slice(begin,end)+"\nglobalThis.reconcileActual=reconcileLearnedFiles;",ctx);
    const outcome=await ctx.reconcileActual("synthetic-revision");
    assert.deepEqual(history,["Synthetic A"],"only original store history called");
    assert.deepEqual(diagnostics,switched?[]:["Synthetic A"],"never log old source recovery in new store");
    assert.deepEqual(writes,[]);
    assert.equal(Boolean(outcome.deferred),switched);
  }
});
