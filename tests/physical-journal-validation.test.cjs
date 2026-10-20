"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const crypto=require("node:crypto");
if(!globalThis.crypto)globalThis.crypto=crypto.webcrypto;
const {safeWrite}=require("../assets/maintenance.js");

// Tests production safeWrite together with the production write-authority
// validation gate under the real selected-folder/Workspace path split.
// All filesystem bytes are synthetic Maps: no installed Workspace is opened.
const app=fs.readFileSync(path.join(__dirname,"..","assets/app.js"),"utf8");
const authority=fs.readFileSync(path.join(__dirname,"..","assets/moondog-write-authority.js"),"utf8");
assert.match(app,/const WORKSPACE_PREFIX = \["System Files", "Workspace"\]/);
assert.match(app,/journalTarget:p=>physicalWorkspacePath\(p.split\('\/'\)\)\.join\('\/'\)/,
  "the production maintenance adapter must map logical journal targets to selected-folder physical paths");
const begin=authority.indexOf("  async function at(");
const end=authority.indexOf("  async function provision(",begin);
assert.ok(begin>=0&&end>begin,"execute actual production recovery and validate functions");
const production=authority.slice(begin,end);
const logical="data/current-state.json";
const physical="System Files/Workspace/"+logical;
const journalParent="System Files/Workspace/data/";
const encode=o=>new TextEncoder().encode(JSON.stringify(o));
const decode=b=>JSON.parse(new TextDecoder().decode(b));
const missing=()=>Object.assign(Error("Synthetic missing"),{name:"NotFoundError"});
const original=encode({schemaVersion:1,revision:1,records:[{id:"prior"}]});
const replacement=encode({schemaVersion:1,revision:2,records:[{id:"ours"}]});
const outsider=encode({schemaVersion:1,revision:3,records:[{id:"independent-writer"}]});

function fixture({foreign=false,interrupted=false}={}){
  const dirs=new Set(["System Files","System Files/Workspace","System Files/Workspace/data"]);
  const files=new Map([
    [physical,new Uint8Array(original)],
    [journalParent+"store-revision.json",encode({schemaVersion:1,revision:4})]
  ]);
  const actions=[],events=[];
  function directory(prefix=""){
    return{
      kind:"directory",
      queryPermission:async()=>"granted",
      async getDirectoryHandle(name,{create=false}={}){
        const p=prefix?prefix+"/"+name:name;
        if(!dirs.has(p)){if(!create)throw missing();dirs.add(p);}
        return directory(p);
      },
      async getFileHandle(name,{create=false}={}){
        const p=prefix?prefix+"/"+name:name;
        if(!files.has(p)){if(!create)throw missing();files.set(p,new Uint8Array());}
        return{
          kind:"file",
          async getFile(){
            const b=files.get(p);if(!b)throw missing();
            return{text:async()=>new TextDecoder().decode(b),arrayBuffer:async()=>b.slice().buffer};
          },
          async createWritable(){
            let pending=new Uint8Array();
            return{
              async write(bytes){actions.push(["write",p]);pending=typeof bytes==="string"?new TextEncoder().encode(bytes):new Uint8Array(bytes);},
              async close(){actions.push(["close",p]);files.set(p,pending);},
              async abort(){actions.push(["abort",p]);}
            };
          }
        };
      },
      async removeEntry(name){
        const p=prefix?prefix+"/"+name:name;
        actions.push(["remove",p]);
        if(!files.delete(p))throw missing();
      },
      async *entries(){
        const base=prefix?prefix+"/":"",seen=new Set();
        for(const p of [...dirs,...files.keys()]){
          if(!p.startsWith(base)||p===prefix)continue;
          const child=p.slice(base.length).split("/")[0];
          if(!child||seen.has(child))continue;
          seen.add(child);
          const full=base+child;
          yield [child,dirs.has(full)?directory(full):{kind:"file",name:child}];
        }
      }
    };
  }
  const ctx=vm.createContext({
    TextEncoder,TextDecoder,Uint8Array,Promise,crypto:globalThis.crypto,
    console:{warn(){}},setTimeout
  });
  const setup="const encoder=new TextEncoder();"+
    "const REVISION=['System Files','Workspace','data','store-revision.json'];"+
    "const originals=new WeakMap();let localRestoreOwner=null,nativeRoot=null,loadedRevision=null,activeToken=null;"+
    "let editable=true;const transientValidationDelays=[0];"+
    "const sleep=async()=>{};const denied=()=>new Error('read only');"+
    "const transientInterfaceState=()=>false;"+
    "function setEditable(v){editable=v;}function setTransientValidation(_){};";
  vm.runInContext(setup+"\n"+production+
    "\nglobalThis.validate=validate;globalThis.isEditable=()=>editable;globalThis.setRestoreSession=v=>{localRestoreOwner=v};",ctx);
  function physicalPath(p){return "System Files/Workspace/"+p;}
  function read(p){const b=files.get(physicalPath(p));if(!b)throw missing();return Promise.resolve(new Uint8Array(b));}
  const io={
    journalTarget:physicalPath,
    read,
    beginMutation:async()=>({expected:4}),
    async rawWrite(p,bytes){
      const full=physicalPath(p);
      actions.push(["ioWrite",full]);
      files.set(full,new Uint8Array(bytes));
      if(p===logical&&foreign)files.set(full,new Uint8Array(outsider));
      if(p===logical&&interrupted)throw Error("simulated file handle failure after target write");
    },
    async remove(p){const full=physicalPath(p);actions.push(["ioRemove",full]);files.delete(full);},
    async cleanupJournal(p){const full=physicalPath(p);actions.push(["cleanup",full]);files.delete(full);},
    completeMutation:async()=>events.push("commit"),
    cancelMutation:()=>events.push("cancel"),
    failure:info=>events.push(info)
  };
  return{
    io,files,actions,events,
    validate:()=>ctx.validate(directory(),false),
    editable:()=>ctx.isEditable(),
    setRestoreSession:value=>ctx.setRestoreSession(value),
    journals:()=>[...files.keys()].filter(p=>p.startsWith(journalParent+".moondog-txn-"))
  };
}

