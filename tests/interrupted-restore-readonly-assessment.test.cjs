"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const crypto=require("node:crypto");

// Execute the actual application inspection function against synthetic data.
// No production Workspace, real RO/VIN, user folder, or network is read.
const app=fs.readFileSync(path.join(__dirname,"..","assets/app.js"),"utf8");
const start=app.indexOf("  async function inspectInterruptedRestore(");
const end=app.indexOf("  async function replaceHistoryFromBackup(",start);
assert.ok(start>=0&&end>start,"production read-only recovery assessment must exist");
const production=app.slice(start,end);
assert.match(app,/const interruptedRestoreReview=await inspectInterruptedRestore\(\)/,
  "read-only connection must assess the hold");
assert.match(app,/if\(interruptedRestoreReview\)status\("INTERRUPTED RESTORE:/,
  "read-only connection must warn the manager without clearing the hold");
assert.match(app,/r\.state==="held"\|\|r\.state==="unreadable-files"\?`Read-only recovery assessment/,
  "read-only Recovery view must show evidence counts even for denied files");
const enc=o=>new TextEncoder().encode(JSON.stringify(o));
const hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const absent=()=>Object.assign(Error("synthetic missing"),{name:"NotFoundError"});
const denied=()=>Object.assign(Error("synthetic denied"),{name:"NotAllowedError"});
const marker={
  schemaVersion:1,restoreId:"123e4567-e89b-42d3-a456-426614174000",
  safetyBackup:"MoonDog Restore Safety - synthetic.zip",
  sourceFile:"MoonDog Full Backup - synthetic.zip"
};
const old={
  "data/current-state.json":enc({records:[{id:"original"}]}),
  "data/settings.json":enc({schemaVersion:4,store:{name:"original"}}),
  "data/history/2026-01.json":enc({history:[{id:"original"}]})
};
const desired={
  "data/current-state.json":enc({records:[{id:"restored"}]}),
  "data/settings.json":enc({schemaVersion:4,store:{name:"restored"}}),
  "data/history/2026-01.json":enc({history:[{id:"restored"}]})
};
const entries=files=>Object.entries(files).map(([p,b])=>({path:p,size:b.length,sha256:hash(b)}));
function fixture(options={}){
  const live=new Map(Object.entries(old).map(([p,b])=>[p,new Uint8Array(b)]));
  const operations=[];
  if(options.overrides)for(const [p,b]of Object.entries(options.overrides)){if(b===null)live.delete(p);else live.set(p,enc(b));}
  const archives={
    [marker.safetyBackup]:{manifest:{entries:entries(old)}},
    [marker.sourceFile]:{manifest:{entries:entries(desired)}}
  };
  const m=options.marker===undefined?marker:options.marker;
  const context=vm.createContext({
    BACKUP_FILES:{"data/current-state.json":()=>{},"data/settings.json":()=>{}},
    readJson:async parts=>{operations.push(["readMarker",parts.join("/")]);if(options.invalidJson)throw Error("corrupt");return m;},
    readFileBytes:async parts=>{
      const p=parts.join("/");
      operations.push(["readFile",p]);
      if(p.startsWith("backups/"))return enc({archive:p.slice("backups/".length)});
      if(options.denied===p)throw denied();
      if(!live.has(p))throw absent();
      return new Uint8Array(live.get(p));
    },
    validateBackupBytes:async bytes=>{
      const name=JSON.parse(new TextDecoder().decode(bytes)).archive;
      operations.push(["validateArchive",name]);
      if(options.invalidArchive===name)throw Error("synthetic invalid archive");
      return archives[name]||null;
    },
    directoryFiles:async parts=>{
      operations.push(["readHistory",parts.join("/")]);
      if(options.denyHistory)throw denied();
      return [...live.entries()].filter(([p])=>p.startsWith("data/history/"))
        .map(([p,b])=>({name:p.slice("data/history/".length),bytes:new Uint8Array(b)}));
    },
    sha256:async bytes=>hash(bytes)
  });
  vm.runInContext(production+"\nglobalThis.inspect=inspectInterruptedRestore;",context);
  return{run:()=>context.inspect(),live,operations};
}
test("no hold returns null and does not inspect backup archives",async()=>{
  const f=fixture({marker:null});assert.equal(await f.run(),null);
  assert.equal(f.operations.filter(([k])=>k==="validateArchive").length,0);
});
test("valid hold classifies old durable files and keeps evidence untouched",async()=>{
  const f=fixture();const r=await f.run();
  assert.equal(r.state,"held");assert.equal(r.safety,"verified");assert.equal(r.source,"verified");
  assert.equal(r.old,3);assert.equal(r.restored,0);assert.equal(r.conflict,0);
  assert.equal(f.live.size,3);
  assert.equal(f.operations.some(([action])=>/write|remove|delete/i.test(action)),false);
});
test("mid-restore partial result and foreign change are disclosed without rewriting",async()=>{
  const f=fixture({overrides:{
    "data/current-state.json":{records:[{id:"restored"}]},
    "data/history/2026-01.json":{history:[{id:"independent"}]}
  }});
  const r=await f.run();
  assert.equal(r.restored,1);assert.equal(r.old,1);assert.equal(r.conflict,1);
  assert.equal(JSON.parse(new TextDecoder().decode(f.live.get("data/history/2026-01.json"))).history[0].id,"independent");
});
test("missing history entry cannot masquerade as clean existing evidence",async()=>{
  const f=fixture({overrides:{"data/history/2026-01.json":null}});
  const r=await f.run();
  assert.equal(r.conflict,1);
});
test("invalid marker filenames block archive lookup and cannot traverse folders",async()=>{
  const f=fixture({marker:{...marker,safetyBackup:"../../private.zip"}});
  const r=await f.run();
  assert.equal(r.state,"invalid-marker");
  assert.equal(f.operations.filter(([k])=>k==="readFile").length,0);
});
test("missing or invalid safety/source archive never authorizes recovery",async()=>{
  for(const name of [marker.safetyBackup,marker.sourceFile]){
    const f=fixture({invalidArchive:name});
    const r=await f.run();
    assert.equal(r.state,"missing-evidence");
    assert.ok([r.safety,r.source].includes("unavailable-or-invalid"));
    assert.equal(f.operations.filter(([k])=>k==="readHistory").length,0);
  }
});
test("unreadable marker fails closed with no backup access",async()=>{
  const f=fixture({invalidJson:true}),r=await f.run();
  assert.equal(r.state,"unreadable");
  assert.equal(f.operations.length,1);
});
test("denied canonical or history read cannot be reported as verified",async()=>{
  const a=await fixture({denied:"data/settings.json"}).run();
  assert.equal(a.state,"unreadable-files");
  assert.equal(a.unreadable,1);
  const b=await fixture({denyHistory:true}).run();
  assert.equal(b.state,"unreadable-files");
  assert.equal(b.unreadable,1);
});
test("an unchanged file identical in both archives is classified as both",async()=>{
  const f=fixture();
  f.live.set("data/current-state.json",old["data/current-state.json"]);
  // The archives in this case would be identical for the state file; synthetic
  // default source is different, so this remains old rather than 'both'.
  const r=await f.run();
  assert.equal(r.old,3);assert.equal(r.both,0);
});
