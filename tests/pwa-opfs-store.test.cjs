"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
// Load the same native ES module used by the browser; preserve the repository's
// node --test tests/*.test.cjs CI selector without a parallel implementation.
const modulePromise = import('../src/pwa/opfs-store.mjs');
const createEmptyStore = async args => (await modulePromise).createEmptyStore(args);
const openExistingStore = async args => (await modulePromise).openExistingStore(args);
const storageCapabilities = async args => (await modulePromise).storageCapabilities(args);

function missing() { const error = new Error('No such entry'); error.name = 'NotFoundError'; return error; }
class FakeFile {
  constructor(name, initial='') { this.kind='file'; this.name=name; this.content=initial; }
  async getFile() { const contents=this.content; return {text:async()=>contents}; }
  async createWritable() {
    let replacement='';
    return {write:async x=>{replacement=String(x);},close:async()=>{this.content=replacement;},abort:async()=>{}};
  }
}
class FakeDirectory {
  constructor(name) { this.kind='directory';this.name=name;this.entriesMap=new Map();this.writes=0;this.badReadback=false; }
  async getDirectoryHandle(name,{create=false}={}) {
    let item=this.entriesMap.get(name);
    if (!item && create) {item=new FakeDirectory(name);this.entriesMap.set(name,item);}
    if (!item) throw missing();
    if (item.kind!=='directory') throw Error('Unexpected file');
    return item;
  }
  async getFileHandle(name,{create=false}={}) {
    let item=this.entriesMap.get(name);
    if (!item && create) {item=new FakeFile(name);this.entriesMap.set(name,item);}
    if (!item) throw missing();
    if (item.kind!=='file') throw Error('Unexpected directory');
    return item;
  }
  async removeEntry(name) {if(!this.entriesMap.delete(name))throw missing();}
}
const newStorage=()=>({root:new FakeDirectory('OPFS'),getDirectory(){return Promise.resolve(this.root);},persisted:async()=>false,estimate:async()=>({usage:0,quota:1000000})});
const crypto={randomUUID};
test('two stores with the same label are isolated and have no initialized operational data',async()=>{
  const storage=newStorage();
  const a=await createEmptyStore({storage,crypto,label:'Synthetic Dealership'});
  const b=await createEmptyStore({storage,crypto,label:'Synthetic Dealership'});
  assert.notEqual(a.identity.storeId,b.identity.storeId);
  assert.equal((await openExistingStore({storage,storeId:a.identity.storeId})).identity.storeId,a.identity.storeId);
  assert.equal((await openExistingStore({storage,storeId:b.identity.storeId})).identity.storeId,b.identity.storeId);
  const aData=await a.store.getDirectoryHandle('System Files').then(d=>d.getDirectoryHandle('Workspace')).then(d=>d.getDirectoryHandle('data'));
  const bData=await b.store.getDirectoryHandle('System Files').then(d=>d.getDirectoryHandle('Workspace')).then(d=>d.getDirectoryHandle('data'));
  assert.equal(aData.entriesMap.size,0);assert.equal(bData.entriesMap.size,0);
  aData.entriesMap.set('synthetic.txt',new FakeFile('synthetic.txt','synthetic source A'));
  assert.equal(bData.entriesMap.size,0,'writes to one browser store must not appear in another store');
});
test('opening missing store is read-only and never creates it',async()=>{
  const storage=newStorage(),id=randomUUID();
  await assert.rejects(openExistingStore({storage,storeId:id}),{name:'NotFoundError'});
  assert.equal(storage.root.entriesMap.size,0);
});
test('reject mismatched store identity and incomplete setup',async()=>{
  const storage=newStorage();
  const created=await createEmptyStore({storage,crypto,label:'Synthetic A'});
  const manifest=await created.store.getFileHandle('STORE-IDENTITY.json');
  manifest.content=manifest.content.replace(created.identity.storeId,randomUUID());
  await assert.rejects(openExistingStore({storage,storeId:created.identity.storeId}),/identity does not match/);
  const second=await createEmptyStore({storage,crypto,label:'Synthetic B'});
  second.store.entriesMap.set('INCOMPLETE-SETUP.json',new FakeFile('INCOMPLETE-SETUP.json','incomplete'));
  await assert.rejects(openExistingStore({storage,storeId:second.identity.storeId}),/incomplete/);
});
test('never adopt a colliding preexisting root',async()=>{
  const storage=newStorage();
  const id=randomUUID(),parent=await storage.root.getDirectoryHandle('MoonDog-PWA-v1',{create:true}).then(x=>x.getDirectoryHandle('stores',{create:true}));
  const before=await parent.getDirectoryHandle(id,{create:true});
  before.entriesMap.set('existing-store.txt',new FakeFile('existing-store.txt','ORIGINAL'));
  let calls=0;
  const created=await createEmptyStore({storage,crypto:{randomUUID(){return calls++===0?id:randomUUID();}},label:'Another Synthetic Store'});
  assert.notEqual(created.identity.storeId,id);
  assert.equal((await before.getFileHandle('existing-store.txt').then(f=>f.getFile()).then(f=>f.text())),'ORIGINAL');
});
test('storage failures fail closed, leave an incomplete marker and do not open as a live store',async()=>{
  const storage=newStorage();
  const original=FakeDirectory.prototype.getDirectoryHandle;
  FakeDirectory.prototype.getDirectoryHandle=async function(name,options){
    if(name==='backups'&&this.name==='Workspace')throw Error('synthetic browser-storage quota failure');
    return original.call(this,name,options);
  };
  try {
    const id=randomUUID();
    await assert.rejects(createEmptyStore({storage,crypto:{randomUUID:()=>id},label:'Synthetic Test'}),/quota failure/);
    await assert.rejects(openExistingStore({storage,storeId:id}),/incomplete/);
  } finally {FakeDirectory.prototype.getDirectoryHandle=original;}
});
test('browser storage status does not promise recovery or a verified backup',async()=>{
  const info=await storageCapabilities({storage:newStorage()});
  assert.equal(info.opfsAvailable,true);
  assert.equal(info.persistent,false);
  assert.equal(info.externalBackupVerified,false);
  assert.equal(info.productionReady,false);
});