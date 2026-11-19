'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {webcrypto,randomUUID}=require('node:crypto');
const {createEmptyStore}=awaitable();
function awaitable(){return {createEmptyStore:(...args)=>import('../src/pwa/opfs-store.mjs').then(m=>m.createEmptyStore(...args))};}
const backup=()=>import('../src/pwa/export_external_backup.mjs');
const b=s=>new TextEncoder().encode(s),str=x=>new TextDecoder().decode(x);
const missing=()=>Object.assign(new Error('missing'),{name:'NotFoundError'});
class File{
 constructor(name,contents=new Uint8Array()){this.name=name;this.kind='file';this.bytes=contents;this.failRead=false;this.writes=0;}
 async getFile(){let data=this.bytes;if(this.failRead)data=b('Corrupted readback');return {arrayBuffer:async()=>data.slice().buffer,text:async()=>str(data)};}
 async createWritable(){let staged=new Uint8Array();return {write:async chunk=>{staged=typeof chunk==='string'?b(chunk):new Uint8Array(chunk)},close:async()=>{this.bytes=staged;this.writes++;},abort:async()=>{}};}
}
class Dir{
 constructor(name){this.name=name;this.kind='directory';this.map=new Map();}
 async getDirectoryHandle(name,{create=false}={}){let x=this.map.get(name);if(!x&&create){x=new Dir(name);this.map.set(name,x);}if(!x)throw missing();if(x.kind!=='directory')throw Error('file in place of dir');return x;}
 async getFileHandle(name,{create=false}={}){let x=this.map.get(name);if(!x&&create){x=new File(name);this.map.set(name,x);}if(!x)throw missing();if(x.kind!=='file')throw Error('dir in place of file');return x;}
 async *entries(){for(const x of this.map)yield x;}
 async removeEntry(name){if(!this.map.delete(name))throw missing();}
}
class Zip{
 constructor(){this.map=new Map();}
 file(path,bytes){if(arguments.length>1){this.map.set(path,typeof bytes==='string'?b(bytes):new Uint8Array(bytes));return this;}
 const value=this.map.get(path);return value?{async:async type=>type==='string'?str(value):value.slice()}:null;}
 async generateAsync(){const entries=[...this.map].map(([path,bytes])=>[path,Array.from(bytes)]);return b(JSON.stringify(entries));}
 static async loadAsync(contents){const parsed=JSON.parse(str(contents)),zip=new Zip();for(const [name,raw]of parsed)zip.file(name,Uint8Array.from(raw));return zip;}
}
const storage=()=>({root:new Dir('root'),getDirectory(){return Promise.resolve(this.root)}});
const locks={request:async(_id,_opts,fn)=>fn({mode:'exclusive'})};
async function newStore(s){const a=await createEmptyStore({storage:s,crypto:{randomUUID},label:'Synthetic Store'});return a;}
async function addFile(store,path,contents){let cur=store;const bits=path.split('/');for(const p of bits.slice(0,-1))cur=await cur.getDirectoryHandle(p,{create:true});cur.map.set(bits.at(-1),new File(bits.at(-1),b(contents)));}
async function run(s,id,destination,extras={}){return (await backup()).exportExternalWorkspaceBackup({storage:s,storeId:id,crypto:webcrypto,locks:extras.locks||locks,destination,JSZip:Zip,now:()=> '2026-11-19T22:00:00Z'});}
test('exports only private Workspace and proves byte-for-byte external archive readback',async()=>{
 const s=storage(),a=await newStore(s),dest=new File('backup.zip');
 await addFile(a.store,'System Files/Workspace/data/synthetic.json','{ "value": 2 }');
 await addFile(a.store,'System Files/Workspace/imports/source-file.txt','Synthetic original bytes');
 await addFile(a.store,'System Files/assets/app.js','public app not part of private backup');
 const receipt=await run(s,a.identity.storeId,dest);
 assert.equal(receipt.status,'externally-verified');assert.equal(receipt.productionReady,false);assert.equal(receipt.restoreVerified,false);
 assert.equal(receipt.files,2);assert.equal(dest.writes,1);
 const archive=await Zip.loadAsync(dest.bytes);
 assert.equal(str(await archive.file('workspace/imports/source-file.txt').async('uint8array')),'Synthetic original bytes');
 assert.equal(archive.file('workspace/System Files/assets/app.js'),null);
});
test('different store cannot be backed up by misusing another store ID',async()=>{
 const s=storage(),a=await newStore(s),dest=new File('backup.zip');
 await assert.rejects(run(s,randomUUID(),dest),{name:'NotFoundError'});assert.equal(dest.writes,0);
 assert.equal(a.store.map.size,2);
});
test('browser store with unfinished installation must not export',async()=>{
 const s=storage(),a=await newStore(s),dest=new File('backup.zip');
 await addFile(a.store,'MOONDOG-PWA-INSTALL-INCOMPLETE.json','broken install');
 await assert.rejects(run(s,a.identity.storeId,dest),/incomplete/);assert.equal(dest.writes,0);
});
test('external destination readback mismatch never reports backup verified',async()=>{
 const s=storage(),a=await newStore(s),dest=new File('backup.zip');dest.failRead=true;
 await assert.rejects(run(s,a.identity.storeId,dest),/readback mismatch/);
 assert.equal(dest.writes,1);
});
test('refuses concurrent backup lock and leaves external file untouched',async()=>{
 const s=storage(),a=await newStore(s),dest=new File('backup.zip');
 await assert.rejects(run(s,a.identity.storeId,dest,{locks:{request:async(_,__,fn)=>fn(null)}}),/Another backup/);assert.equal(dest.writes,0);
});
test('source changed between enumeration and completion refuses to export',async()=>{
 const s=storage(),a=await newStore(s),dest=new File('backup.zip');
 await addFile(a.store,'System Files/Workspace/data/change.json','original');
 const data=await a.store.getDirectoryHandle('System Files').then(x=>x.getDirectoryHandle('Workspace')).then(x=>x.getDirectoryHandle('data'));
 const file=await data.getFileHandle('change.json'),orig=file.getFile.bind(file);let calls=0;
 file.getFile=async()=>{calls++;if(calls>=2)file.bytes=b('modified');return orig();};
 await assert.rejects(run(s,a.identity.storeId,dest),/changed during backup/);assert.equal(dest.writes,0);
});