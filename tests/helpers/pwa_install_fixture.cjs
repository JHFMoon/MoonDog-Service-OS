'use strict';
const {webcrypto,randomUUID}=require('node:crypto');
const {TextEncoder}=globalThis;
const modulePromise=import('../../src/pwa/install_verified_browser_store.mjs');
const storePromise=import('../../src/pwa/opfs-store.mjs');
const missing=()=>Object.assign(new Error('Not found'),{name:'NotFoundError'});
class File {
 constructor(name,bytes=new Uint8Array()){this.kind='file';this.name=name;this.bytes=bytes;}
 async getFile(){const b=this.bytes;return {size:b.byteLength,arrayBuffer:async()=>b.slice().buffer,text:async()=>new TextDecoder().decode(b)};}
 async createWritable(){let b=new Uint8Array();return {write:async v=>{b=typeof v==='string'?new TextEncoder().encode(v):new Uint8Array(v);},close:async()=>{this.bytes=b;},abort:async()=>{}};}
}
class Dir {
 constructor(name){this.kind='directory';this.name=name;this.map=new Map();}
 async getDirectoryHandle(name,{create=false}={}){
   let v=this.map.get(name);if(!v&&create){v=new Dir(name);this.map.set(name,v);}
   if(!v)throw missing();if(v.kind!=='directory')throw Error('File not directory');return v;
 }
 async getFileHandle(name,{create=false}={}){
   let v=this.map.get(name);if(!v&&create){v=new File(name);this.map.set(name,v);}
   if(!v)throw missing();if(v.kind!=='file')throw Error('Dir not file');return v;
 }
 async *entries(){for(const [name,value] of this.map)yield [name,value];}
 async removeEntry(name){if(!this.map.delete(name))throw missing();}
}
const storage=()=>({root:new Dir('origin'),getDirectory(){return Promise.resolve(this.root);}});
const encoder=new TextEncoder();
const bytes=s=>encoder.encode(s);
const hash=async b=>Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
const zip=bytes('this is a fully synthetic, non-ZIP input for a mocked inspector');
const locks={request:async(_name,_options,fn)=>fn({mode:'exclusive'})};
async function plan(){
 const raw=[
 ['00 - OPEN DASHBOARD.html','Synthetic launcher'],['README - START HERE.txt','Synthetic guide'],
 ['System Files/index.html','Synthetic app'],['System Files/assets/app.js','Fake js'],
 ['System Files/vendor/xlsx.full.min.js','Fake vendor'],['System Files/Workspace/README.txt','Synthetic empty Workspace']];
 const files=[];for(const [path,text] of raw)files.push({path,bytes:bytes(text),sha256:await hash(bytes(text))});
 const canonical={format:'service-operations-dashboard-clean-install',formatVersion:1,version:'0.10.17',
   packageRoot:'Service Operations Dashboard',applicationRoot:'System Files',workspaceRoot:'System Files/Workspace',
   workspaceProtectedFromUpdates:true,files:files.map(f=>({path:f.path,size:f.bytes.byteLength,sha256:f.sha256}))};
 files.push({path:'INSTALLATION-MANIFEST.json',bytes:bytes(JSON.stringify(canonical)),sha256:null});
 return {version:'0.10.17',files,directories:[
 'System Files/','System Files/assets/','System Files/vendor/','System Files/Workspace/',
 'System Files/Workspace/data/','System Files/Workspace/backups/','System Files/Workspace/imports/','System Files/Workspace/exports/']};
}
async function install(s,id,opts={}){
 const {installVerifiedBrowserStore}=await modulePromise;
 const good=await plan();const expected=await hash(zip);
 return installVerifiedBrowserStore({storage:s,crypto:webcrypto,locks:opts.locks||locks,storeId:id,zipBytes:zip,version:'0.10.17',expectedZipHash:opts.hash||expected,
 inspectVerifiedZip:opts.inspect|| (async()=>good)});
}
async function create(s){return (await storePromise).createEmptyStore({storage:s,crypto:{randomUUID},label:'Synthetic Dealer'});}
async function saved(d,p){let x=d;const parts=p.split('/');for(const name of parts.slice(0,-1))x=await x.getDirectoryHandle(name);return new TextDecoder().decode((await x.getFileHandle(parts.at(-1))).bytes);}


module.exports={storage,create,install,plan,hash,zip,bytes,saved,locks,File,Dir,webcrypto,randomUUID};
