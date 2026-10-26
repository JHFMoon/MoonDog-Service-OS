"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const crypto=require("node:crypto");

const authoritySource=fs.readFileSync(path.join(__dirname,"..","assets/moondog-write-authority.js"),"utf8");
const owner="123e4567-e89b-42d3-a456-426614174000";
function memoryRoot(){
  const directory=(name="")=>{
    const children=new Map();
    return {kind:"directory",name,children,queryPermission:async()=> "granted",
      async getDirectoryHandle(key,{create=false}={}) {
        let value=children.get(key);
        if(!value&&create){value=directory(key);children.set(key,value);}
        if(!value)throw Object.assign(new Error("missing"),{name:"NotFoundError"});
        if(value.kind!=="directory")throw Object.assign(new Error("type"),{name:"TypeMismatchError"});
        return value;
      },
      async getFileHandle(key,{create=false}={}) {
        let value=children.get(key);
        if(!value&&create){value=file(key);children.set(key,value);}
        if(!value)throw Object.assign(new Error("missing"),{name:"NotFoundError"});
        if(value.kind!=="file")throw Object.assign(new Error("type"),{name:"TypeMismatchError"});
        return value;
      },
      async removeEntry(key) {
        if(!children.has(key))throw Object.assign(new Error("missing"),{name:"NotFoundError"});
        const value=children.get(key);
        if(value.kind==="directory"&&value.children.size)throw Object.assign(new Error("not empty"),{name:"InvalidModificationError"});
        children.delete(key);
      },
      async *entries(){for(const pair of children)yield pair;}
    };
  };
  const file=name=>{
    let bytes=new Uint8Array();
    return {kind:"file",name,
      async getFile(){const copy=bytes.slice();return {text:async()=>new TextDecoder().decode(copy),arrayBuffer:async()=>copy.buffer};},
      async createWritable(){
        let next=new Uint8Array();
        return {async write(value){next=typeof value==="string"?new TextEncoder().encode(value):new Uint8Array(value);},
          async close(){bytes=next.slice();},async abort(){}};
      }
    };
  };
  const root=directory();
  async function set(parts,value){
    let d=root;for(const part of parts.slice(0,-1))d=await d.getDirectoryHandle(part,{create:true});
    const h=await d.getFileHandle(parts.at(-1),{create:true});
    const w=await h.createWritable();await w.write(typeof value==="string"?value:new TextEncoder().encode(JSON.stringify(value)+"\n"));await w.close();
  }
  async function get(parts){let d=root;for(const part of parts.slice(0,-1))d=await d.getDirectoryHandle(part);return JSON.parse(await(await d.getFileHandle(parts.at(-1))).getFile().then(f=>f.text()));}
  return {root,set,get};
}
function loadAuthority(){
  const context=vm.createContext({crypto:crypto.webcrypto,TextEncoder,TextDecoder,Event,DOMException,setTimeout,clearTimeout,console});
  vm.runInContext(authoritySource,context);
  return context.MoonDogWriteAuthority;
}
async function heldFixture(){
  const f=memoryRoot(),authority=loadAuthority();
  await f.set(["System Files","Workspace","data","restore-in-progress.json"],{schemaVersion:1,restoreId:owner});
  await f.set(["System Files","Workspace","data","store-revision.json"],{schemaVersion:1,revision:4});
  return {...f,authority};
}

test("controlled recovery grants only the marker owner a scoped mutation and releases the hold after revision verification",async()=>{
  const f=await heldFixture(),a=f.authority;
  await a.beginInterruptedRecovery(f.root,owner);
  assert.equal(a.canWrite,false);
  await assert.rejects(a.beginMutation(),/NoModificationAllowedError/);
  await assert.rejects(a.beginMutation("123e4567-e89b-42d3-a456-426614174001"),/NoModificationAllowedError/);
  const token=await a.beginMutation(owner);
  await a.completeMutation(token);
  assert.equal((await f.get(["System Files","Workspace","data","store-revision.json"])).revision,5);
  await a.finishInterruptedRecovery(owner);
  await assert.rejects(f.get(["System Files","Workspace","data","restore-in-progress.json"]),/missing/);
  assert.equal((await f.get(["System Files","Workspace","data","store-revision.json"])).revision,6);
  assert.equal(a.canWrite,true);
});

