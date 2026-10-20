"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

// Actual production restore entry point, per-file source check and history
// validation, driven by synthetic files only. No installed Workspace accessed.
const app=fs.readFileSync(path.join(__dirname,"..","assets/app.js"),"utf8");
const start=app.indexOf("  function sameRestoreValue(");
const end=app.indexOf("  async function replaceHistoryFromBackup(",start);
const restoreStart=app.indexOf("  async function restoreSelectedBackup()",end);
const restoreEnd=app.indexOf("  function latestImportSummary()",restoreStart);
assert.ok(start>=0&&end>start&&restoreStart>=end&&restoreEnd>restoreStart,
  "production restore/preflight functions must be available");
const production=app.slice(start,end)+"\n"+app.slice(restoreStart,restoreEnd);
const encode=s=>new TextEncoder().encode(s);
const decode=b=>new TextDecoder().decode(b);
const digest=b=>crypto.createHash("sha256").update(b).digest("hex");
const json=v=>encode(JSON.stringify(v)+"\n");
const keys=["data/current-state.json","data/settings.json"];
const history="data/history/2026-01.json";
const missing=()=>Object.assign(Error("synthetic missing"),{name:"NotFoundError"});

function fixture(options={}){
  const files=new Map([
    [keys[0],json({records:[{id:"old"}]})],
    [keys[1],json({schemaVersion:4,store:{name:"old"}})],
    [history,json({records:[{id:"historic"}]})]
  ]);
  const before=Object.fromEntries(keys.map(p=>[p,JSON.parse(decode(files.get(p)))]));
  const safety={values:before,manifest:{entries:[{path:history,size:files.get(history).length,sha256:digest(files.get(history))}]}};
  const incoming=new Map([
    [keys[0],json({records:[{id:"restored"}]})],
    [keys[1],json({schemaVersion:4,store:{name:"restored"}})],
    [history,json({records:[{id:"restored-history"}]})]
  ]);
  const selected={
    manifest:{createdAt:"2026-01-01T00:00:00Z",appVersion:"synthetic",
      entries:[...incoming].map(([p,b])=>({path:p,sha256:digest(b)}))},
    zip:{file:p=>({async:async()=>new Uint8Array(incoming.get(p.slice("payload/".length)))})}
  };
  const actions=[],diagnostics=[],model={recovery:{status:"Ready",lastRestore:{sourceFile:"previous.zip"}}};
  let disabled=0,historyStarted=0,safetyExists=false;
  const context=vm.createContext({
    BACKUP_FILES:Object.fromEntries(keys.map(p=>[p,()=>null])),Date,RECOVERY_PATH:["data","recovery.json"],
    model,ui:{restoreBackupSelect:{value:"source.zip"}},
    readFileBytes:async parts=>{
      const p=parts.join("/");
      if(p==="backups/source.zip")return encode("source");
      if(p==="backups/safety.zip")return encode("safety");
      if(!files.has(p))throw missing();
      return new Uint8Array(files.get(p));
    },
    validateBackupBytes:async bytes=>{
      const name=decode(bytes);
      if(name==="source")return selected;
      if(name==="safety")return safety;
      throw Error("unexpected synthetic backup: "+name);
    },
    writeValidatedBackup:async()=>{
      actions.push(["safety-created"]);safetyExists=true;
      options.afterSafety?.(files);
      return{name:"safety.zip",path:"backups/safety.zip",manifest:safety.manifest};
    },
    directoryFiles:async parts=>{
      const prefix=parts.join("/")+"/";
      return [...files].filter(([p])=>p.startsWith(prefix)).map(([p,b])=>({name:p.slice(prefix.length),bytes:new Uint8Array(b)}));
    },
    writeBytes:async(parts,bytes)=>{
      const p=parts.join("/");actions.push(["write",p]);
      files.set(p,new Uint8Array(bytes));
      options.afterWrite?.(p,files);
      if(options.throwAfterWrite===p)throw Error("synthetic interrupted writable");
    },
    replaceHistoryFromBackup:async()=>{
      historyStarted++;
      actions.push(["history-replacement"]);
      if(options.throwDuringHistory){
        files.delete(history);
        files.set("data/history/independent.json",json({records:[{id:"independent"}]}));
        throw Error("synthetic partial history failure");
      }
      files.set(history,new Uint8Array(incoming.get(history)));
    },
    sha256:async bytes=>digest(bytes),decodeUtf8:decode,
    renderRecovery:()=>actions.push(["render"]),
    readJson:async parts=>JSON.parse(decode(files.get(parts.join("/")))),
    writeJson:async(parts,value)=>{
      const p=parts.join("/");
      if(p==="data/restore-in-progress.json"){
        actions.push(["restore-marker-created"]);
        files.set(p,json(value));
      }else actions.push(["persist-recovery"]);
    },
    maintenanceIO:{remove:async p=>{actions.push(["restore-marker-removed"]);files.delete(p);}},
    writeAuthority:{
      beginRestore:()=>actions.push(["restore-begun"]),
      endRestore:()=>actions.push(["restore-ended"]),
      disable:()=>{disabled++;actions.push(["read-only"]);}
    },
    recordDiagnostic:(kind,message)=>diagnostics.push({kind,message}),
    now:()=>"2026-10-20T00:00:00Z",
    addHistory:async()=>actions.push(["add-history"]),
    renderAll:()=>{},renderSettings:()=>{},
    scanRecoveryBackups:async()=>{},status:()=>{},
    confirm:()=>true
  });
  vm.runInContext(production+"\nglobalThis.runRestore=restoreSelectedBackup;\nglobalThis.check=preflightRestoreState;",context);
  return{
    files,model,actions,diagnostics,
    restore:()=>context.runRestore(),check:()=>context.check(safety),
    get disabled(){return disabled;},get historyStarted(){return historyStarted;},get safetyExists(){return safetyExists;},
    incoming
  };
}

