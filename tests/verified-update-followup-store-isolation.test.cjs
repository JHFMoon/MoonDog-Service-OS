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

test("successful update does not create a shared-origin browser marker",()=>{
  const updater=fs.readFileSync(path.join(__dirname,"..","assets","moondog-update-settings.js"),"utf8");
  assert.doesNotMatch(updater, /localStorage\?\.setItem\(["']moondog-verified-update-followup-v1["']/);
  assert.match(updater, /The verified installer already stores the update receipt/);
});
