'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {webcrypto,randomUUID}=require('node:crypto');
const lib=()=>import('../src/pwa/opfs-store.mjs');
const exporter=()=>import('../src/pwa/export_external_backup.mjs');
const restore=()=>import('../src/pwa/restore_external_backup.mjs');
const b=s=>new TextEncoder().encode(s),str=x=>new TextDecoder().decode(x);
const missing=()=>Object.assign(new Error('missing'),{name:'NotFoundError'});
class File{
 constructor(name,contents=new Uint8Array()){this.name=name;this.kind='file';this.bytes=contents;this.failRead=false;}
 async getFile(){let data=this.failRead?b('broken'):this.bytes;return {arrayBuffer:async()=>data.slice().buffer,text:async()=>str(data)};}
 async createWritable(){let staged=new Uint8Array();return {write:async chunk=>{staged=typeof chunk==='string'?b(chunk):new Uint8Array(chunk)},close:async()=>{this.bytes=staged},abort:async()=>{}};}
}
class Dir{
 constructor(name){this.name=name;this.kind='directory';this.map=new Map();}
 async getDirectoryHandle(name,{create=false}={}){let x=this.map.get(name);if(!x&&create){x=new Dir(name);this.map.set(name,x);}if(!x)throw missing();if(x.kind!=='directory')throw Error('wrong entry');return x;}
 async getFileHandle(name,{create=false}={}){let x=this.map.get(name);if(!x&&create){x=new File(name);this.map.set(name,x);}if(!x)throw missing();if(x.kind!=='file')throw Error('wrong entry');return x;}
 async *entries(){for(const x of this.map)yield x;}
 async removeEntry(name){if(!this.map.delete(name))throw missing();}
}
class Zip{
 constructor(){this.map=new Map();}
 get files(){return Object.fromEntries([...this.map].map(([name])=>[name,{name,dir:false}]));}
 file(path,contents){if(arguments.length>1){this.map.set(path,typeof contents==='string'?b(contents):new Uint8Array(contents));return this;}
 const data=this.map.get(path);return data?{async:async type=>type==='string'?str(data):data.slice()}:null;}
 async generateAsync(){return b(JSON.stringify([...this.map].map(([path,data])=>[path,Array.from(data)])));}
 static async loadAsync(bytes){const records=JSON.parse(str(bytes)),z=new Zip();for(const [name,data]of records)z.file(name,Uint8Array.from(data));return z;}
}
const locks={request:async(_key,_args,fn)=>fn({mode:'exclusive'})};
const storage=()=>({root:new Dir('OPFS'),getDirectory(){return Promise.resolve(this.root)}});
async function newStore(s){return (await lib()).createEmptyStore({storage:s,crypto:{randomUUID},label:'Synthetic only'});}
async function workspace(store){return store.getDirectoryHandle('System Files').then(d=>d.getDirectoryHandle('Workspace'));}
async function addFile(store,path,contents){let dir=await workspace(store);const bits=path.split('/');for(const part of bits.slice(0,-1))dir=await dir.getDirectoryHandle(part,{create:true});const f=await dir.getFileHandle(bits.at(-1),{create:true});f.bytes=b(contents);return f;}
async function createBackup(s,store,paths){for(const [p,contents]of paths)await addFile(store,p,contents);const destination=new File('export.zip');const x=await (await exporter()).exportExternalWorkspaceBackup({storage:s,storeId:store.name,crypto:webcrypto,locks,destination,JSZip:Zip});return {backup:destination.bytes,receipt:x};}
async function empty(s,store,paths){let w=await workspace(store);for(const path of paths){const bits=path.split('/');let d=w;for(const part of bits.slice(0,-1))d=await d.getDirectoryHandle(part);await d.removeEntry(bits.at(-1));}}
async function plan(contents){return (await restore()).inspectExternalBackup({archiveBytes:contents,crypto:webcrypto,JSZip:Zip});}
async function perform(s,storeId,contents,hash){return (await restore()).restoreExternalBackupToEmptyStore({storage:s,storeId,crypto:webcrypto,locks,JSZip:Zip,archiveBytes:contents,expectedArchiveHash:hash});}

