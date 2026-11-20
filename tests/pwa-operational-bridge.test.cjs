'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID,webcrypto}=require('node:crypto');
const createStore=()=>import('../src/pwa/opfs-store.mjs');
const bridge=()=>import('../src/pwa/connect_operational_workspace.mjs');
const b=value=>new TextEncoder().encode(value);
const decode=value=>new TextDecoder().decode(value);
const missing=()=>Object.assign(new Error('not found'),{name:'NotFoundError'});
class File{
  constructor(name,value=new Uint8Array()){this.name=name;this.kind='file';this.content=value;}
  async getFile(){const saved=this.content.slice();return {arrayBuffer:async()=>saved.buffer,text:async()=>decode(saved)};}
  async createWritable(){let bytes;return {
    write:async value=>{bytes=typeof value==='string'?b(value):new Uint8Array(value);},
    close:async()=>{this.content=bytes.slice();},
    abort:async()=>{},seek:async()=>{},truncate:async()=>{}
  };}
  async isSameEntry(other){return this===other;}
}
class Dir{
  constructor(name){this.name=name;this.kind='directory';this.map=new Map();}
  async getDirectoryHandle(name,{create=false}={}){let item=this.map.get(name);if(!item&&create){item=new Dir(name);this.map.set(name,item);}if(!item)throw missing();if(item.kind!=='directory')throw Error('Type mismatch');return item;}
  async getFileHandle(name,{create=false}={}){let item=this.map.get(name);if(!item&&create){item=new File(name);this.map.set(name,item);}if(!item)throw missing();if(item.kind!=='file')throw Error('Type mismatch');return item;}
  async *entries(){yield* this.map.entries();}
  async removeEntry(name){if(!this.map.delete(name))throw missing();}
  async isSameEntry(other){return this===other;}
  async resolve(target){async function walk(dir,parts){if(dir===target)return parts;for(const [name,entry] of dir.map){if(entry===target)return [...parts,name];if(entry.kind==='directory'){const found=await walk(entry,[...parts,name]);if(found)return found;}}return null;}return walk(this,[]);}
}
const makeStorage=()=>({root:new Dir('OPFS'),getDirectory(){return Promise.resolve(this.root);}});
const sha=async raw=>Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256',raw)),n=>n.toString(16).padStart(2,'0')).join('');
async function save(root,path,contents){const parts=path.split('/');let dir=root;for(const name of parts.slice(0,-1))dir=await dir.getDirectoryHandle(name,{create:true});const file=await dir.getFileHandle(parts.at(-1),{create:true});file.content=contents;return file;}
async function fixture(storage){
  const {identity,store}=await(await createStore()).createEmptyStore({storage,crypto:{randomUUID},label:'Synthetic private store'});
  const app={
   '00 - OPEN DASHBOARD.html':b('synthetic launcher'),
   'System Files/index.html':b('<title>Synthetic real layout</title>'),
   'System Files/assets/app.js':b('/* synthetic public code */'),
   'System Files/assets/styles.css':b('/* synthetic public styles */'),
   'System Files/Workspace/README.txt':b('synthetic empty workspace')
  };
  const files=[];
  for(const [path,raw] of Object.entries(app)){await save(store,path,raw);files.push({path,size:raw.byteLength,sha256:await sha(raw)});}
  const manifest={format:'service-operations-dashboard-clean-install',formatVersion:1,version:'0.10.17',packageRoot:'Service Operations Dashboard',applicationRoot:'System Files',workspaceRoot:'System Files/Workspace',workspaceProtectedFromUpdates:true,files};
  const contents=b(JSON.stringify(manifest));await save(store,'INSTALLATION-MANIFEST.json',contents);
  return {identity,store,version:'0.10.17',expectedManifestHash:await sha(contents)};
}
function makeLocks({denied=false}={}){
 const held=new Set();return {request:async(key,_options,cb)=>{if(denied||held.has(key))return cb(null);held.add(key);try{return await cb({mode:'exclusive'});}finally{held.delete(key);}}};
}
const options=(storage,fixture,locks)=>({storage,crypto:webcrypto,locks,storeId:fixture.identity.storeId,version:fixture.version,expectedManifestHash:fixture.expectedManifestHash});
const open=async opts=>(await bridge()).openVerifiedOperationalWorkspace(opts);