test("a changed durable revision blocks recovery writes and abort retains the restore marker",async()=>{
  const f=await heldFixture(),a=f.authority;
  await a.beginInterruptedRecovery(f.root,owner);
  await f.set(["System Files","Workspace","data","store-revision.json"],{schemaVersion:1,revision:9});
  await assert.rejects(a.beginMutation(owner),/NoModificationAllowedError/);
  a.abortInterruptedRecovery(owner);
  await assert.rejects(a.beginMutation(owner),/NoModificationAllowedError/);
  assert.equal((await f.get(["System Files","Workspace","data","restore-in-progress.json"])).restoreId,owner);
});

test("controlled recovery rejects traversal journal targets before reading their target path",async()=>{
  const app=fs.readFileSync(path.join(__dirname,"..","assets/app.js"),"utf8");
  const start=app.indexOf("  async function collectControlledRecoveryJournals(){");
  const end=app.indexOf("\n  }",app.indexOf("    return found;",start));
  assert.ok(start>=0&&end>start,"production recovery journal collector must exist");
  const collector=app.slice(start,end+4);
  let targetReads=0;
  const journal={format:"moondog-write-v1",target:"System Files/Workspace/../../outside.json",before:null,after:[]};
  const sidecar={kind:"file",getFile:async()=>({text:async()=>JSON.stringify(journal)})};
  const data={kind:"directory",async *entries(){yield [".moondog-txn-malicious.json",sidecar];}};
  const workspace={kind:"directory",async *entries(){yield ["data",data];}};
  const system={kind:"directory",async *entries(){yield ["Workspace",workspace];}};
  const root={kind:"directory",async *entries(){yield ["System Files",system];}};
  const context=vm.createContext({
    model:{root},WORKSPACE_PREFIX:["System Files","Workspace"],
    readExistingBytes:async()=>{targetReads++;throw new Error("must not read");}
  });
  await assert.rejects(vm.runInContext("("+collector.replace("async function collectControlledRecoveryJournals","async function")+")()",context),/unsafe or detached/);
  assert.equal(targetReads,0);
});

test("restore history verification ignores journal sidecars but still verifies operational history",async()=>{
  const app=fs.readFileSync(path.join(__dirname,"..","assets/app.js"),"utf8");
  const start=app.indexOf("  async function verifyRestoredBackupState(entries,controlledProgress=null){");
  const end=app.indexOf("\n  }",app.indexOf("    for(const file of actual)",start));
  assert.ok(start>=0&&end>start,"production restore verifier must exist");
  const verifier=app.slice(start,end+4);
  const state=new TextEncoder().encode("state");
  const history=new TextEncoder().encode("event");
  const sidecar=new TextEncoder().encode("{}");
  const digest=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
  const context=vm.createContext({
    BACKUP_FILES:{"data/state.json":true},
    RECOVERY_PATH:["data","recovery.json"],
    readFileBytes:async()=>state,
    sha256:async bytes=>digest(bytes),
    directoryFiles:async()=>[
      {name:"saved.json",bytes:history},
      {name:".moondog-txn-pending.json",bytes:sidecar}
    ]
  });
  const verify=vm.runInContext("("+verifier+")",context);
  await verify([
    {path:"data/state.json",sha256:digest(state)},
    {path:"data/history/saved.json",size:history.byteLength,sha256:digest(history)}
  ]);
  await assert.rejects(verify([
    {path:"data/state.json",sha256:digest(state)},
    {path:"data/history/saved.json",size:history.byteLength,sha256:digest(history)}
  ]).then(()=>{context.directoryFiles=async()=>[{name:"unexpected.json",bytes:history}];return verify([
    {path:"data/state.json",sha256:digest(state)},
    {path:"data/history/saved.json",size:history.byteLength,sha256:digest(history)}
  ]);}),/history inventory|history verification/);
});

