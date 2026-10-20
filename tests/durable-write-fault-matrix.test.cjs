"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
if(!globalThis.crypto)globalThis.crypto=crypto.webcrypto;
const {safeWrite}=require("../assets/maintenance.js");

// Exercise the exported production safeWrite function against disposable
// synthetic filesystem bytes. No Windows installation or Workspace is opened.
const target="data/current-state.json";
const encode=value=>new TextEncoder().encode(JSON.stringify(value));
const decode=value=>JSON.parse(new TextDecoder().decode(value));
const missing=()=>Object.assign(Error("Synthetic file missing"),{name:"NotFoundError"});
function fixture(options={}){
  const original=encode({schemaVersion:1,updatedAt:"synthetic-previous",records:[]});
  const files=new Map(options.empty?[]:[[target,original.slice()]]);
  const failed=[],operations=[];let revision=0,started=0,completed=0,cancelled=0;
  const io={
    async read(path){
      operations.push(["read",path]);
      if(options.denyRead&&path===target)throw Object.assign(Error("permission denied"),{name:"NotAllowedError"});
      const bytes=files.get(path);if(!bytes)throw missing();return new Uint8Array(bytes);
    },
    async beginMutation(){operations.push(["begin"]);started++;return{expected:revision};},
    async rawWrite(path,bytes,token,restore=false){
      operations.push([restore?"restore":"write",path]);
      if(!restore&&path.includes(".moondog-txn-")&&options.failJournal){
        files.set(path,new Uint8Array([123,34,116]));
        throw Error("synthetic journal write interruption");
      }
      if(restore&&options.failRestore)throw Error("synthetic rollback denied");
      if(!restore&&path===target&&options.partialTarget){
        files.set(path,new Uint8Array([12,13]));return;
      }
      files.set(path,new Uint8Array(bytes));
      if(path.includes(".moondog-txn-")&&options.concurrentExternalEdit)
        files.set(target,encode({schemaVersion:1,updatedAt:"external-tab",records:[]}));
      if(!restore&&path===target&&options.externalAfterTargetWrite)
        files.set(target,encode({schemaVersion:1,updatedAt:"external-after-write",records:[{id:"independent"}]}));
      if(!restore&&path===target&&options.rejectAfterTargetWrite)
        throw Error("synthetic target write interrupted after replacement");
      await Promise.resolve();
    },
    async remove(path){operations.push(["remove",path]);files.delete(path);},
    async cleanupJournal(path){operations.push(["cleanup",path]);if(options.failCleanup)throw Error("synthetic journal cleanup lock");files.delete(path);},
    async completeMutation(){operations.push(["commit"]);revision++;completed++;},
    cancelMutation(){operations.push(["cancel"]);cancelled++;},
    failure(info){failed.push(info);}
  };
  return{io,files,original,failed,operations,get counts(){return{revision,started,completed,cancelled};}};
}
const journals=f=>[...f.files.keys()].filter(p=>p.includes(".moondog-txn-"));
const next=encode({schemaVersion:1,updatedAt:"synthetic-new",records:[]});

test("successful durable write read-back verifies bytes and removes completed journal",async()=>{
  const f=fixture();
  assert.equal(await safeWrite(f.io,target,next),true);
  assert.deepEqual(f.files.get(target),next);
  assert.equal(f.counts.completed,1);
  assert.equal(f.counts.revision,1);
  assert.equal(journals(f).length,0);
  assert.equal(f.failed.length,0);
});

test("two overlapping writes to one path serialize and retain the last verified revision",async()=>{
  const f=fixture(),first=encode({schemaVersion:1,updatedAt:"first",records:[]});
  const [a,b]=await Promise.all([safeWrite(f.io,target,first),safeWrite(f.io,target,next)]);
  assert.equal(a,true);assert.equal(b,true);
  assert.deepEqual(f.files.get(target),next);
  assert.deepEqual(f.counts,{revision:2,started:2,completed:2,cancelled:0});
  assert.equal(journals(f).length,0);
});

test("denied initial read never opens a mutation or touches original bytes",async()=>{
  const f=fixture({denyRead:true});
  await assert.rejects(safeWrite(f.io,target,next),/permission denied/);
  assert.deepEqual(f.files.get(target),f.original);
  assert.equal(f.counts.started,0);
  assert.equal(journals(f).length,0);
});

test("interrupted temporary journal creation refuses save and preserves original bytes",async()=>{
  const f=fixture({failJournal:true});
  await assert.rejects(safeWrite(f.io,target,next),/journal write interruption/);
  assert.deepEqual(f.files.get(target),f.original);
  assert.equal(f.counts.completed,0);
  assert.equal(f.failed.length,1);
  assert.equal(journals(f).length,0,"truncated journal residue removed after a rejected preparation");
});

