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
  const start=app.indexOf("  async function verifyRestoredBackupState(entries){");
  const end=app.indexOf("\n  }",app.indexOf("    for(const file of actual)",start));
  assert.ok(start>=0&&end>start,"production restore verifier must exist");
  const verifier=app.slice(start,end+4);
  const state=new TextEncoder().encode("state");
  const history=new TextEncoder().encode("event");
  const sidecar=new TextEncoder().encode("{}");
  const digest=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
  const context=vm.createContext({
    BACKUP_FILES:{"data/state.json":true},
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