test("interrupted recovery recognizes only progress tied to the held restore and selected state",()=>{
  const app=fs.readFileSync(path.join(__dirname,"..","assets/app.js"),"utf8");
  const start=app.indexOf("  function interruptedRecoveryProgressDirection(");
  const end=app.indexOf("  function refreshInterruptedRecoveryControls(",start);
  assert.ok(start>=0&&end>start,"production retry progress validators must exist");
  const helpers=app.slice(start,end);
  const marker={restoreId:owner,safetyBackup:"MoonDog Restore Safety test.zip",sourceFile:"restore-source.zip"};
  const recovery={status:"Interrupted restore recovered and verified",lastRestore:{
    sourceFile:marker.sourceFile,safetyBackup:marker.safetyBackup,validationStatus:"Verified controlled recovery"
  }};
  const id="full-restore-recovered-"+owner;
  const event={schemaVersion:1,id,type:"full-restore-recovered",
    summary:"Completed a manager-confirmed recovery from an interrupted whole-state restore",
    details:{selectedState:"source",sourceFile:marker.sourceFile,safetyBackup:marker.safetyBackup,restoreId:owner}};
  const context=vm.createContext({TextDecoder});
  vm.runInContext(helpers+";globalThis.recoveryDirection=interruptedRecoveryProgressDirection;globalThis.auditDirection=interruptedRecoveryAuditDirection;",context);
  const recoveryBytes=new TextEncoder().encode(JSON.stringify(recovery));
  const eventBytes=new TextEncoder().encode(JSON.stringify(event));
  assert.equal(context.recoveryDirection(recoveryBytes,marker),"source");
  assert.equal(context.auditDirection("data/history/"+id+".json",eventBytes,marker),"source");
  assert.equal(context.auditDirection("data/history/"+id+".json",eventBytes,{...marker,restoreId:"123e4567-e89b-42d3-a456-426614174001"}),null);
  assert.equal(context.recoveryDirection(new TextEncoder().encode(JSON.stringify({...recovery,status:"Ready"})),marker),null);
});

test("recovery reloads settings before release and invalidates the Daily history cache",()=>{
  const app=fs.readFileSync(path.join(__dirname,"..","assets/app.js"),"utf8");
  const start=app.indexOf("  async function recoverInterruptedRestore(){");
  const end=app.indexOf("  async function readExistingBytes(",start);
  assert.ok(start>=0&&end>start,"production controlled recovery flow must exist");
  const recovery=app.slice(start,end);
  const adapter=recovery.indexOf("loadSourceAdapter(recoveredAdapter,rawSettings)");
  const finish=recovery.indexOf("await writeAuthority.finishInterruptedRecovery(restoreId)");
  const invalidate=recovery.indexOf('dailyNotify("moondog-recovered")');
  assert.ok(adapter>=0&&adapter<finish,"restored source adapter must load before write access resumes");
  assert.ok(finish>=0&&invalidate>finish,"Daily history cache must invalidate after hold release");
  assert.ok(recovery.includes("model.recovery.interruptedRestoreReview=null;"),
    "transient interrupted assessment must not be persisted after recovery");
});