test("partial target write fails closed and retains journal and original snapshot",async()=>{
  const f=fixture({partialTarget:true});
  await assert.rejects(safeWrite(f.io,target,next),/read-back mismatch/);
  assert.deepEqual(f.files.get(target),new Uint8Array([12,13]));
  assert.equal(f.counts.completed,0);
  assert.equal(journals(f).length,1);
  assert.equal(f.failed.length,1);
  assert.equal(f.failed[0].recovered,false);
  assert.deepEqual(decode(f.files.get(journals(f)[0])).before,[...f.original]);
  assert.equal(f.operations.some(([op,path])=>path===target&&["restore","remove"].includes(op)),false);
});

test("uncertain target write never attempts destructive rollback, even if restoration would fail",async()=>{
  const f=fixture({partialTarget:true,failRestore:true});
  await assert.rejects(safeWrite(f.io,target,next),/read-back mismatch/);
  assert.equal(f.counts.completed,0);
  assert.equal(journals(f).length,1);
  assert.equal(f.failed[0].recovered,false);
  assert.equal(f.operations.some(([op,path])=>op==="restore"&&path===target),false);
  const journal=decode(f.files.get(journals(f)[0]));
  assert.equal(journal.format,"moondog-write-v1");
  assert.deepEqual(journal.before,[...f.original]);
  assert.deepEqual(journal.after,[...next]);
});

test("out-of-band concurrent replacement is detected before touching another writer's bytes",async()=>{
  const f=fixture({concurrentExternalEdit:true});
  await assert.rejects(safeWrite(f.io,target,next),/File changed during write/);
  assert.equal(decode(f.files.get(target)).updatedAt,"external-tab");
  assert.equal(f.counts.completed,0);
  assert.equal(journals(f).length,0);
  assert.equal(f.failed[0].recovered,true);
});

test("new-file partial save preserves uncertain bytes and journal, not a blind deletion",async()=>{
  const f=fixture({empty:true,partialTarget:true});
  await assert.rejects(safeWrite(f.io,target,next),/read-back mismatch/);
  assert.deepEqual(f.files.get(target),new Uint8Array([12,13]));
  assert.equal(journals(f).length,1);
  assert.equal(decode(f.files.get(journals(f)[0])).before,null);
  assert.equal(f.counts.completed,0);
  assert.equal(f.operations.some(([op,path])=>op==="remove"&&path===target),false);
});

test("completed commit stays valid when journal cleanup transiently fails",async()=>{
  const f=fixture({failCleanup:true});
  assert.equal(await safeWrite(f.io,target,next),true);
  assert.deepEqual(f.files.get(target),next);
  assert.equal(f.counts.completed,1);
  assert.equal(journals(f).length,1,"journal is retained for cautious later review");
});

test("invalid JSON fails before mutation or journal creation",async()=>{
  const f=fixture();
  await assert.rejects(safeWrite(f.io,target,new Uint8Array([123])),SyntaxError);
  assert.deepEqual(f.files.get(target),f.original);
  assert.equal(f.counts.started,0);
  assert.equal(journals(f).length,0);
});

test("foreign replacement after target write cannot be overwritten by rollback",async()=>{
  const f=fixture({externalAfterTargetWrite:true});
  await assert.rejects(safeWrite(f.io,target,next),/read-back mismatch/);
  assert.equal(decode(f.files.get(target)).updatedAt,"external-after-write");
  assert.equal(f.counts.completed,0);
  assert.equal(f.failed[0].recovered,false);
  assert.equal(journals(f).length,1,"journal preserves old and attempted bytes for controlled recovery");
  assert.deepEqual(decode(f.files.get(journals(f)[0])).before,[...f.original]);
  assert.equal(f.operations.some(([op,path])=>path===target&&["restore","remove"].includes(op)),false);
});

test("foreign replacement survives even when the stale file handle throws after writing",async()=>{
  const f=fixture({externalAfterTargetWrite:true,rejectAfterTargetWrite:true});
  await assert.rejects(safeWrite(f.io,target,next),/synthetic target write interrupted/);
  assert.equal(decode(f.files.get(target)).updatedAt,"external-after-write");
  assert.equal(f.counts.completed,0);
  assert.equal(f.failed[0].recovered,false);
  assert.equal(journals(f).length,1);
  assert.equal(f.operations.some(([op,path])=>path===target&&["restore","remove"].includes(op)),false);
});
