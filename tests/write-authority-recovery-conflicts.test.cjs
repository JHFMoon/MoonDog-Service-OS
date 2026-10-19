"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const source=fs.readFileSync(path.join(__dirname,"..","assets/moondog-write-authority.js"),"utf8");
const begin=source.indexOf("  async function at("),end=source.indexOf("  async function validate(",begin);
assert.ok(begin>=0&&end>begin,"exercise actual production recovery and file operations");
const production=source.slice(begin,end);
const encode=value=>new TextEncoder().encode(JSON.stringify(value));
const asBytes=value=>value===null?null:new Uint8Array(value);
const missing=()=>Object.assign(Error("Synthetic missing"),{name:"NotFoundError"});
const before=encode({value:"prior"});
const after=encode({value:"interrupted write"});
const another=encode({value:"independent writer"});

function fixture(current=after,options={}){
  const files=new Map(),dirs=new Set(["data"]),actions=[];
  if(current!==null)files.set("data/state.json",asBytes(current));
  const journal=options.journalFormat==="moondog-delete-v1"?
    {format:"moondog-delete-v1",target:"data/state.json",kind:"file",before:[...before],revisionBefore:4}:
    options.journalFormat==="moondog-create-v1"?
    {format:"moondog-create-v1",target:"data/state.json",kind:"file",revisionBefore:4}:
    {format:"moondog-write-v1",target:"data/state.json",
      before:options.beforeNull?null:[...before],after:[...after],
      revisionBefore:4};
  files.set("data/.moondog-txn-synthetic.json",encode(journal));
  const directory=(prefix="")=>({
    kind:"directory",
    async getDirectoryHandle(name,{create=false}={}){
      const k=prefix?prefix+"/"+name:name;
      if(!dirs.has(k)){if(!create)throw missing();dirs.add(k);}
      return directory(k);
    },
    async getFileHandle(name,{create=false}={}){
      const k=prefix?prefix+"/"+name:name;
      if(!files.has(k)){if(!create)throw missing();files.set(k,new Uint8Array());}
      return {
        kind:"file",
        async getFile(){const b=files.get(k);if(!b)throw missing();return{
          text:async()=>new TextDecoder().decode(b),
          arrayBuffer:async()=>b.slice().buffer
        };},
        async createWritable(){
          let pending=new Uint8Array();
          return{
            async write(bytes){actions.push(["write",k]);pending=new Uint8Array(bytes);},
            async close(){actions.push(["close",k]);files.set(k,pending);},
            async abort(){actions.push(["abort",k]);}
          };
        }
      };
    },
    async removeEntry(name){
      const k=prefix?prefix+"/"+name:name;
      actions.push(["remove",k]);
      if(!files.delete(k))throw missing();
    },
    async *entries(){
      const parent=prefix?prefix+"/":"",seen=new Set();
      for(const name of [...files.keys(),...dirs]){
        if(!name.startsWith(parent)||name===prefix)continue;
        const suffix=name.slice(parent.length),child=suffix.split("/")[0];
        if(!child||seen.has(child))continue;
        seen.add(child);
        yield [child,dirs.has(parent+child)?directory(parent+child):{kind:"file",name:child}];
      }
    }
  });
  const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,Promise,crypto:globalThis.crypto});
  vm.runInContext("const encoder=new TextEncoder();\n"+production+"\nglobalThis.recoverPending=recoverPending;",context);
  return{
    files,actions,journal,
    recover:revision=>context.recoverPending(directory(),{schemaVersion:1,revision}),
    current:()=>files.get("data/state.json"),
    pending:()=>files.has("data/.moondog-txn-synthetic.json")
  };
}

test("unfinished journal rolls back verified after bytes to the exact original",async()=>{
  const f=fixture(after);
  await f.recover(4);
  assert.deepEqual(f.current(),before);
  assert.equal(f.pending(),false);
});

test("uncommitted journal with intact prior bytes is removed without affecting state",async()=>{
  const f=fixture(before);
  await f.recover(4);
  assert.deepEqual(f.current(),before);
  assert.equal(f.pending(),false);
});