test("an external writer changing a later file after preflight is never overwritten or blindly rolled back",async()=>{
  const f=fixture({afterWrite:(p,files)=>{
    if(p===keys[0])files.set(keys[1],json({schemaVersion:4,store:{name:"independent-writer"}}));
  }});
  await assert.rejects(f.restore(),/current state changed after the safety snapshot/);
  assert.equal(JSON.parse(decode(f.files.get(keys[1]))).store.name,"independent-writer");
  assert.equal(JSON.parse(decode(f.files.get(keys[0]))).records[0].id,"restored");
  assert.deepEqual(f.actions.filter(([a])=>a==="write").map(([,p])=>p),[keys[0]]);
  assert.equal(f.historyStarted,0);
  assert.equal(f.disabled,1);
  assert.equal(f.safetyExists,true);
  assert.equal(f.files.has("data/restore-in-progress.json"),true,"crash recovery hold must persist");
  assert.match(f.model.recovery.status,/controlled recovery required/);
  assert.deepEqual(f.model.recovery.lastRestore,{sourceFile:"previous.zip"});
  assert.equal(f.actions.some(([a])=>a==="persist-recovery"),false);
});

test("a failed target handle retaining unrelated replacement must not trigger automatic old-state rollback",async()=>{
  const f=fixture({afterWrite:(p,files)=>{
    if(p===keys[0])files.set(p,json({records:[{id:"external-after-write"}]}));
  },throwAfterWrite:keys[0]});
  await assert.rejects(f.restore(),/synthetic interrupted writable/);
  assert.equal(JSON.parse(decode(f.files.get(keys[0]))).records[0].id,"external-after-write");
  assert.equal(f.actions.filter(([a])=>a==="write").length,1);
  assert.equal(f.disabled,1);
  assert.equal(f.safetyExists,true);
  assert.match(f.diagnostics[0].message,/without automatic rollback/);
});

test("new history after canonical writes but before history replacement blocks the destructive history phase",async()=>{
  const f=fixture({afterWrite:(p,files)=>{
    if(p===keys[1])files.set("data/history/external.json",json({records:[{id:"external-history"}]}));
  }});
  await assert.rejects(f.restore(),/history inventory changed/);
  assert.equal(f.files.has("data/history/external.json"),true);
  assert.equal(f.historyStarted,0);
  assert.equal(f.disabled,1);
  assert.equal(f.safetyExists,true);
});

test("an interrupted history replacement retains the safety package and disables edits rather than replaying rollback",async()=>{
  const f=fixture({throwDuringHistory:true});
  await assert.rejects(f.restore(),/synthetic partial history failure/);
  assert.equal(f.files.has("data/history/independent.json"),true);
  assert.equal(f.historyStarted,1);
  assert.equal(f.disabled,1);
  assert.equal(f.safetyExists,true);
  assert.equal(f.actions.filter(([a])=>a==="write").length,2,"do not write canonical files again as rollback");
});

test("an unchanged synthetic restore still succeeds without disabling write authority",async()=>{
  const f=fixture();
  await f.restore();
  assert.equal(f.disabled,0);
  assert.equal(f.historyStarted,1);
  assert.equal(JSON.parse(decode(f.files.get(keys[0]))).records[0].id,"restored");
  assert.equal(JSON.parse(decode(f.files.get(history))).records[0].id,"restored-history");
  assert.equal(f.model.recovery.lastRestore.validationStatus,"Verified");
  assert.equal(f.model.recovery.status,"Restore verified");
  assert.equal(f.files.has("data/restore-in-progress.json"),false,"successful restore must remove hold");
  assert.equal(f.actions.some(([a])=>a==="persist-recovery"),true);
});

test("preflight conflict before first mutation does not disable an otherwise healthy workspace",async()=>{
  const f=fixture({afterSafety:files=>files.set(keys[0],json({records:[{id:"external-prior"}]}))});
  await assert.rejects(f.restore(),/Restore preflight stopped before changes/);
  assert.equal(f.disabled,0);
  assert.equal(f.actions.some(([a])=>a==="write"),false);
  assert.equal(JSON.parse(decode(f.files.get(keys[0]))).records[0].id,"external-prior");
});
