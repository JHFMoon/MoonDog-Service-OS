"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf("  async function folderWatchScan(");
const end=app.indexOf("  async function autoSurveyFolder(",start);
assert.ok(start>=0&&end>start,"production Report Inbox scan is present");
const source=app.slice(start,end);
const candidate={name:"synthetic-sapr.xlsx",relativePath:"Report Inbox/synthetic-sapr.xlsx",
  signature:"synthetic-signed-report",location:"inbox"};

function harness({pauseAt="",permissionState="granted",watchError=null}={}){
  const oldRoot={name:"First synthetic Workspace"};
  const model={root:oldRoot,autoImport:{inboxVersion:1,
    initializedAt:"2026-10-31T11:00:00.000Z",seen:{}}};
  const folderWatch={busy:false,pending:new Map([[candidate.relativePath,
    {signature:candidate.signature,confirmations:1,firstSeenAt:"2026-10-31T11:00:00.000Z"}]])};
  const writeAuthority={canWrite:true};
  const state={dailyImportBusy:false,appointmentImportBusy:false,
    workspaceConnectionBusy:false,postConnectionScanBusy:false,watchEnabled:true};
  const counters={imports:0,writes:0,stops:0,reads:0,permissionChecks:0,renders:0};
  let enter,release;
  const entered=new Promise(resolve=>{enter=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const pause=async phase=>{
    if(pauseAt===phase){enter();await gate;}
  };
  const context=vm.createContext({
    model,folderWatch,writeAuthority,
    get workspaceConnectionBusy(){return state.workspaceConnectionBusy;},
    get postConnectionScanBusy(){return state.postConnectionScanBusy;},
    get dailyImportBusy(){return state.dailyImportBusy;},
    get appointmentImportBusy(){return state.appointmentImportBusy;},
    folderWatchEnabled:()=>state.watchEnabled,
    permission:async root=>{
      counters.permissionChecks++;
      assert.equal(root,oldRoot,"the started scan requests permission on its captured Workspace");
      await pause("permission");
      return permissionState;
    },
    watchCandidates:async()=>{counters.reads++;await pause("enumeration");if(watchError)throw watchError;return[candidate];},
    candidateNeedsImport:()=>true,
    autoSurveyFolder:async signatures=>{
      counters.imports++;
      assert.deepEqual([...signatures],[candidate.signature]);
      await pause("import");
      return{imported:[candidate.name],retained:[],learned:[]};
    },
    stopFolderWatch:()=>{counters.stops++;},
    connectedNativeRoot:oldRoot,
    ui:{permissionBadge:{textContent:""},connectButton:{textContent:""}},
    watchStatus(){},
    recordDiagnostic(){},
    writeJson:async()=>{counters.writes++;},
    now:()=>"2026-10-31T11:00:01.000Z",
    renderAll:()=>{counters.renders++;},renderSetup(){},renderRecovery(){},
    window:{scrollX:0,scrollY:0,scrollTo(){}},
    AUTO_IMPORT_PATH:["data","auto-import.json"],
    Map,Set,Promise,Object,String,Array,Boolean,JSON,Error,console
  });
  vm.runInContext(source+"\nthis.scan=folderWatchScan;",context);
  return{oldRoot,model,folderWatch,writeAuthority,state,counters,entered,
    release:()=>release(),scan:reason=>context.scan(reason||"poll")};
}

test("manual import beginning during awaited enumeration defers automatic import without losing candidate",async()=>{
  const h=harness({pauseAt:"enumeration"});
  const scanning=h.scan();
  await h.entered;
  h.state.dailyImportBusy=true;
  h.release();await scanning;
  assert.equal(h.counters.imports,0);
  assert.equal(h.counters.writes,0);
  assert.equal(h.counters.renders,0);
  assert.equal(h.folderWatch.busy,false);
  assert.equal(h.folderWatch.pending.get(candidate.relativePath).confirmations,1,
    "a deferred scan must not consume the second candidate stability observation");
  h.state.dailyImportBusy=false;
  await h.scan("retry");
  assert.equal(h.counters.imports,1,"once the manual import exits, retry may import the same stable candidate");
  assert.equal(h.folderWatch.pending.size,0);
});

test("appointment import starting during enumeration also blocks automatic intake",async()=>{
  const h=harness({pauseAt:"enumeration"});
  const scan=h.scan();
  await h.entered;h.state.appointmentImportBusy=true;h.release();
  await scan;
  assert.equal(h.counters.imports,0);
  assert.equal(h.folderWatch.pending.get(candidate.relativePath).confirmations,1);
  assert.equal(h.folderWatch.busy,false);
});

test("Workspace switch during enumeration cannot advance a stale scan",async()=>{
  const h=harness({pauseAt:"enumeration"});
  const scan=h.scan();
  await h.entered;h.model.root={name:"New synthetic Workspace"};h.release();
  await scan;
  assert.equal(h.counters.imports,0);
  assert.equal(h.counters.writes,0);
  assert.equal(h.counters.renders,0);
  assert.equal(h.folderWatch.pending.get(candidate.relativePath).confirmations,1);
  assert.equal(h.folderWatch.busy,false);
});

test("Watch OFF and lost write authority during enumeration both fail closed",async()=>{
  for(const change of [
    h=>{h.state.watchEnabled=false;},
    h=>{h.writeAuthority.canWrite=false;},
    h=>{h.state.workspaceConnectionBusy=true;},
    h=>{h.state.postConnectionScanBusy=true;}
  ]){
    const h=harness({pauseAt:"enumeration"});
    const scan=h.scan();
    await h.entered;change(h);h.release();await scan;
    assert.equal(h.counters.imports,0);
    assert.equal(h.folderWatch.pending.get(candidate.relativePath).confirmations,1);
    assert.equal(h.folderWatch.busy,false);
  }
});

test("manual import beginning while permission is pending prevents enumeration",async()=>{
  const h=harness({pauseAt:"permission"});
  const scan=h.scan();
  await h.entered;h.state.dailyImportBusy=true;h.release();await scan;
  assert.equal(h.counters.reads,0);
  assert.equal(h.counters.imports,0);
  assert.equal(h.folderWatch.busy,false);
});

test("permission failure returned after switching roots does not disable the new Workspace watch",async()=>{
  const h=harness({pauseAt:"permission",permissionState:"denied"});
  const scan=h.scan();
  await h.entered;h.model.root={name:"New synthetic Workspace"};h.release();await scan;
  assert.equal(h.counters.stops,0,"permission loss on a disconnected root must not stop new-root watcher");
  assert.equal(h.counters.reads,0);
  assert.equal(h.counters.imports,0);
  assert.equal(h.folderWatch.busy,false);
});

test("unchanged eligible scan still imports a twice-confirmed report",async()=>{
  const h=harness();
  await h.scan("poll");
  assert.equal(h.counters.imports,1);
  assert.equal(h.counters.renders,1);
  assert.equal(h.folderWatch.pending.size,0);
  assert.equal(h.folderWatch.busy,false);
});

test("the connection-owned scan retains its permitted post-connection overlap",async()=>{
  const h=harness();h.state.postConnectionScanBusy=true;
  await h.scan("connection");
  assert.equal(h.counters.imports,1);
  assert.equal(h.folderWatch.busy,false);
});

test("real permission rejection still pauses the active root's watch",async()=>{
  const h=harness({permissionState:"denied"});
  await h.scan("poll");
  assert.equal(h.counters.stops,1);
  assert.equal(h.counters.reads,0);
  assert.equal(h.folderWatch.busy,false);
});

test("switching workspaces while automatic import is pending preserves new-root UI and pending candidates",async()=>{
  const h=harness({pauseAt:"import"});
  const scan=h.scan();
  await h.entered;
  h.model.root={name:"Second synthetic Workspace"};
  h.release();
  await scan;
  assert.equal(h.counters.imports,1,"the old import was already entered; this guards its completion effects");
  assert.equal(h.counters.renders,0,"the old import cannot render over the newly connected Workspace");
  assert.equal(h.folderWatch.pending.has(candidate.relativePath),true,
    "stale import completion must not remove pending source identities");
  assert.equal(h.folderWatch.lastChecked,undefined,
    "a stale completion cannot set the new Workspace watch timestamp");
  assert.equal(h.folderWatch.busy,false);
});

test("revoked write authority during automatic import suppresses stale post-import UI writes",async()=>{
  const h=harness({pauseAt:"import"});
  const scan=h.scan();
  await h.entered;h.writeAuthority.canWrite=false;h.release();await scan;
  assert.equal(h.counters.imports,1);
  assert.equal(h.counters.renders,0);
  assert.equal(h.folderWatch.pending.has(candidate.relativePath),true);
  assert.equal(h.folderWatch.busy,false);
});

test("a manual import entering during automatic import suppresses stale completion effects",async()=>{
  const h=harness({pauseAt:"import"});
  const scan=h.scan();
  await h.entered;h.state.dailyImportBusy=true;h.release();await scan;
  assert.equal(h.counters.imports,1);
  assert.equal(h.counters.renders,0);
  assert.equal(h.folderWatch.pending.has(candidate.relativePath),true);
  assert.equal(h.folderWatch.busy,false);
});

test("Watch OFF during automatic import does not publish a misleading completion",async()=>{
  const h=harness({pauseAt:"import"});
  const scan=h.scan();
  await h.entered;h.state.watchEnabled=false;h.release();await scan;
  assert.equal(h.counters.imports,1);
  assert.equal(h.counters.renders,0);
  assert.equal(h.folderWatch.pending.has(candidate.relativePath),true);
  assert.equal(h.folderWatch.lastChecked,undefined);
  assert.equal(h.folderWatch.busy,false);
});

test("successful import still clears only its confirmed candidate and repaints once",async()=>{
  const h=harness({pauseAt:"import"});
  const scan=h.scan();
  await h.entered;h.release();await scan;
  assert.equal(h.counters.imports,1);
  assert.equal(h.counters.renders,1);
  assert.equal(h.folderWatch.pending.size,0);
  assert.equal(h.folderWatch.lastChecked,"2026-10-31T11:00:01.000Z");
  assert.equal(h.folderWatch.busy,false);
});

test("old Workspace NotFound after reconnect cannot stop the newly connected watcher",async()=>{
  for(const errorName of ["NotFoundError","NotAllowedError","SecurityError","NotReadableError"]){
    const watchError=Object.assign(new Error("Synthetic old-root filesystem error"),{name:errorName});
    const h=harness({pauseAt:"enumeration",watchError});
    const scan=h.scan();
    await h.entered;
    h.model.root={name:"Replacement synthetic Workspace"};
    h.release();
    await scan;
    assert.equal(h.counters.stops,0,errorName+" from a disconnected root cannot pause the current watch");
    assert.equal(h.counters.imports,0);
    assert.equal(h.counters.renders,0);
    assert.equal(h.folderWatch.pending.get(candidate.relativePath).confirmations,1);
    assert.equal(h.folderWatch.busy,false);
  }
});

test("current Workspace missing Inbox still pauses the watcher and releases its scan slot",async()=>{
  const missing=Object.assign(new Error("Synthetic Inbox missing"),{name:"NotFoundError"});
  const h=harness({watchError:missing});
  await h.scan();
  assert.equal(h.counters.stops,1);
  assert.equal(h.counters.imports,0);
  assert.equal(h.folderWatch.busy,false);
});

test("current Workspace permission loss still pauses its watcher after enumeration failure",async()=>{
  const denied=Object.assign(new Error("Synthetic folder permission denied"),{name:"NotAllowedError"});
  const h=harness({watchError:denied});
  await h.scan();
  assert.equal(h.counters.stops,1);
  assert.equal(h.counters.imports,0);
  assert.equal(h.folderWatch.busy,false);
});