test("conflicting replacement by a separate writer MUST NOT be overwritten on recovery",async()=>{
  const f=fixture(another);
  await assert.rejects(f.recover(4),/conflict|differs|changed|unrecognized/i);
  assert.deepEqual(f.current(),another,"independent writer bytes survive unchanged");
  assert.equal(f.pending(),true,"uncertain journal retained for manual review");
  assert.equal(f.actions.some(([act,name])=>name==="data/state.json"&&["write","remove"].includes(act)),false);
});

test("a journal from an unfinished new-file creation cannot delete unrelated bytes",async()=>{
  const f=fixture(another,{beforeNull:true});
  await assert.rejects(f.recover(4),/conflict|differs|changed|unrecognized/i);
  assert.deepEqual(f.current(),another);
  assert.equal(f.pending(),true);
});

test("uncommitted new-file save removes only the recorded new bytes",async()=>{
  const f=fixture(after,{beforeNull:true});
  await f.recover(4);
  assert.equal(f.current(),undefined);
  assert.equal(f.pending(),false);
});

test("uncommitted new-file write with already absent target clears stale journal safely",async()=>{
  const f=fixture(null,{beforeNull:true});
  await f.recover(4);
  assert.equal(f.current(),undefined);
  assert.equal(f.pending(),false);
});

test("committed journal with verified after bytes keeps committed value",async()=>{
  const f=fixture(after);
  await f.recover(5);
  assert.deepEqual(f.current(),after);
  assert.equal(f.pending(),false);
});

test("committed journal with contradictory bytes is blocked without rewriting data",async()=>{
  const f=fixture(another);
  await assert.rejects(f.recover(5),/differs|conflict/i);
  assert.deepEqual(f.current(),another);
  assert.equal(f.pending(),true);
});

test("malformed journal prior-byte arrays never trigger recovery writes",async()=>{
  const f=fixture(another);
  f.journal.before=[300];
  f.files.set("data/.moondog-txn-synthetic.json",encode(f.journal));
  await assert.rejects(f.recover(4),/bytes are invalid/i);
  assert.deepEqual(f.current(),another);
  assert.equal(f.pending(),true);
});

test("interrupted file deletion never overwrites different independent bytes",async()=>{
  const f=fixture(another,{journalFormat:"moondog-delete-v1"});
  await assert.rejects(f.recover(4),/conflicts with independent/i);
  assert.deepEqual(f.current(),another);
  assert.equal(f.pending(),true);
});

test("interrupted file deletion restores only a verified missing original",async()=>{
  const f=fixture(null,{journalFormat:"moondog-delete-v1"});
  await f.recover(4);
  assert.deepEqual(f.current(),before);
  assert.equal(f.pending(),false);
});

test("interrupted deletion before touching target does not rewrite the prior bytes",async()=>{
  const f=fixture(before,{journalFormat:"moondog-delete-v1"});
  await f.recover(4);
  assert.deepEqual(f.current(),before);
  assert.equal(f.pending(),false);
  assert.equal(f.actions.some(([act,name])=>act==="write"&&name==="data/state.json"),false);
});

test("interrupted creation never deletes a new independently populated file",async()=>{
  const f=fixture(another,{journalFormat:"moondog-create-v1"});
  await assert.rejects(f.recover(4),/conflicts with populated file/i);
  assert.deepEqual(f.current(),another);
  assert.equal(f.pending(),true);
});

test("interrupted creation may remove only a still-empty created file",async()=>{
  const f=fixture(new Uint8Array(),{journalFormat:"moondog-create-v1"});
  await f.recover(4);
  assert.equal(f.current(),undefined);
  assert.equal(f.pending(),false);
});

test("interrupted creation with already missing target clears journal",async()=>{
  const f=fixture(null,{journalFormat:"moondog-create-v1"});
  await f.recover(4);
  assert.equal(f.current(),undefined);
  assert.equal(f.pending(),false);
});
