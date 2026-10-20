"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"..","assets/moondog-write-authority.js"),"utf8");
function extract(start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"production write-authority implementation missing: "+start);
  return source.slice(a,b);
}
const guard=extract("  function requireWrite(","  function wrapWritable(");
const mutations=extract("  let tail = Promise.resolve(), activeToken = null;","  async function journaledDelete(");
const owner="123e4567-e89b-42d3-a456-426614174000";
function fixture(){
  const context=vm.createContext({});
  const setup=`
    const denied=()=>new Error("read only");
    const REVISION=["System Files","Workspace","data","store-revision.json"];
    const root={};let editable=true,localRestoreOwner=null,loadedRevision=4,nativeRoot=root;
    let revision=4;
    const testEnabled=false;
    const validRevision=o=>o&&o.schemaVersion===1&&Number.isInteger(o.revision);
    async function read(){return {schemaVersion:1,revision};}
    async function write(_root,_path,value){revision=value.revision;}
    async function validate(){return true;}
    function setEditable(value){editable=value;}
  `;
  vm.runInContext(setup+"\n"+guard+"\n"+mutations+
    "\nglobalThis.begin=beginMutation;globalThis.complete=completeMutation;"+
    "globalThis.cancel=cancelMutation;globalThis.requireToken=requireToken;"+
    "globalThis.setRestoreOwner=value=>{localRestoreOwner=value};"+
    "globalThis.getRevision=()=>revision;",context);
  return{
    start:ownerId=>context.begin(ownerId),
    complete:token=>context.complete(token),
    cancel:token=>context.cancel(token),
    token:(token,restore)=>context.requireToken(token,restore),
    setOwner:id=>context.setRestoreOwner(id),
    revision:()=>context.getRevision()
  };
}

test("background same-page mutation cannot begin while a restore owns the scope",async()=>{
  const f=fixture();
  f.setOwner(owner);
  await assert.rejects(f.start(),/read only/);
  assert.equal(f.revision(),4);
});

test("correct restore scope allows versioned mutations and blocks interleaved jobs",async()=>{
  const f=fixture();
  f.setOwner(owner);
  await assert.rejects(f.start("123e4567-e89b-42d3-a456-426614174001"),/read only/);
  const token=await f.start(owner);
  assert.equal(token.restoreId,owner);
  assert.equal(f.token(token,false),undefined);
  await f.complete(token);
  assert.equal(f.revision(),5);
  await assert.rejects(f.start(),/read only/);
  f.setOwner(null);
  const ordinary=await f.start();
  await f.complete(ordinary);
  assert.equal(f.revision(),6);
});

test("a queued normal mutation cannot cross into a later restore scope",async()=>{
  const f=fixture();
  const pending=await f.start();
  f.setOwner(owner);
  assert.throws(()=>f.token(pending,false),/read only/);
  await assert.rejects(f.complete(pending),/read only/);
  f.cancel(pending);
  const own=await f.start(owner);
  await f.complete(own);
  assert.equal(f.revision(),5);
});