function controlledRecoveryExecutionFixture(options={}){
  const app=fs.readFileSync(path.join(__dirname,"..","assets/app.js"),"utf8");
  const start=app.indexOf("  async function recoverInterruptedRestore(){");
  const end=app.indexOf("  async function readExistingBytes(",start);
  assert.ok(start>=0&&end>start,"production controlled recovery function must exist");
  const helperStart=app.indexOf("  function interruptedRecoveryProgressDirection(");
  const helperEnd=app.indexOf("  function refreshInterruptedRecoveryControls(",helperStart);
  assert.ok(helperStart>=0&&helperEnd>helperStart,"production recovery helpers must exist");
  const helpers=app.slice(helperStart,helperEnd);
  const production=helpers+app.slice(start,end);
  const enc=value=>new TextEncoder().encode(typeof value==="string"?value:JSON.stringify(value));
  const digest=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
  const marker={schemaVersion:1,restoreId:owner,safetyBackup:"MoonDog Restore Safety synthetic.zip",sourceFile:"MoonDog Full Backup synthetic.zip"};
  const safety={
    "data/state.json":enc({records:[{id:"safety"}]}),
    "data/settings.json":enc({sourceAdapters:{schemaVersion:1,key:"safety"},setup:{newStorePrepared:false}}),
    "data/recovery.json":enc({schemaVersion:1,status:"Ready"}),
    "data/history/safety.json":enc({type:"synthetic-safety"})
  };
  const source={
    "data/state.json":enc({records:[{id:"source"}]}),
    "data/settings.json":enc({sourceAdapters:{schemaVersion:1,key:"source"},setup:{newStorePrepared:false}}),
    "data/recovery.json":enc({schemaVersion:1,status:"Ready"}),
    "data/history/source.json":enc({type:"synthetic-source"})
  };
  const archive=files=>({manifest:{schemaVersion:1,createdAt:"2026-10-22T00:00:00.000Z",
    entries:Object.entries(files).map(([path,bytes])=>({path,size:bytes.byteLength,sha256:digest(bytes)}))},
    zip:{file(name){const bytes=files[name.slice("payload/".length)];return bytes&&{async:async()=>new Uint8Array(bytes)};}}});
  const backups={
    [marker.safetyBackup]:options.invalidSafety?null:archive(safety),
    [marker.sourceFile]:archive(source)
  };
  const live=new Map(Object.entries(safety).map(([p,b])=>[p,new Uint8Array(b)]));
  if(options.conflict)live.set("data/state.json",enc({records:[{id:"independent"}]}));
  const context=vm.createContext({
    TextEncoder,TextDecoder,Uint8Array,Map,Set,JSON,Date,Promise,crypto:crypto.webcrypto,
    model:{applicationRoot:{},root:{},pendingRoot:null,state:{},settings:{},appointments:{},performance:{},
      assignNext:{},autoImport:{},operationalMetrics:{},meetingCycle:{},
      recovery:{schemaVersion:1,status:"Ready",interruptedRestoreReview:{...marker,state:"held",safety:"verified",source:"verified"}}},
    ui:{interruptedRecoveryTarget:{value:"source"}},
    BACKUP_FILES:{"data/state.json":true,"data/settings.json":true,"data/recovery.json":true},
    RECOVERY_PATH:["data","recovery.json"],STATE_PATH:["data","state.json"],SETTINGS_PATH:["data","settings.json"],
    APPOINTMENTS_PATH:["data","appointments.json"],PERFORMANCE_PATH:["data","performance.json"],
    ASSIGN_NEXT_PATH:["data","assign-next.json"],AUTO_IMPORT_PATH:["data","auto-import.json"],
    OPERATIONAL_METRICS_PATH:["data","operational-metrics.json"],MEETING_CYCLE_PATH:["data","meeting-cycle.json"],
    SOURCE_ADAPTER_BOOTSTRAP_PATH:["data","source-adapter-bootstrap.json"],
    marker,live,backups,writeLog:[],events:[],active:false,finishFailures:options.finishFailures||0,
    now:()=>"2026-10-22T12:00:00.000Z",stamp:()=>"20261022T120000Z",slug:value=>String(value).replace(/[^a-z0-9]+/gi,"-"),
    window:{confirm:()=>options.confirm!==false},
    readJson:async(parts,fallback)=>{
      const p=parts.join("/");
      if(p==="data/restore-in-progress.json")return marker;
      const bytes=live.get(p);
      return bytes?JSON.parse(new TextDecoder().decode(bytes)):fallback;
    },
    readFileBytes:async parts=>{
      const p=parts.join("/");
      if(p.startsWith("backups/")){
        const name=p.slice("backups/".length);
        if(options.missingSafety&&name===marker.safetyBackup)
          throw Object.assign(Error("Synthetic safety backup missing"),{name:"NotFoundError"});
        return enc(name);
      }
      const bytes=live.get(p);
      if(!bytes)throw Object.assign(Error("Synthetic missing"),{name:"NotFoundError"});
      return new Uint8Array(bytes);
    },
    validateBackupBytes:async bytes=>backups[new TextDecoder().decode(bytes)]||null,
    directoryFiles:async parts=>[...live.entries()].filter(([p])=>p.startsWith(parts.join("/")+"/"))
      .map(([p,bytes])=>({name:p.slice(parts.join("/").length+1),bytes:new Uint8Array(bytes)})),
    sha256:async bytes=>digest(bytes),
    collectControlledRecoveryJournals:async()=>[],
    verifyRestoredBackupState:async(entries,controlledProgress=null)=>{
      for(const entry of entries){
        const bytes=live.get(entry.path);
        if(entry.path==="data/recovery.json"&&controlledProgress?.marker&&
           context.interruptedRecoveryProgressDirection(bytes,controlledProgress.marker)===controlledProgress.direction)continue;
        if(!bytes||bytes.byteLength!==entry.size||digest(bytes)!==entry.sha256)
          throw Error("Synthetic restored state did not match the selected archive.");
      }
    },
    readExistingBytes:async p=>live.has(p)?new Uint8Array(live.get(p)):null,
    writeBytes:async(parts,bytes,restoreId)=>{
      if(!context.active||restoreId!==owner)throw Error("Synthetic authority denied the write.");
      context.writeLog.push(parts.join("/"));
      if(options.failWriteAt===context.writeLog.length&&!context.writeFailureInjected){context.writeFailureInjected=true;throw Error("Synthetic interrupted write.");}
      live.set(parts.join("/"),new Uint8Array(bytes));
      if(options.competeAfterWriteAt===context.writeLog.length){
        context.live.set(options.competePath||"data/settings.json",enc(options.competeValue||{sourceAdapters:{schemaVersion:1,key:"external"},externalEdit:true}));
      }
    },
    writeJson:async(parts,value,restoreId)=>{
      const bytes=enc(JSON.stringify(value,null,2)+"\n");
      await context.writeBytes(parts,bytes,restoreId);
      const p=parts.join("/");
      if(p.startsWith("data/history/"))context.events.push(p);
    },
    maintenanceIO:{
      remove:async(p,_token,_restore,restoreId)=>{
        if(!context.active||restoreId!==owner)throw Error("Synthetic authority denied deletion.");
        live.delete(p);
      },
      exists:async p=>live.has(p),
      cleanupJournal:async()=>{}
    },
    writeAuthority:{
      beginInterruptedRecovery:async(_root,id)=>{if(id!==owner)throw Error("wrong owner");context.active=true;},
      finishInterruptedRecovery:async id=>{
        if(id!==owner||!context.active)throw Error("wrong owner");
        if(context.finishFailures>0){context.finishFailures--;throw Error("Synthetic release interruption.");}
        context.active=false;context.marker=null;
      },
      abortInterruptedRecovery:id=>{if(id===owner)context.active=false;}
    },
    migratedSettings:raw=>raw,
    loadSourceAdapter:(config,raw)=>{context.loadedAdapter=config.key;},
    clearSourceAdapter:()=>{context.loadedAdapter="cleared";},
    pruneClosedRecords:value=>value,
    renderRecovery:()=>{},renderAll:()=>{},renderSettings:()=>{},scanRecoveryBackups:async()=>{},
    status:()=>{},dailyNotify:type=>context.dailyEvents.push(type),dailyEvents:[],
    console:{warn(){}}
  });
  // Keep captured shared state explicit for assertions after vm execution.
  context.live=live;context.marker=marker;context.backups=backups;
  context.read=path=>live.get(path);
  vm.runInContext(production+"\nglobalThis.recover=recoverInterruptedRestore;",context);
  return context;
}

