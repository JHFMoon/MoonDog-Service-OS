"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
if(!globalThis.crypto)globalThis.crypto=crypto.webcrypto;
const {safeWrite}=require("../assets/maintenance.js");

test("independent operational-metrics writers reject a stale candidate before it overwrites persisted state",async()=>{
  const path="data/operational-metrics.json";
  const encode=value=>new TextEncoder().encode(JSON.stringify(value));
  const decode=bytes=>JSON.parse(new TextDecoder().decode(bytes));
  const missing=()=>Object.assign(Error("Synthetic file missing"),{name:"NotFoundError"});
  const initial=encode({schemaVersion:1,updatedAt:"synthetic-prior",menu:{snapshots:{}},csi:{imports:[]}});
  const accepted=encode({schemaVersion:1,updatedAt:"synthetic-writer-a",menu:{snapshots:{}},csi:{imports:["synthetic-a"]}});
  const stale=encode({schemaVersion:1,updatedAt:"synthetic-writer-b",menu:{snapshots:{"2026-11-02":{store:{roCount:1}}}},csi:{imports:[]}});
  const files=new Map([[path,initial]]);
  const failures=[],targetWrites=[];
  let revision=0,signalPreflight,releasePreflight;
  const preflight=new Promise(resolve=>{signalPreflight=resolve;});
  const paused=new Promise(resolve=>{releasePreflight=resolve;});

  function writer(name,pauseAtPreflight=false){
    let targetReads=0;
    return{
      journalTarget:filePath=>"System Files/Workspace/"+filePath,
      async read(filePath){
        if(filePath===path&&++targetReads===2&&pauseAtPreflight){
          signalPreflight();
          await paused;
        }
        const bytes=files.get(filePath);
        if(!bytes)throw missing();
        return new Uint8Array(bytes);
      },
      async beginMutation(){return{expected:revision};},
      async rawWrite(filePath,bytes){
        if(filePath===path)targetWrites.push(name);
        files.set(filePath,new Uint8Array(bytes));
        await Promise.resolve();
      },
      async completeMutation(token){
        if(revision!==token.expected)throw Error("synthetic stale store revision");
        revision++;
      },
      cancelMutation(){},
      async cleanupJournal(filePath){files.delete(filePath);},
      async remove(filePath){files.delete(filePath);},
      failure(result){failures.push({name,...result});}
    };
  }

  const staleWrite=safeWrite(writer("stale",true),path,stale);
  await preflight;
  assert.equal(await safeWrite(writer("current"),path,accepted),true);
  releasePreflight();
  await assert.rejects(staleWrite,/File changed during write/);

  assert.deepEqual(decode(files.get(path)),JSON.parse(new TextDecoder().decode(accepted)),
    "the stale candidate must not replace the independently committed state");
  assert.deepEqual(targetWrites,["current"],"stale writer must stop before touching the target");
  assert.equal(revision,1);
  assert.equal(failures.length,1);
  assert.deepEqual(failures[0],{name:"stale",kind:"DURABLE WRITE FAILED",recovered:true,prepared:true});
  assert.equal([...files.keys()].filter(filePath=>filePath.includes(".moondog-txn-")).length,0,
    "the rejected pre-write journal is safely removed");
});
