"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  async function createCleanNewStoreCopy(destination){");
const end = app.indexOf("  function ensureNewStoreUi(){", start);
assert.ok(start > 0 && end > start, "production new-store functions must be available");
const productionFunctions = app.slice(start, end);

const missing = () => Object.assign(new Error("Missing file or directory"), {name:"NotFoundError"});
function folder(name, parent=null) {
  const entries=new Map();
  const handle={
    name,kind:"directory",parent,entriesMap:entries,
    queryPermission:async()=> "granted",
    requestPermission:async()=> "granted",
    resolve:async(other)=>{
      const parts=[];let current=other;
      while(current){if(current===handle)return parts.reverse();parts.push(current.name);current=current.parent;}
      return null;
    },
    entries:async function*(){yield* entries.entries();},
    getDirectoryHandle:async(name,options={})=>{
      let item=entries.get(name);
      if(!item){if(!options.create)throw missing();item=folder(name,handle);entries.set(name,item);}
      if(item.kind!=="directory")throw Error("Not a directory");
      return item;
    },
    getFileHandle:async(name,options={})=>{
      let item=entries.get(name);
      if(!item){if(!options.create)throw missing();item=file(name,handle);entries.set(name,item);}
      if(item.kind!=="file")throw Error("Not a file");
      return item;
    },
    removeEntry:async(name)=>{
      if(!entries.has(name))throw missing();
      entries.delete(name);
    }
  };
  return handle;
}
function file(name,parent) {
  let bytes=Buffer.alloc(0);
  return {
    kind:"file",name,parent,
    getFile:async()=>({
      arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),
      text:async()=>bytes.toString("utf8")
    }),
    createWritable:async()=>{
      let pending=null;
      return {
        write:async value=>{pending=Buffer.from(value);},
        close:async()=>{if(pending===null)throw Error("No write");bytes=pending;},
        abort:async()=>{}
      };
    }
  };
}
async function findFile(root,location){
  let current=root;const parts=location.split("/");
  for(const part of parts.slice(0,-1))current=await current.getDirectoryHandle(part);
  return current.getFileHandle(parts.at(-1));
}
async function readText(root,location){return (await(await findFile(root,location)).getFile()).text();}
const hash=async bytes=>crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex");

function harness(){
  const source=folder("previous-store-copy");
  const destination=folder("new-store-copy");
  const runtime=new Map([
    ["index.html",Buffer.from("<html>MOONDOG</html>")],
    ["assets/app.js",Buffer.from("production-runtime")],
    ["vendor/xlsx.full.min.js",Buffer.from("vendor-bundle")]
  ]);
  const fresh={
    "data/current-state.json":{schemaVersion:1,records:[],closedRecords:[]},
    "data/settings.json":{schemaVersion:5,store:{name:"",code:""},setup:{newStorePrepared:true}}
  };
  const ui={handoffCopyConfirm:{checked:true},handoffEraseConfirm:{checked:true},
    handoffPhrase:{value:"PREPARE NEW STORE"},handoffResult:{textContent:"",className:""}};
  const ctx=vm.createContext({
    connectedNativeRoot:source, model:{root:source}, ui,
    VERSION:"synthetic-beta", HANDOFF_RUNTIME_PATHS:[...runtime.keys()],
    runtimeFileBytes:async location=>new Uint8Array(runtime.get(location)),
    runtimeIntegrity:async()=>{
      const result={};
      for(const [location,bytes] of runtime)result[location]=await hash(bytes);
      return result;
    },
    sha256:hash,
    utf8:value=>new TextEncoder().encode(value),
    freshProductState:()=>structuredClone(fresh),
    portableContext:()=>"# Portable synthetic application context\n",
    now:()=> "2026-11-06T20:00:00Z",
    writeAuthority:{canWrite:false,reason:"PENDING_TRANSACTION",
      requireWrite:()=>{throw Error("Write authority must not be bypassed");}},
    window:{showDirectoryPicker:async()=>destination},
    console
  });
  vm.runInContext(productionFunctions+"\nglobalThis.prepareForNewStore=prepareForNewStore;globalThis.createCleanNewStoreCopy=createCleanNewStoreCopy;",ctx);
  return {ctx,source,destination,ui,runtime,fresh};
}

test("locked source creates an independent verified empty-store application without touching source",async()=>{
  const h=harness();
  const old=await h.source.getDirectoryHandle("System Files",{create:true});
  const ws=await old.getDirectoryHandle("Workspace",{create:true});
  const data=await ws.getDirectoryHandle("data",{create:true});
  const prior=await data.getFileHandle(".moondog-txn-locked.json",{create:true});
  const writer=await prior.createWritable();await writer.write("prior journal must survive");await writer.close();
  await h.ctx.prepareForNewStore();
  assert.equal(h.ui.handoffResult.className,"handoff-result success");
  assert.match(h.ui.handoffResult.textContent,/CLEAN NEW STORE READY/);
  assert.equal(await readText(h.source,"System Files/Workspace/data/.moondog-txn-locked.json"),"prior journal must survive");
  assert.match(await readText(h.destination,"00 - OPEN DASHBOARD.html"),/System Files\/index.html/);
  assert.equal(await readText(h.destination,"System Files/assets/app.js"),"production-runtime");
  assert.deepEqual(JSON.parse(await readText(h.destination,"System Files/Workspace/data/current-state.json")),h.fresh["data/current-state.json"]);
  assert.deepEqual(JSON.parse(await readText(h.destination,"System Files/Workspace/data/settings.json")),h.fresh["data/settings.json"]);
  assert.equal(JSON.parse(await readText(h.destination,"System Files/Workspace/data/store-revision.json")).revision,0);
  assert.equal((await h.destination.getDirectoryHandle("System Files")).kind,"directory");
  assert.equal((await h.destination.getDirectoryHandle("System Files")).entriesMap.get("Workspace").entriesMap.has("backups"),true);
  assert.equal((await ws.getDirectoryHandle("data")).entriesMap.has(".moondog-txn-locked.json"),true);
});

test("new-store export rejects the current folder, nested destinations, and nonempty folders",async()=>{
  const h=harness();
  await assert.rejects(h.ctx.createCleanNewStoreCopy(h.source),/outside the copied installation/);
  const child=await h.source.getDirectoryHandle("subfolder",{create:true});
  await assert.rejects(h.ctx.createCleanNewStoreCopy(child),/outside the copied installation/);
  await h.destination.getFileHandle("existing-private-file",{create:true});
  await assert.rejects(h.ctx.createCleanNewStoreCopy(h.destination),/completely empty folder/);
  assert.equal(h.destination.entriesMap.has("existing-private-file"),true);
  assert.equal(h.destination.entriesMap.has("System Files"),false);
});

test("an unfinished export is rolled back in the new destination, not the source",async()=>{
  const h=harness();
  const baseline=h.runtime.get("index.html").toString();
  // A runtime integrity mismatch before writes must preserve both installations.
  h.ctx.runtimeFileBytes=async location=>new Uint8Array(
    location==="assets/app.js"?Buffer.from("tampered-runtime"):h.runtime.get(location));
  await assert.rejects(h.ctx.createCleanNewStoreCopy(h.destination),/changed while preparing/);
  assert.equal(h.destination.entriesMap.size,0);
  assert.equal(h.runtime.get("index.html").toString(),baseline);
});