test("actual controlled recovery selects one complete backup, reloads its adapter, and refreshes Daily history",async()=>{
  const f=controlledRecoveryExecutionFixture();
  assert.equal(await f.recover(),true);
  assert.equal(f.marker,null);
  assert.equal(f.active,false);
  assert.equal(JSON.parse(new TextDecoder().decode(f.read("data/state.json"))).records[0].id,"source");
  assert.equal(JSON.parse(new TextDecoder().decode(f.read("data/settings.json"))).sourceAdapters.key,"source");
  assert.equal(f.loadedAdapter,"source");
  assert.equal(f.live.has("data/history/safety.json"),false);
  assert.equal(JSON.parse(new TextDecoder().decode(f.read("data/history/source.json"))).type,"synthetic-source");
  assert.equal(f.events.filter(path=>path.startsWith("data/history/")).length,1);
  assert.deepEqual(f.dailyEvents,["moondog-recovered"]);
});

test("canceling actual controlled recovery leaves all bytes and the hold untouched",async()=>{
  const f=controlledRecoveryExecutionFixture({confirm:false});
  const before=new Map([...f.live].map(([p,b])=>[p,new Uint8Array(b)]));
  assert.equal(await f.recover(),false);
  assert.equal(f.marker.restoreId,owner);
  assert.equal(f.writeLog.length,0);
  assert.equal(f.live.size,before.size);
  for(const [p,b]of before)assert.deepEqual(f.live.get(p),b);
});

