"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

// Extract and execute the actual production preflight and restore entry point.
// No installed folder or real dealer data is opened; all content is synthetic.
const app=fs.readFileSync(path.join(__dirname,"..","assets/app.js"),"utf8");
function extract(begin,end){
  const a=app.indexOf(begin),b=app.indexOf(end,a+begin.length);
  assert.ok(a>=0&&b>a,"production section not found: "+begin);
  return app.slice(a,b);
}
const preflight=extract("  function sameRestoreValue(","  async function replaceHistoryFromBackup(");
const restore=extract("  async function restoreSelectedBackup()","  function latestImportSummary()");
const encode=value=>new TextEncoder().encode(value);
const decode=bytes=>new TextDecoder().decode(bytes);
const sha=async bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const missing=()=>Object.assign(Error("Synthetic file missing"),{name:"NotFoundError"});
const denied=()=>Object.assign(Error("Synthetic permission denied"),{name:"NotAllowedError"});
const canonical=["data/current-state.json","data/settings.json"];

function fixture(options={}){
  const files=new Map([
    ["data/current-state.json",encode(JSON.stringify({records:[{id:"synthetic-original"}]})+"\n")],
    ["data/settings.json",encode(JSON.stringify({schemaVersion:4,store:{name:"synthetic"}})+"\n")],
    ["data/history/2026-01.json",encode(JSON.stringify({events:[{id:"synthetic-history"}]})+"\n")]
  ]);
  const initialValues=Object.fromEntries(canonical.map(p=>[p,JSON.parse(decode(files.get(p)))]));
  const historyNames=[...files.keys()].filter(p=>p.startsWith("data/history/"));
  const events=[],changedPaths=[];
  const safety={
    values:initialValues,
    manifest:{entries:historyNames.map(p=>({path:p,size:files.get(p).length,sha256:crypto.createHash("sha256").update(files.get(p)).digest("hex")}))}
  };
  const selected={
    manifest:{createdAt:"2026-01-01T00:00:00Z",appVersion:"synthetic"},
    zip:{file(){return{async:async()=>encode("synthetic-restore-payload")};}}
  };
  const model={recovery:{status:"Idle"}};
  const context=vm.createContext({
    BACKUP_FILES:Object.fromEntries(canonical.map(p=>[p,()=>{}])),
    readFileBytes:async parts=>{
      const p=parts.join("/");
      if(p==="backups/selected.zip")return encode("selected");
      if(p==="backups/safety.zip")return encode("safety");
      if(options.deniedPath===p)throw denied();
      if(!files.has(p))throw missing();
      return new Uint8Array(files.get(p));
    },
    directoryFiles:async parts=>{
      if(options.denyHistory)throw denied();
      if(options.missingHistory)throw missing();
      const prefix=parts.join("/")+"/";
      return [...files.entries()].filter(([p])=>p.startsWith(prefix)).map(([p,b])=>({name:p.slice(prefix.length),bytes:new Uint8Array(b)}));
    },
    sha256:sha,
    decodeUtf8:decode,
    validateBackupBytes:async bytes=>{
      const tag=decode(bytes);
      if(tag==="selected")return selected;
      if(tag==="safety")return safety;
      throw Error("unexpected synthetic backup");
    },
    writeValidatedBackup:async()=>{
      events.push("safety-created");
      options.afterSafety?.(files);
      return{name:"safety.zip",path:"backups/safety.zip",manifest:safety.manifest};
    },
    writeBytes:async parts=>{changedPaths.push(parts.join("/"));throw Error("unexpected write during preflight");},
    ui:{restoreBackupSelect:{value:"selected.zip"}},
    confirm:()=>true,
    model,
    renderRecovery:()=>events.push("render"),
    Date
  });
  vm.runInContext(preflight+"\n"+restore+"\nglobalThis.runPreflight=preflightRestoreState;globalThis.runRestore=restoreSelectedBackup;",context);
  return{files,events,changedPaths,model,safety,preflight:()=>context.runPreflight(safety),restore:()=>context.runRestore()};
}

test("matching durable objects and history pass the real restore preflight",async()=>{
  const f=fixture();
  await f.preflight();
  assert.equal(f.changedPaths.length,0);
});

test("equivalent JSON property order is not a false multi-file conflict",async()=>{
  const f=fixture();
  f.files.set("data/settings.json",encode('{"store":{"name":"synthetic"},"schemaVersion":4}\n'));
  await f.preflight();
  assert.deepEqual(f.changedPaths,[]);
});

test("changed canonical source blocks multi-file restore before any replacement",async()=>{
  const f=fixture({afterSafety:files=>files.set("data/current-state.json",encode(JSON.stringify({records:[{id:"independent-writer"}]})))});
  await assert.rejects(f.restore(),/Restore preflight stopped before changes: current state changed/);
  assert.equal(f.events.includes("safety-created"),true);
  assert.equal(f.model.recovery.status,"Restore stopped before changing operational files");
  assert.deepEqual(f.changedPaths,[]);
  assert.equal(JSON.parse(decode(f.files.get("data/current-state.json"))).records[0].id,"independent-writer");
});

test("modified settings stop restore before replacing operational records",async()=>{
  const f=fixture({afterSafety:files=>files.set("data/settings.json",encode(JSON.stringify({schemaVersion:4,store:{name:"external-change"}})))});
  await assert.rejects(f.restore(),/current state changed/);
  assert.deepEqual(f.changedPaths,[]);
});

test("missing or unreadable operational file fails closed before restore",async()=>{
  for(const options of [{afterSafety:files=>files.delete("data/settings.json")},{deniedPath:"data/settings.json"}]){
    const f=fixture(options);
    await assert.rejects(f.restore(),/current state cannot be verified/);
    assert.deepEqual(f.changedPaths,[]);
  }
});

test("new history record after the safety snapshot blocks restore",async()=>{
  const f=fixture({afterSafety:files=>files.set("data/history/2026-02.json",encode(JSON.stringify({events:["foreign"]})))});
  await assert.rejects(f.restore(),/history inventory changed/);
  assert.equal(f.files.has("data/history/2026-02.json"),true);
  assert.deepEqual(f.changedPaths,[]);
});

test("edited history record after the safety snapshot blocks restore",async()=>{
  const f=fixture({afterSafety:files=>files.set("data/history/2026-01.json",encode(JSON.stringify({events:["changed"]})))});
  await assert.rejects(f.restore(),/history records changed/);
  assert.deepEqual(f.changedPaths,[]);
});

test("denied or missing history inventory fails closed when safety contains history",async()=>{
  for(const options of [{denyHistory:true},{missingHistory:true}]){
    const f=fixture(options);
    await assert.rejects(f.restore(),/history (cannot be verified|inventory changed)/);
    assert.deepEqual(f.changedPaths,[]);
  }
});

test("unrelated backup ZIP read is not an operational mutation",async()=>{
  const f=fixture({afterSafety:files=>files.set("data/current-state.json",encode(JSON.stringify({records:[{id:"external"}]})))});
  await assert.rejects(f.restore(),/Restore preflight stopped before changes/);
  assert.equal(f.events.filter(x=>x==="safety-created").length,1);
  assert.deepEqual(f.changedPaths,[]);
});