test('verified backup can be restored to empty SAME synthetic store with byte-for-byte readback',async()=>{
 const s=storage(),a=await newStore(s);const original=[['data/state.json','{"synthetic":true}'],['imports/report.bin','original synthetic bytes']];
 const exported=await createBackup(s,a.store,original);await empty(s,a.store,original.map(x=>x[0]));
 const preview=await plan(exported.backup);
 assert.equal(preview.storeId,a.identity.storeId);assert.equal(preview.files,2);assert.equal(preview.identityAuthenticated,false);
 const done=await perform(s,a.identity.storeId,exported.backup,preview.archiveHash);
 assert.equal(done.status,'restored-and-verified');assert.equal(done.productionReady,false);
 const w=await workspace(a.store),data=await w.getDirectoryHandle('data'),imports=await w.getDirectoryHandle('imports');
 assert.equal(str((await data.getFileHandle('state.json')).bytes),'{"synthetic":true}');
 assert.equal(str((await imports.getFileHandle('report.bin')).bytes),'original synthetic bytes');
 assert.equal(await (await lib()).openExistingStore({storage:s,storeId:a.identity.storeId}).then(x=>x.identity.storeId),a.identity.storeId);
});
test('wrong-store backup refuses restore before modifying the target',async()=>{
 const s=storage(),a=await newStore(s),bStore=await newStore(s),archive=await createBackup(s,a.store,[['data/synthetic.txt','private']]);
 const preview=await plan(archive.backup);
 await assert.rejects(perform(s,bStore.identity.storeId,archive.backup,preview.archiveHash),/Wrong-store/);
 const target=await workspace(bStore.store);assert.equal((await target.getDirectoryHandle('data')).map.size,0);
});
test('existing operational file refuses overwrite and leaves original bytes intact',async()=>{
 const s=storage(),a=await newStore(s),archive=await createBackup(s,a.store,[['data/same.json','saved']]);
 const preview=await plan(archive.backup);
 await assert.rejects(perform(s,a.identity.storeId,archive.backup,preview.archiveHash),/already contains data/);
 assert.equal(str((await(await workspace(a.store)).getDirectoryHandle('data').then(d=>d.getFileHandle('same.json'))).bytes),'saved');
});
test('changed archive after preview refuses before creating a restore marker',async()=>{
 const s=storage(),a=await newStore(s),archive=await createBackup(s,a.store,[['data/f.txt','saved']]);
 await empty(s,a.store,['data/f.txt']);const preview=await plan(archive.backup);const modified=archive.backup.slice();modified[modified.length-1]^=1;
 await assert.rejects(perform(s,a.identity.storeId,modified,preview.archiveHash));
 await assert.rejects(a.store.getFileHandle('INCOMPLETE-SETUP.json'),{name:'NotFoundError'});
});
test('unexpected ZIP entry or corrupted private entry is refused before any write',async()=>{
 const s=storage(),a=await newStore(s),archive=await createBackup(s,a.store,[['data/f.txt','saved']]);
 await empty(s,a.store,['data/f.txt']);let zip=await Zip.loadAsync(archive.backup);zip.file('workspace/unlisted.bin',b('bad'));
 await assert.rejects(plan(await zip.generateAsync()),/Unexpected backup file/);
 zip=await Zip.loadAsync(archive.backup);zip.file('workspace/data/f.txt',b('tampered'));
 await assert.rejects(plan(await zip.generateAsync()),/SHA-256/);
 await assert.rejects(a.store.getFileHandle('INCOMPLETE-SETUP.json'),{name:'NotFoundError'});
});
test('write readback failure retains incomplete marker and blocks normal store opening',async()=>{
 const s=storage(),a=await newStore(s),archive=await createBackup(s,a.store,[['data/restore.txt','saved']]);
 await empty(s,a.store,['data/restore.txt']);const preview=await plan(archive.backup);
 const data=await (await workspace(a.store)).getDirectoryHandle('data');
 const old=data.getFileHandle.bind(data);
 data.getFileHandle=async (name,opts)=>{const f=await old(name,opts);if(opts?.create&&name==='restore.txt')f.failRead=true;return f;};
 await assert.rejects(perform(s,a.identity.storeId,archive.backup,preview.archiveHash),/Restore incomplete/);
 const marker=await a.store.getFileHandle('INCOMPLETE-SETUP.json');assert.ok(marker);
 await assert.rejects((await lib()).openExistingStore({storage:s,storeId:a.identity.storeId}),/incomplete/);
});
test('concurrent store restore lock unavailable leaves no durable marker',async()=>{
 const s=storage(),a=await newStore(s),archive=await createBackup(s,a.store,[['data/rest.txt','saved']]);
 await empty(s,a.store,['data/rest.txt']);const preview=await plan(archive.backup);
 await assert.rejects((await restore()).restoreExternalBackupToEmptyStore({storage:s,storeId:a.identity.storeId,archiveBytes:archive.backup,expectedArchiveHash:preview.archiveHash,crypto:webcrypto,JSZip:Zip,locks:{request:async(_n,_o,fn)=>fn(null)}}),/Another tab/);
 await assert.rejects(a.store.getFileHandle('INCOMPLETE-SETUP.json'),{name:'NotFoundError'});
});