test("actual recovery resumes the same verified target after a release interruption",async()=>{
  const f=controlledRecoveryExecutionFixture({finishFailures:1});
  await assert.rejects(f.recover(),/Synthetic release interruption/);
  assert.equal(f.marker.restoreId,owner);
  assert.ok(f.live.has("data/history/full-restore-recovered-"+owner+".json"));
  assert.equal(f.active,false);
  f.writeLog.length=0;
  assert.equal(await f.recover(),true);
  assert.equal(f.marker,null);
  assert.equal(JSON.parse(new TextDecoder().decode(f.read("data/state.json"))).records[0].id,"source");
  assert.equal(f.loadedAdapter,"source");
});

test("actual recovery refuses foreign operational bytes before the first write",async()=>{
  const f=controlledRecoveryExecutionFixture({conflict:true});
  await assert.rejects(f.recover(),/differs from both verified backups/);
  assert.equal(f.marker.restoreId,owner);
  assert.equal(f.writeLog.length,0);
  assert.equal(f.active,false);
});

test("actual recovery refuses missing or invalid safety backups before replacing operational state",async()=>{
  for(const options of [{missingSafety:true},{invalidSafety:true}]){
    const f=controlledRecoveryExecutionFixture(options);
    const before=new Map([...f.live].map(([path,bytes])=>[path,new Uint8Array(bytes)]));
    await assert.rejects(f.recover());
    assert.equal(f.marker.restoreId,owner,"the interrupted restore hold must remain");
    assert.equal(f.writeLog.length,0,"no operational bytes may be written");
    assert.equal(f.active,false,"failed validation must release only the temporary recovery capability");
    assert.equal(f.live.size,before.size);
    for(const [path,bytes]of before)assert.deepEqual(f.live.get(path),bytes,path+" must remain byte-identical");
  }
});


test("actual recovery stops before overwriting a same-Workspace edit arriving midflight",async()=>{
  const external={sourceAdapters:{schemaVersion:1,key:"external"},setup:{newStorePrepared:false},externalEdit:"preserve"};
  const f=controlledRecoveryExecutionFixture({competeAfterWriteAt:1,competePath:"data/settings.json",competeValue:external});
  await assert.rejects(f.recover(),/changed during recovery/);
  assert.equal(f.marker.restoreId,owner,"the interrupted-restore hold must remain");
  assert.equal(f.active,false,"temporary recovery authority must be released");
  assert.deepEqual(f.writeLog,["data/state.json"],"recovery must stop before another write");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(f.read("data/settings.json"))),external,"the competing edit must remain byte-authoritative");
  assert.equal(JSON.parse(new TextDecoder().decode(f.read("data/state.json"))).records[0].id,"source","the already-completed first file remains under the hold for controlled retry");
});


test("actual multi-file recovery stays held after an interrupted write and resumes the same verified backup",async()=>{
  const f=controlledRecoveryExecutionFixture({failWriteAt:2});
  await assert.rejects(f.recover(),/Synthetic interrupted write/);
  assert.equal(f.marker.restoreId,owner,"the durable restore hold must remain after a partial multi-file restore");
  assert.equal(f.active,false,"temporary recovery authority must be released after the failed attempt");
  assert.deepEqual(f.writeLog,["data/state.json","data/settings.json"],"the injected failure must stop the sequence at the second file");
  assert.equal(JSON.parse(new TextDecoder().decode(f.read("data/state.json"))).records[0].id,"source","the verified first write remains under the hold");
  assert.equal(JSON.parse(new TextDecoder().decode(f.read("data/settings.json"))).sourceAdapters.key,"safety","the interrupted second file retains its prior verified bytes");
  assert.equal(f.live.has("data/history/source.json"),false,"recovery must not advance to history before canonical files finish");

  f.writeLog.length=0;
  assert.equal(await f.recover(),true,"retry must resume the same selected verified source backup");
  assert.equal(f.marker,null);
  assert.equal(f.active,false);
  assert.equal(JSON.parse(new TextDecoder().decode(f.read("data/state.json"))).records[0].id,"source");
  assert.equal(JSON.parse(new TextDecoder().decode(f.read("data/settings.json"))).sourceAdapters.key,"source");
  assert.equal(f.loadedAdapter,"source");
  assert.equal(f.live.has("data/history/safety.json"),false);
  assert.equal(JSON.parse(new TextDecoder().decode(f.read("data/history/source.json"))).type,"synthetic-source");
  assert.equal(f.events.filter(path=>path.startsWith("data/history/")).length,1);
  assert.deepEqual(f.dailyEvents,["moondog-recovered"]);
});
