"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const crypto=require("node:crypto");

const app=fs.readFileSync(path.join(__dirname,"..","assets/app.js"),"utf8");
function production(start,end){
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"production backup function was not found: "+start);
  return app.slice(a,b);
}
const maker=production("  async function createBackupBytes(","  async function validateBackupBytes(");
const writer=production("  async function writeValidatedBackup(","  async function createBackupNow(");
const encode=s=>new TextEncoder().encode(s);
const decode=b=>new TextDecoder().decode(b);
const hash=async b=>crypto.createHash("sha256").update(b).digest("hex");
const missing=()=>Object.assign(Error("synthetic missing state"),{name:"NotFoundError"});

function fixture(){
  const paths=[
    "data/current-state.json","data/settings.json",
    "data/appointments.json","data/advisor-performance.json"
  ];
  const originals=[
    {records:[{id:"disk-RO"}]},
    {schemaVersion:4,store:{name:"disk-store"}},
    {days:{"2026-01-01":{}}},
    {snapshots:{"2026-01":{value:"disk"}}}
  ];
  const files=new Map(paths.map((p,i)=>[p,encode(JSON.stringify(originals[i])+"\n")]));
  files.set("data/history/2026-01.json",encode('{"events":["disk-event"]}\n'));
  const model={
    state:{records:[{id:"normalized-memory-RO"}]},
    settings:{schemaVersion:9,store:{name:"normalized-memory-store"}},
    appointments:{days:{"2026-02-01":{}}},
    performance:{snapshots:{"2026-02":{value:"memory"}}}
  };
  const BACKUP_FILES={
    [paths[0]]:()=>model.state,
    [paths[1]]:()=>model.settings,
    [paths[2]]:()=>model.appointments,
    [paths[3]]:()=>model.performance
  };
  let archive=null,validated=0;
  class FakeZip{
    constructor(){this.files=new Map();archive=this;}
    file(key,bytes){this.files.set(key,bytes);return this;}
    async generateAsync(){return encode("synthetic-archive");}
  }
  const context=vm.createContext({
    BACKUP_FILES,model,JSZip:FakeZip,VERSION:"synthetic",BUILD_DATE:"synthetic",TextEncoder,TextDecoder,
    utf8:encode,decodeUtf8:decode,now:()=>"2026-01-01T00:00:00.000Z",stamp:()=>"synthetic",
    backupFileName:prefix=>prefix+".zip",
    sha256:hash,
    validateDurableObject:(_path,value)=>{if(!value||typeof value!=="object")throw Error("invalid value");},
    readFileBytes:async parts=>{const b=files.get(parts.join("/"));if(!b)throw missing();return new Uint8Array(b);},
    directoryFiles:async()=>[...files.entries()].filter(([p])=>p.startsWith("data/history/")).map(([p,b])=>({name:p.split("/").at(-1),bytes:new Uint8Array(b)})),
    validateBackupBytes:async()=>{validated++;const m=JSON.parse(archive.files.get("manifest.json"));return{manifest:m};},
    writeBytes:async(parts,bytes)=>{files.set(parts.join("/"),new Uint8Array(bytes));}
  });
  vm.runInContext(maker+"\n"+writer+
    "\nglobalThis.make=createBackupBytes;globalThis.writeSafety=writeValidatedBackup;",context);
  return{
    files,model,paths,originals,
    create:type=>context.make("synthetic-test",type),
    writeSafety:()=>context.writeSafety("safety","MoonDog Restore Safety"),
    get archive(){return archive;},
    get verified(){return validated;}
  };
}

test("restore safety archive preserves durable bytes instead of normalized model values",async()=>{
  const f=fixture();
  const result=await f.create("restore-safety");
  const manifest=result.manifest;
  assert.equal(manifest.type,"restore-safety");
  assert.equal(manifest.settingsSchema,4);
  assert.equal(manifest.recordCounts.openRos,1);
  assert.equal(manifest.recordCounts.appointmentDays,1);
  assert.equal(manifest.recordCounts.performanceSnapshots,1);
  assert.equal(manifest.recordCounts.historyFiles,1);
  for(const p of f.paths){
    assert.deepEqual(f.archive.files.get("payload/"+p),f.files.get(p));
    const entry=manifest.entries.find(e=>e.path===p);
    assert.equal(entry.size,f.files.get(p).length);
    assert.equal(entry.sha256,await hash(f.files.get(p)));
  }
  assert.deepEqual(f.archive.files.get("payload/data/history/2026-01.json"),f.files.get("data/history/2026-01.json"));
  assert.ok(f.verified>0);
});

test("restoring safety through the real backup writer selects durable mode",async()=>{
  const f=fixture();
  const output=await f.writeSafety();
  assert.equal(output.manifest.type,"restore-safety");
  assert.equal(output.manifest.settingsSchema,4);
  assert.equal(output.path,"backups/MoonDog Restore Safety.zip");
  assert.equal(decode(f.archive.files.get("payload/data/current-state.json")),decode(f.files.get("data/current-state.json")));
  assert.ok(f.files.has(output.path));
});

test("ordinary whole-state backup stays on its existing model serialization path",async()=>{
  const f=fixture();
  const result=await f.create("full");
  assert.equal(result.manifest.type,"full");
  assert.equal(result.manifest.settingsSchema,9);
  assert.equal(JSON.parse(decode(f.archive.files.get("payload/data/current-state.json"))).records[0].id,"normalized-memory-RO");
});

test("missing durable canonical data refuses restore safety archive generation",async()=>{
  const f=fixture();
  f.files.delete("data/settings.json");
  await assert.rejects(f.writeSafety(),/synthetic missing state/);
  assert.equal(f.files.has("backups/MoonDog Restore Safety.zip"),false);
});
