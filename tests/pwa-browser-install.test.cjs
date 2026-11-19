'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto,randomUUID}=require('node:crypto');
const {TextEncoder}=globalThis;
const modulePromise=import('../src/pwa/install_verified_browser_store.mjs');
const storePromise=import('../src/pwa/opfs-store.mjs');
const missing=()=>Object.assign(new Error('Not found'),{name:'NotFoundError'});
class File {
 constructor(name,bytes=new Uint8Array()){this.kind='file';this.name=name;this.bytes=bytes;}
 async getFile(){const b=this.bytes;return {arrayBuffer:async()=>b.slice().buffer,text:async()=>new TextDecoder().decode(b)};}
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

test('verified package produces a full independent OPFS runtime with no OS picker',async()=>{
 const s=storage(),x=await create(s);const r=await install(s,x.identity.storeId);
 assert.equal(r.status,'installed');assert.equal(r.productionReady,false);assert.equal(r.externalBackupVerified,false);
 assert.equal(await saved(x.store,'System Files/index.html'),'Synthetic app');
 assert.equal(JSON.parse(await saved(x.store,'INSTALLATION-MANIFEST.json')).format,'service-operations-dashboard-clean-install');
 await assert.rejects(x.store.getFileHandle('MOONDOG-PWA-INSTALL-INCOMPLETE.json'),{name:'NotFoundError'});
});
test('wrong ZIP hash does not write any installation files',async()=>{
 const s=storage(),x=await create(s);
 await assert.rejects(install(s,x.identity.storeId,{hash:'0'.repeat(64)}),/SHA-256 mismatch/);
 assert.equal(x.store.map.size,2);await assert.rejects(x.store.getFileHandle('INSTALLATION-MANIFEST.json'),{name:'NotFoundError'});
});
test('existing operational file refuses installation and stays byte-for-byte unchanged',async()=>{
 const s=storage(),x=await create(s),workspace=await x.store.getDirectoryHandle('System Files').then(z=>z.getDirectoryHandle('Workspace'));
 const data=await workspace.getDirectoryHandle('data');data.map.set('local-private-report.json',new File('local-private-report.json',bytes('do not touch')));
 await assert.rejects(install(s,x.identity.storeId),/contains data/);
 assert.equal(await saved(x.store,'System Files/Workspace/data/local-private-report.json'),'do not touch');
});
test('wrong-store ID cannot be adopted even if a different store exists',async()=>{
 const s=storage(),x=await create(s);
 await assert.rejects(install(s,randomUUID()),{name:'NotFoundError'});
 assert.equal(x.store.map.size,2);
});
test('altered package payload is rejected and leaves an incomplete install marker',async()=>{
 const s=storage(),x=await create(s),bad=await plan();
 bad.files.find(z=>z.path==='System Files/index.html').bytes=bytes('tampered');
 await assert.rejects(install(s,x.identity.storeId,{inspect:async()=>bad}),e=>e.incomplete===true&&/changed before/.test(e.message));
 assert.match(await saved(x.store,'MOONDOG-PWA-INSTALL-INCOMPLETE.json'),/incomplete/);
 await assert.rejects(install(s,x.identity.storeId),/already contains/);
});
test('same label in two new stores keeps application bytes separate',async()=>{
 const s=storage(),a=await create(s),b=await create(s);
 await install(s,a.identity.storeId);await install(s,b.identity.storeId);
 assert.notEqual(a.identity.storeId,b.identity.storeId);
 assert.equal(await saved(b.store,'System Files/index.html'),'Synthetic app');
 const fh=await a.store.getDirectoryHandle('System Files').then(d=>d.getFileHandle('index.html'));
 fh.bytes=bytes('First store manually changed after install');
 assert.equal(await saved(b.store,'System Files/index.html'),'Synthetic app');
});
test('missing verified app entry aborts before installation',async()=>{
 const s=storage(),x=await create(s),bad=await plan();bad.files=bad.files.filter(y=>y.path!=='System Files/index.html');
 await assert.rejects(install(s,x.identity.storeId,{inspect:async()=>bad}),/incomplete/);
 assert.equal(x.store.map.size,2);
});
test('unexpected application folder and filename traversal are refused',async()=>{
 const s=storage(),x=await create(s),bad=await plan();bad.files.push({path:'System Files/assets/../evil.js',bytes:bytes('x'),sha256:await hash(bytes('x'))});
 await assert.rejects(install(s,x.identity.storeId,{inspect:async()=>bad}),/invalid or duplicate/);
 assert.equal(x.store.map.size,2);
});

test('locked browser store cannot be installed by a concurrent tab',async()=>{
 const s=storage(),x=await create(s);
 await assert.rejects(install(s,x.identity.storeId,{locks:{request:async(n,o,fn)=>fn(null)}}),/Another tab owns/);
 assert.equal(x.store.map.size,2);
});

test('reloaded browser install checks official manifest SHA and every app file without reading report data',async()=>{
 const s=storage(),x=await create(s);await install(s,x.identity.storeId);
 const manifest=await x.store.getFileHandle('INSTALLATION-MANIFEST.json');
 const expected=await hash(manifest.bytes);
 const {inspectVerifiedBrowserInstallation}=await modulePromise;
 const proof=await inspectVerifiedBrowserInstallation({storage:s,crypto:webcrypto,storeId:x.identity.storeId,version:'0.10.17',expectedManifestHash:expected});
 assert.equal(proof.applicationVerified,true);
 assert.equal(proof.productionReady,false);
 assert.equal(proof.externalBackupVerified,false);
 assert.equal(proof.verifiedAppFiles,6);
 const data=await x.store.getDirectoryHandle('System Files').then(y=>y.getDirectoryHandle('Workspace')).then(y=>y.getDirectoryHandle('data'));
 data.map.set('private-ro-report.json',new File('private-ro-report.json',bytes('DO NOT READ private report')));
 const after=await inspectVerifiedBrowserInstallation({storage:s,crypto:webcrypto,storeId:x.identity.storeId,version:'0.10.17',expectedManifestHash:expected});
 assert.equal(after.verifiedAppFiles,6,'private operational reports are neither read nor exported by installer');
});
test('installed source changed after restart is rejected',async()=>{
 const s=storage(),x=await create(s);await install(s,x.identity.storeId);
 const manifest=await x.store.getFileHandle('INSTALLATION-MANIFEST.json'),expected=await hash(manifest.bytes);
 const f=await x.store.getDirectoryHandle('System Files').then(d=>d.getFileHandle('index.html'));
 f.bytes=bytes('Tampered dashboard');
 await assert.rejects((await modulePromise).inspectVerifiedBrowserInstallation({storage:s,crypto:webcrypto,storeId:x.identity.storeId,version:'0.10.17',expectedManifestHash:expected}),/changed/);
});
test('untrusted browser manifest hash cannot enable a store',async()=>{
 const s=storage(),x=await create(s);await install(s,x.identity.storeId);
 await assert.rejects((await modulePromise).inspectVerifiedBrowserInstallation({storage:s,crypto:webcrypto,storeId:x.identity.storeId,version:'0.10.17',expectedManifestHash:'0'.repeat(64)}),/differs/);
});