test("foreign OneDrive-like replacement leaves a physical journal and blocks subsequent editing",async()=>{
  const f=fixture({foreign:true});
  await assert.rejects(safeWrite(f.io,logical,replacement),/read-back mismatch/);
  assert.deepEqual(f.files.get(physical),outsider,"independent writer's bytes must survive");
  assert.equal(f.journals().length,1);
  const journal=decode(f.files.get(f.journals()[0]));
  assert.equal(journal.target,physical,"must match recoverPending's physical parent");
  assert.deepEqual(journal.before,[...original]);
  assert.deepEqual(journal.after,[...replacement]);
  assert.equal(journal.revisionBefore,4);
  assert.equal(await f.validate(),false,"actual production validator must block writes");
  assert.equal(f.editable(),false);
  assert.equal(f.journals().length,1);
  assert.equal(f.events.includes("commit"),false);
  assert.equal(f.actions.some(([action,target])=>target===physical&&["cleanup","ioRemove"].includes(action)),false);
});

test("interrupted target handle after writing retains a recoverable physical journal and disables edits",async()=>{
  const f=fixture({interrupted:true});
  await assert.rejects(safeWrite(f.io,logical,replacement),/file handle failure/);
  assert.deepEqual(f.files.get(physical),replacement);
  assert.equal(f.journals().length,1);
  assert.equal(decode(f.files.get(f.journals()[0])).target,physical);
  assert.equal(await f.validate(),false);
  assert.equal(f.editable(),false);
  assert.deepEqual(f.files.get(physical),replacement);
});

test("verified successful write clears journal and keeps subsequent editing available",async()=>{
  const f=fixture();
  assert.equal(await safeWrite(f.io,logical,replacement),true);
  assert.deepEqual(f.files.get(physical),replacement);
  assert.equal(f.journals().length,0);
  assert.equal(await f.validate(),true);
  assert.equal(f.editable(),true);
});

test("unfinished durable restore marker blocks editing after a reconnect",async()=>{
  const f=fixture();
  const marker="System Files/Workspace/data/restore-in-progress.json";
  f.files.set(marker,encode({schemaVersion:1,safetyBackup:"synthetic-safety.zip"}));
  assert.equal(await f.validate(),false,"actual production write validator must block unfinished restores");
  assert.equal(f.editable(),false);
  assert.equal(f.files.has(marker),true,"never remove an uncertain restore hold automatically");
});

test("only the initiating restore session may validate while a recovery hold is active",async()=>{
  const f=fixture();
  const marker="System Files/Workspace/data/restore-in-progress.json";
  f.files.set(marker,encode({schemaVersion:1,safetyBackup:"synthetic-safety.zip"}));
  const owner="123e4567-e89b-42d3-a456-426614174000";
  f.files.set(marker,encode({schemaVersion:1,restoreId:owner,safetyBackup:"synthetic-safety.zip"}));
  f.setRestoreSession(owner);
  assert.equal(await f.validate(),true,"same initiating tab must be able to finish its protected writes");
  f.setRestoreSession(null);
  assert.equal(await f.validate(),false,"other tabs/reconnects must not bypass the durable hold");
  assert.equal(f.files.has(marker),true);
});
