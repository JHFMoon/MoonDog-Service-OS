'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {webcrypto,randomUUID}=require('node:crypto');
const modulePromise=import('../src/pwa/synthetic_external_backup.mjs');
const storeModule=import('../src/pwa/opfs-store.mjs');
const crypto={randomUUID,subtle:webcrypto.subtle};
const bytes=value=>new TextEncoder().encode(value);
const hash=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',value)).toString('hex');
const missing=()=>Object.assign(new Error('not found'),{name:'NotFoundError'});
class File {
  constructor(name){this.name=name;this.kind='file';this.bytes=new Uint8Array();}
  async getFile(){const copy=this.bytes.slice();return {
    size:copy.length,arrayBuffer:async()=>copy.buffer,text:async()=>new TextDecoder().decode(copy)
  };}
  async createWritable(){let pending=new Uint8Array();return {
    write:async data=>{pending=typeof data==='string'?bytes(data):new Uint8Array(data);},
    close:async()=>{this.bytes=pending;},abort:async()=>{}
  };}
}
class Dir {
  constructor(name){this.name=name;this.kind='directory';this.map=new Map();}
  async getDirectoryHandle(name,{create=false}={}){
    let entry=this.map.get(name);
    if(!entry&&create){entry=new Dir(name);this.map.set(name,entry);}
    if(!entry)throw missing();if(entry.kind!=='directory')throw Error('Expected directory');
    return entry;
  }
  async getFileHandle(name,{create=false}={}){
    let entry=this.map.get(name);
    if(!entry&&create){entry=new File(name);this.map.set(name,entry);}
    if(!entry)throw missing();if(entry.kind!=='file')throw Error('Expected file');
    return entry;
  }
  async *entries(){yield* this.map.entries();}
  async removeEntry(name){if(!this.map.delete(name))throw missing();}
}
const storage=()=>({root:new Dir('OPFS'),async getDirectory(){return this.root;}});
async function save(root,path,content){
  const parts=path.split('/');let directory=root;
  for(const part of parts.slice(0,-1))directory=await directory.getDirectoryHandle(part,{create:true});
  const file=await directory.getFileHandle(parts.at(-1),{create:true});
  file.bytes=bytes(content);return file;
}
const runtime=[
 ['00 - OPEN DASHBOARD.html','synthetic launcher'],
 ['System Files/index.html','<html>synthetic verified app</html>'],
 ['System Files/assets/app.js','const SYNTHETIC=true;'],
 ['System Files/vendor/jszip.min.js','synthetic vendor fixture'],
 ['System Files/Workspace/README.txt','SYNTHETIC workspace README']
];
async function installed(storeStorage,label,report){
  const {identity,store}=await(await storeModule).createEmptyStore({
    storage:storeStorage,crypto,label});
  const catalog=[];
  for(const [path,content] of runtime){
    await save(store,path,content);
    catalog.push({path,size:bytes(content).length,sha256:await hash(bytes(content))});
  }
  const manifest={format:'service-operations-dashboard-clean-install',
    formatVersion:1,version:'0.10.17',packageRoot:'Service Operations Dashboard',
    applicationRoot:'System Files',workspaceRoot:'System Files/Workspace',
    workspaceProtectedFromUpdates:true,files:catalog};
  const raw=JSON.stringify(manifest);await save(store,'INSTALLATION-MANIFEST.json',raw);
  await save(store,'System Files/Workspace/data/RO-100.json',report);
  const expectedManifestHash=await hash(bytes(raw));
  return {storage:storeStorage,crypto,locks:{request:async(_n,_opts,run)=>run({})},
    storeId:identity.storeId,version:'0.10.17',expectedManifestHash,store};
}
test('two synthetic stores with overlapping filenames export independently and verify offline',async()=>{
  const s=storage(),a=await installed(s,'SYNTHETIC A','{"ro":100,"owner":"A"}');
  const b=await installed(s,'SYNTHETIC B','{"ro":100,"owner":"B"}');
  const {createSyntheticExternalBackup,inspectSyntheticExternalBackup}=await modulePromise;
  const one=await createSyntheticExternalBackup(a),two=await createSyntheticExternalBackup(b);
  assert.notEqual(one.storeId,two.storeId);
  assert.notEqual(one.sha256,two.sha256);
  assert.equal(one.files.find(x=>x.path==='data/RO-100.json').base64,
    Buffer.from('{"ro":100,"owner":"A"}').toString('base64'));
  assert.equal(two.files.find(x=>x.path==='data/RO-100.json').base64,
    Buffer.from('{"ro":100,"owner":"B"}').toString('base64'));
  const verified=await inspectSyntheticExternalBackup({backup:one,crypto,
    expectedStoreId:a.storeId,expectedManifestHash:a.expectedManifestHash,version:a.version});
  assert.equal(verified.verified,true);assert.equal(verified.restoreAuthorized,false);
  assert.equal(one.productionReady,false);
  await assert.rejects(inspectSyntheticExternalBackup({backup:one,crypto,
    expectedStoreId:b.storeId,expectedManifestHash:b.expectedManifestHash,version:b.version}),/Wrong-store/);
});
test('modified data, manifest digest and forged layouts never validate',async()=>{
  const args=await installed(storage(),'SYNTHETIC tampering','{"synthetic":true}');
  const {createSyntheticExternalBackup,inspectSyntheticExternalBackup}=await modulePromise;
  const saved=await createSyntheticExternalBackup(args);
  const verify=backup=>inspectSyntheticExternalBackup({backup,crypto,
    expectedStoreId:args.storeId,expectedManifestHash:args.expectedManifestHash,version:args.version});
  let changed=structuredClone(saved);changed.files[0].base64='AAAA';
  await assert.rejects(verify(changed),/authenticated inventory|checksum/);
  changed=structuredClone(saved);changed.sha256='0'.repeat(64);
  await assert.rejects(verify(changed),/checksum/);
  changed=structuredClone(saved);changed.files[0].path='../other';
  await assert.rejects(verify(changed),/Unsafe/);
  changed=structuredClone(saved);changed.directories.push('DATA');
  await assert.rejects(verify(changed),/canonical|inconsistent|duplicate/);
  changed=structuredClone(saved);changed.productionReady=true;
  await assert.rejects(verify(changed),/incomplete/);
});
test('live lock contention and non-synthetic labels refuse export with no state mutation',async()=>{
  const args=await installed(storage(),'SYNTHETIC locked','unchanged original');
  const {createSyntheticExternalBackup}=await modulePromise;
  await assert.rejects(createSyntheticExternalBackup({...args,
    locks:{request:async(_n,_o,run)=>run(null)}}),/active tab/);
  const root=await args.store.getDirectoryHandle('System Files')
    .then(dir=>dir.getDirectoryHandle('Workspace'))
    .then(dir=>dir.getDirectoryHandle('data'));
  const report=await root.getFileHandle('RO-100.json');
  assert.equal(await(await report.getFile()).text(),'unchanged original');
  const unauthorized=await installed(storage(),'Actual Dealer','never export');
  await assert.rejects(createSyntheticExternalBackup(unauthorized),/SYNTHETIC/);
  const system=await unauthorized.store.getDirectoryHandle('System Files');
  const workspace=await system.getDirectoryHandle('Workspace');
  const data=await workspace.getDirectoryHandle('data');
  const original=await data.getFileHandle('RO-100.json');
  assert.equal(await (await original.getFile()).text(),'never export');
});
test('invalid install, oversized source file and unsafe path fail closed before export',async()=>{
  const args=await installed(storage(),'SYNTHETIC storage','safe');
  const {createSyntheticExternalBackup}=await modulePromise;
  const dirty=await args.store.getDirectoryHandle('System Files')
    .then(x=>x.getDirectoryHandle('Workspace')).then(x=>x.getDirectoryHandle('data'));
  (await dirty.getFileHandle('RO-100.json')).bytes=new Uint8Array(8*1024*1024+1);
  await assert.rejects(createSyntheticExternalBackup(args),/too large/);
  (await dirty.getFileHandle('RO-100.json')).bytes=bytes('safe');
  await save(args.store,'MOONDOG-PWA-INSTALL-INCOMPLETE.json','incomplete');
  await assert.rejects(createSyntheticExternalBackup(args),/incomplete/);
});

test('backup module mirrors reviewed source and is not enabled for real data',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const root=path.join(__dirname,'..');
  const source=fs.readFileSync(path.join(root,'src/pwa/synthetic_external_backup.mjs'));
  const site=fs.readFileSync(path.join(root,'distribution/site/web-preview/modules/synthetic_external_backup.mjs'));
  assert.deepEqual(site,source);
  assert.doesNotMatch(source.toString(),/fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|cache\.put/);
  const sw=fs.readFileSync(path.join(root,'distribution/site/web-preview/sw.js'),'utf8');
  assert.doesNotMatch(sw,/synthetic_external_backup\.mjs/);
});