test('actual inspected synthetic app root connects and permits only private Workspace mutations',async()=>{
 const storage=makeStorage(),f=await fixture(storage),session=await open(options(storage,f,makeLocks()));
 try{
  assert.equal(session.operationalModelConnected,false);
  assert.equal(await session.handle.queryPermission({mode:'readwrite'}),'granted');
  const system=await session.handle.getDirectoryHandle('System Files');
  const workspace=await system.getDirectoryHandle('Workspace');
  const data=await workspace.getDirectoryHandle('data',{create:true});
  const file=await data.getFileHandle('synthetic.json',{create:true});
  const stream=await file.createWritable();await stream.write(b('{"test":true}'));await stream.close();
  assert.equal(await(await file.getFile()).text(),'{"test":true}');
  assert.equal(await file.queryPermission({mode:'readwrite'}),'granted');
  assert.deepEqual(await session.handle.resolve(file),['System Files','Workspace','data','synthetic.json']);
  assert.equal(await file.isSameEntry(file),true);
 }finally{await session.close();}
 assert.equal(await session.handle.queryPermission({mode:'readwrite'}),'denied');
 await assert.rejects(session.handle.getDirectoryHandle('System Files'),/session is closed/);
});
test('browser application files and root identity cannot be written or removed',async()=>{
 const storage=makeStorage(),f=await fixture(storage),session=await open(options(storage,f,makeLocks()));
 try{
  const system=await session.handle.getDirectoryHandle('System Files'),index=await system.getFileHandle('index.html');
  assert.equal(await(await index.getFile()).text(),'<title>Synthetic real layout</title>');
  assert.equal(await index.queryPermission({mode:'readwrite'}),'denied');
  await assert.rejects(index.createWritable(),/read-only/);
  await assert.rejects(session.handle.getFileHandle('FOREIGN.txt',{create:true}),{name:'NotFoundError'});
  await assert.rejects(system.getDirectoryHandle('NEW CODE',{create:true}),{name:'NotFoundError'});
  await assert.rejects(system.removeEntry('index.html'),/Cannot remove/);
  await assert.rejects(session.handle.removeEntry('STORE-IDENTITY.json'),/Cannot remove/);
  await assert.rejects(session.handle.getDirectoryHandle('..',{create:true}),/Unsafe/);
  assert.equal((await f.store.getDirectoryHandle('System Files').then(d=>d.getFileHandle('index.html'))).content.length>0,true);
 }finally{await session.close();}
});
test('only wrapped handles from same verified session can establish same-entry relationships',async()=>{
 const storage=makeStorage(),a=await fixture(storage),bStore=await fixture(storage),locks=makeLocks();
 const one=await open(options(storage,a,locks)),two=await open(options(storage,bStore,locks));
 try{
  assert.equal(await one.handle.isSameEntry(one.handle),true);
  assert.equal(await one.handle.isSameEntry(two.handle),false);
  assert.equal(await one.handle.resolve(two.handle),null);
  const ws=await one.handle.getDirectoryHandle('System Files').then(d=>d.getDirectoryHandle('Workspace'));
  const privateWs=await two.handle.getDirectoryHandle('System Files').then(d=>d.getDirectoryHandle('Workspace'));
  assert.deepEqual(await one.handle.resolve(ws),['System Files','Workspace']);
  assert.equal(await one.handle.resolve(privateWs),null);
 }finally{await one.close();await two.close();}
});
test('changed public application fails verification before exposing an editable handle',async()=>{
 const storage=makeStorage(),f=await fixture(storage);
 const system=await f.store.getDirectoryHandle('System Files');(await system.getFileHandle('index.html')).content=b('tampered');
 await assert.rejects(open(options(storage,f,makeLocks())),/changed/);
});
test('unrecognized installed application file blocks production-shape Workspace bridge',async()=>{
 const storage=makeStorage(),f=await fixture(storage);await save(f.store,'System Files/assets/malicious.js',b('no'));
 await assert.rejects(open(options(storage,f,makeLocks())),/Unapproved/);
});
test('locked browser store rejects simultaneous second session; releasing lets retry succeed',async()=>{
 const storage=makeStorage(),f=await fixture(storage),locks=makeLocks(),opts=options(storage,f,locks);
 const a=await open(opts);
 await assert.rejects(open(opts),/Another MoonDog tab/);
 await a.close();const b=await open(opts);await b.close();
});
test('missing Web Locks or bad store identity never grants Workspace access',async()=>{
 const storage=makeStorage(),f=await fixture(storage);
 await assert.rejects(open({...options(storage,f,null),locks:null}),/cross-tab locking/);
 await assert.rejects(open({...options(storage,f,makeLocks()),storeId:randomUUID()}),{name:'NotFoundError'});
});
test('incomplete installation remains blocked from opening operational Workspace',async()=>{
 const storage=makeStorage(),f=await fixture(storage);
 await save(f.store,'MOONDOG-PWA-INSTALL-INCOMPLETE.json',b('incomplete'));
 await assert.rejects(open(options(storage,f,makeLocks())),/incomplete/);
});