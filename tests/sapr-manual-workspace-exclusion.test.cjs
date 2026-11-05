"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function extract(start,end){
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"Real SAPR production binding/connection gate remains testable");
  return app.slice(a,b);
}
const click=extract('ui.importPerformance.addEventListener("click"', 'ui.performanceAdvisor.addEventListener(');
const connectionBlocker=extract('  function workspaceConnectionBlockReason()', '  async function finishConnection(');

function fixture(options={}){
  const events=[];let resolveImport,rejectImport,clickHandler;
  const pendingImport=new Promise((resolve,reject)=>{resolveImport=resolve;rejectImport=reject;});
  const ctx=vm.createContext({
    ui:{importPerformance:{addEventListener(event,handler){
      assert.equal(event,"click");clickHandler=handler;
    }}},
    folderWatch:{busy:Boolean(options.watchBusy)},
    dailyImportBusy:Boolean(options.importBusy),
    appointmentImportBusy:Boolean(options.appointmentsBusy),
    postConnectionScanBusy:Boolean(options.scanBusy),
    workspaceRecoveryBusy:false,
    workspaceConnectionBusy:Boolean(options.connectionBusy),
    supervisorWorkbookInFlight:0,
    folderWatchEnabled:()=>options.watchEnabled!==false,
    stopFolderWatch:()=>events.push("stop"),
    startFolderWatch:()=>events.push("restart"),
    importPerformanceFile:async()=>{
      events.push("start-import");
      await pendingImport;
      events.push("import-finished");
    },
    run:async action=>action()
  });
  vm.runInContext(connectionBlocker+"\n"+click+"\nthis.workspaceBlock=workspaceConnectionBlockReason;",ctx);
  return{ctx,events,click:()=>clickHandler(),resolveImport,rejectImport};
}

test("direct SAPR button holds actual production Workspace reconnect gate through durable import",async()=>{
  const f=fixture();
  assert.equal(f.ctx.workspaceBlock(),"");
  const inFlight=f.click();
  assert.equal(f.ctx.dailyImportBusy,true);
  assert.match(f.ctx.workspaceBlock(),/finishing another workspace operation/);
  assert.deepEqual(f.events,["stop","start-import"]);
  await assert.rejects(f.click(),/Another Workspace import or connection is in progress/);
  assert.deepEqual(f.events,["stop","start-import"],"second click must not stop or release original lock");
  f.resolveImport();
  await inFlight;
  assert.equal(f.ctx.dailyImportBusy,false);
  assert.equal(f.ctx.workspaceBlock(),"");
  assert.deepEqual(f.events,["stop","start-import","import-finished","restart"]);
});

test("failed direct SAPR import releases exclusion and resumes watch without indicating success",async()=>{
  const f=fixture();
  const inFlight=f.click();
  f.rejectImport(new Error("synthetic readback failed"));
  await assert.rejects(inFlight,/synthetic readback failed/);
  assert.equal(f.ctx.dailyImportBusy,false);
  assert.equal(f.ctx.workspaceBlock(),"");
  assert.deepEqual(f.events,["stop","start-import","restart"]);
});

test("disabled Folder Watch is not spuriously restarted after manual SAPR import",async()=>{
  const f=fixture({watchEnabled:false});
  const inFlight=f.click();f.resolveImport();await inFlight;
  assert.deepEqual(f.events,["stop","start-import","import-finished"]);
  assert.equal(f.ctx.dailyImportBusy,false);
});

for(const [option,label] of [
  ["watchBusy","folder watcher"],
  ["importBusy","other import"],
  ["appointmentsBusy","appointment import"],
  ["scanBusy","post-connect scan"],
  ["connectionBusy","active reconnect"]
]){
  test("direct SAPR button refuses while "+label+" has operational authority",async()=>{
    const f=fixture({[option]:true});
    await assert.rejects(f.click(),/Another Workspace import or connection is in progress/);
    assert.deepEqual(f.events,[],"refusal cannot alter watch state or other lock");
    assert.equal(f.ctx.dailyImportBusy,Boolean(option==="importBusy"));
  });
}

test("manual SAPR source picker refresh refuses to rebind Inbox origins during active import",async()=>{
  const refresh=extract('ui.refreshPerformanceFiles.addEventListener("click"',
    'ui.performanceSourceSelect.addEventListener(');
  let callback=null,scans=0;
  const ctx=vm.createContext({
    ui:{refreshPerformanceFiles:{addEventListener(event,fn){
      assert.equal(event,"click");callback=fn;
    }}},
    dailyImportBusy:true,appointmentImportBusy:false,
    folderWatch:{busy:false},workspaceConnectionBusy:false,postConnectionScanBusy:false,
    run:async action=>action(),
    scanPerformanceFiles:async()=>{scans++;}
  });
  vm.runInContext(refresh,ctx);
  await assert.rejects(callback(),/Refresh reports after it finishes/);
  assert.equal(scans,0);
  ctx.dailyImportBusy=false;
  await callback();
  assert.equal(scans,1);
  ctx.workspaceConnectionBusy=true;
  await assert.rejects(callback(),/Refresh reports after it finishes/);
  assert.equal(scans,1);
});

test("manual SAPR exclusion preserves production dashboard syntax",()=>{
  new vm.Script(app);
  assert.match(click,/dailyImportBusy=true/);
  assert.match(click,/finally\s*\{/);
  assert.match(connectionBlocker,/dailyImportBusy/);
});
