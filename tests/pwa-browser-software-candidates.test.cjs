'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {webcrypto,randomUUID}=require('node:crypto');
const candidate=()=>import('../src/pwa/browser_software_candidates.mjs');
const stores=()=>import('../src/pwa/opfs-store.mjs');
const b=text=>new TextEncoder().encode(text),sha=async value=>Buffer.from(await webcrypto.subtle.digest('SHA-256',value)).toString('hex');
const missing=()=>Object.assign(new Error('missing'),{name:'NotFoundError'});
class File {
 constructor(name,data=new Uint8Array()){this.name=name;this.kind='file';this.bytes=data;}
 async getFile(){const bytes=this.bytes.slice();return {arrayBuffer:async()=>bytes.buffer,text:async()=>new TextDecoder().decode(bytes)};}
 async createWritable(){let pending=new Uint8Array();return {write:async value=>{pending=typeof value==='string'?b(value):new Uint8Array(value);},close:async()=>{this.bytes=pending.slice();},abort:async()=>{}};}
}
class Dir {
 constructor(name){this.name=name;this.kind='directory';this.map=new Map();}
 async getDirectoryHandle(name,{create=false}={}){let x=this.map.get(name);if(!x&&create){x=new Dir(name);this.map.set(name,x)}if(!x)throw missing();if(x.kind!=='directory')throw Object.assign(Error('wrong kind'),{name:'TypeMismatchError'});return x;}
 async getFileHandle(name,{create=false}={}){let x=this.map.get(name);if(!x&&create){x=new File(name);this.map.set(name,x)}if(!x)throw missing();if(x.kind!=='file')throw Object.assign(Error('wrong kind'),{name:'TypeMismatchError'});return x;}
 async removeEntry(name){if(!this.map.delete(name))throw missing();}
 async *entries(){yield* this.map.entries();}
}
const storage=()=>({root:new Dir('opfs'),getDirectory(){return Promise.resolve(this.root)}});
const crypto={randomUUID,subtle:webcrypto.subtle};
async function write(dir,path,data){const parts=path.split('/'),name=parts.pop();for(const part of parts)dir=await dir.getDirectoryHandle(part,{create:true});const f=await dir.getFileHandle(name,{create:true});f.bytes=data;}
async function read(dir,path){const parts=path.split('/'),name=parts.pop();for(const part of parts)dir=await dir.getDirectoryHandle(part);return new TextDecoder().decode((await dir.getFileHandle(name)).bytes);}
async function plan(version){
 const values=[
  ['00 - OPEN DASHBOARD.html','synthetic launcher'],['README - START HERE.txt','synthetic readme'],
  ['index.html','synthetic compat'],['System Files/index.html','<html>synthetic</html>'],
  ['System Files/assets/app.js','synthetic app'],['System Files/vendor/jszip.min.js','synthetic vendor'],
  ['System Files/Workspace/README.txt','blank only']];
 const entries=[];
 for(const [path,value] of values)entries.push({path,bytes:b(value),sha256:await sha(b(value))});
 const manifest={format:'service-operations-dashboard-clean-install',formatVersion:1,version,
  packageRoot:'Service Operations Dashboard',applicationRoot:'System Files',workspaceRoot:'System Files/Workspace',
  workspaceProtectedFromUpdates:true,files:entries.map(e=>({path:e.path,size:e.bytes.length,sha256:e.sha256}))};
 entries.push({path:'INSTALLATION-MANIFEST.json',bytes:b(JSON.stringify(manifest))});
 return {version,files:entries,directories:[]};
}
async function fixture(label='SYNTHETIC A'){
 const s=storage(),{store,identity}=await(await stores()).createEmptyStore({storage:s,crypto,label});
 const original=await plan('0.10.17');
 for(const entry of original.files)await write(store,entry.path,entry.bytes);
 await write(store,'System Files/Workspace/data/SAPR.json',b('original report, do not touch'));
 await write(store,'System Files/Workspace/data/manual.txt',b('manual override preserved'));
 const installedManifestHash=await sha(original.files.find(e=>e.path==='INSTALLATION-MANIFEST.json').bytes);
 const next=await plan('0.10.18-beta.456');
 const zipBytes=b('FAKE SYNTHETIC ZIP BYTES FOR TESTS');const zipHash=await sha(zipBytes);
 const locks={request:async(_name,_opts,fn)=>fn({mode:'exclusive'})};
 const args={storage:s,crypto,locks,storeId:identity.storeId,installedVersion:'0.10.17',installedManifestHash,
  version:'0.10.18-beta.456',zipBytes,zipHash,inspectVerifiedZip:async()=>next};
 return {store,identity,args,next};
}
test('verified software candidate stages outside store; all original Workspace/app bytes preserved',async()=>{
 const {store,identity,args}=await fixture();const {stageVerifiedBrowserSoftware,inspectStagedBrowserSoftware}=await candidate();
 const outcome=await stageVerifiedBrowserSoftware(args);
 assert.equal(outcome.status,'verified-staged');assert.equal(outcome.active,false);
 assert.equal(outcome.productionReady,false);
 assert.equal(await read(store,'System Files/Workspace/data/SAPR.json'),'original report, do not touch');
 assert.equal(await read(store,'System Files/Workspace/data/manual.txt'),'manual override preserved');
 assert.equal(await read(store,'System Files/index.html'),'<html>synthetic</html>');
 const proof=await inspectStagedBrowserSoftware({storage:args.storage,crypto,storeId:identity.storeId,
   version:args.version,zipHash:args.zipHash,expectedManifestHash:outcome.manifestHash});
 assert.equal(proof.status,'verified-staged');
 const root=await args.storage.root.getDirectoryHandle('MoonDog-PWA-v1');
 const stages=await root.getDirectoryHandle('software-candidates');
 const stagedStore=await stages.getDirectoryHandle(identity.storeId);
 const folder=await stagedStore.getDirectoryHandle(args.version+'-'+args.zipHash);
 await assert.rejects(folder.getDirectoryHandle('Workspace'),{name:'NotFoundError'});
 await assert.rejects(folder.getDirectoryHandle('System Files').then(d=>d.getDirectoryHandle('Workspace')),{name:'NotFoundError'});
 await assert.rejects(stageVerifiedBrowserSoftware(args),/already exists/);
});
test('tampered archive and unverified candidate bytes do not stage or mutate a Workspace',async()=>{
 const {store,args}=await fixture();const {stageVerifiedBrowserSoftware}=await candidate();
 await assert.rejects(stageVerifiedBrowserSoftware({...args,zipHash:'0'.repeat(64)}),/digest mismatch/);
 const modified=await plan(args.version);modified.files.find(x=>x.path==='System Files/index.html').bytes=b('tampered');
 await assert.rejects(stageVerifiedBrowserSoftware({...args,inspectVerifiedZip:async()=>modified}),/inventory differs|changed after verification/);
 assert.equal(await read(store,'System Files/Workspace/data/manual.txt'),'manual override preserved');
});
test('locked operational browser store and non-synthetic verified identity fail closed',async()=>{
 const {store,args}=await fixture();const {stageVerifiedBrowserSoftware}=await candidate();
 await assert.rejects(stageVerifiedBrowserSoftware({...args,locks:{request:async(_n,_o,fn)=>fn(null)}}),/must close/);
 const other=await fixture('REAL store');
 await assert.rejects(stageVerifiedBrowserSoftware(other.args),/restricted to verified synthetic/);
 assert.equal(await read(store,'System Files/Workspace/data/SAPR.json'),'original report, do not touch');
});
test('changed staged executable, extra file and incomplete marker are never considered verified',async()=>{
 const {args,identity}=await fixture();const {stageVerifiedBrowserSoftware,inspectStagedBrowserSoftware}=await candidate();
 const staged=await stageVerifiedBrowserSoftware(args);
 const inspect=()=>inspectStagedBrowserSoftware({storage:args.storage,crypto,storeId:identity.storeId,
  version:args.version,zipHash:args.zipHash,expectedManifestHash:staged.manifestHash});
 const folder=await args.storage.root.getDirectoryHandle('MoonDog-PWA-v1').then(d=>d.getDirectoryHandle('software-candidates'))
  .then(d=>d.getDirectoryHandle(identity.storeId)).then(d=>d.getDirectoryHandle(args.version+'-'+args.zipHash));
 const assets=await folder.getDirectoryHandle('System Files').then(d=>d.getDirectoryHandle('assets'));
 (await assets.getFileHandle('app.js')).bytes=b('tampered staged executable');
 await assert.rejects(inspect(),/checksum mismatch/);
 (await assets.getFileHandle('app.js')).bytes=b('synthetic app');
 await write(folder,'System Files/Workspace/private.json',b('forbidden'));
 await assert.rejects(inspect(),/Unexpected candidate software directory/);
 await folder.getDirectoryHandle('System Files').then(d=>d.removeEntry('Workspace'));
 await write(folder,'STAGING-INCOMPLETE.json',b('incomplete'));
 await assert.rejects(inspect(),/Incomplete candidate software/);
});


const select=()=>import('../src/pwa/browser_software_selection.mjs');
const selectArgs=(args,proof)=>({storage:args.storage,crypto,locks:args.locks,storeId:args.storeId,
 originalVersion:args.installedVersion,originalManifestHash:args.installedManifestHash,
 version:args.version,zipHash:args.zipHash,manifestHash:proof.manifestHash});
test('activation serves only verified candidate and rollback preserves original source and manual Workspace bytes',async()=>{
 const {store,identity,args}=await fixture();const generation=await candidate();const selection=await select();
 const staged=await generation.stageVerifiedBrowserSoftware(args);
 assert.equal(await selection.inspectActiveBrowserSoftware({storage:args.storage,crypto,storeId:identity.storeId}),null);
 const active=await selection.activateStagedBrowserSoftware(selectArgs(args,staged));
 assert.equal(active.active,true);assert.equal(active.productionReady,false);
 assert.equal(await read(store,'System Files/index.html'),'<html>synthetic</html>');
 assert.equal(await read(store,'System Files/Workspace/data/manual.txt'),'manual override preserved');
 const asset=await selection.readActiveCandidateAsset({storage:args.storage,crypto,storeId:identity.storeId,
  version:args.version,expectedManifestHash:staged.manifestHash,relativePath:'index.html'});
 assert.equal(new TextDecoder().decode(asset.bytes),'<html>synthetic</html>');
 assert.match(asset.mime,/text\/html/);
 await assert.rejects(selection.readActiveCandidateAsset({storage:args.storage,crypto,storeId:identity.storeId,
   version:args.installedVersion,expectedManifestHash:args.installedManifestHash,relativePath:'index.html'}),/active verified generation/);
 await assert.rejects(selection.readActiveCandidateAsset({storage:args.storage,crypto,storeId:identity.storeId,
   version:args.version,expectedManifestHash:staged.manifestHash,relativePath:'../Workspace/data/manual.txt'}),/approved public/);
 await assert.rejects(selection.activateStagedBrowserSoftware(selectArgs(args,staged)),/already active/);
 const rollback=await selection.rollbackBrowserSoftware({storage:args.storage,crypto,locks:args.locks,storeId:identity.storeId,
  originalVersion:args.installedVersion,originalManifestHash:args.installedManifestHash});
 assert.equal(rollback.rolledBack,true);
 assert.equal(await selection.inspectActiveBrowserSoftware({storage:args.storage,crypto,storeId:identity.storeId}),null);
 assert.equal(await read(store,'System Files/Workspace/data/SAPR.json'),'original report, do not touch');
});
test('candidate corruption makes active selection fail closed but permits verified original rollback',async()=>{
 const {store,identity,args}=await fixture();const generation=await candidate(),selection=await select();
 const staged=await generation.stageVerifiedBrowserSoftware(args);await selection.activateStagedBrowserSoftware(selectArgs(args,staged));
 const bucket=await args.storage.root.getDirectoryHandle('MoonDog-PWA-v1');
 const candidates=await bucket.getDirectoryHandle('software-candidates');
 const files=await candidates.getDirectoryHandle(identity.storeId).then(d=>d.getDirectoryHandle(args.version+'-'+args.zipHash));
 const app=await files.getDirectoryHandle('System Files').then(d=>d.getDirectoryHandle('assets')).then(d=>d.getFileHandle('app.js'));
 app.bytes=b('tampered');
 await assert.rejects(selection.inspectActiveBrowserSoftware({storage:args.storage,crypto,storeId:identity.storeId}),/checksum mismatch/);
 await assert.rejects(selection.readActiveCandidateAsset({storage:args.storage,crypto,storeId:identity.storeId,
   version:args.version,expectedManifestHash:staged.manifestHash,relativePath:'index.html'}),/checksum mismatch/);
 const rollback=await selection.rollbackBrowserSoftware({storage:args.storage,crypto,locks:args.locks,storeId:identity.storeId,
  originalVersion:args.installedVersion,originalManifestHash:args.installedManifestHash});
 assert.equal(rollback.rolledBack,true);assert.equal(await read(store,'System Files/Workspace/data/manual.txt'),'manual override preserved');
});
test('exclusive lock, forged original authority and wrong-store selection refuse without mutations',async()=>{
 const {store,args}=await fixture(),selection=await select(),generation=await candidate();const staged=await generation.stageVerifiedBrowserSoftware(args);
 await assert.rejects(selection.activateStagedBrowserSoftware({...selectArgs(args,staged),locks:{request:async(_n,_o,fn)=>fn(null)}}),/Close the active/);
 await assert.rejects(selection.activateStagedBrowserSoftware({...selectArgs(args,staged),originalManifestHash:'0'.repeat(64)}),/differs|wrong installed manifest/);
 await assert.rejects(selection.activateStagedBrowserSoftware({...selectArgs(args,staged),storeId:randomUUID()}),{name:'NotFoundError'});
 assert.equal(await read(store,'System Files/Workspace/data/manual.txt'),'manual override preserved');
 assert.equal(await selection.inspectActiveBrowserSoftware({storage:args.storage,crypto,storeId:args.storeId}),null);
});
test('selections are isolated across stores; damaged selection refuses silent fallback',async()=>{
 const a=await fixture(),other=await fixture();const selection=await select(),generation=await candidate();
 const staged=await generation.stageVerifiedBrowserSoftware(a.args);
 await selection.activateStagedBrowserSoftware(selectArgs(a.args,staged));
 assert.equal(await selection.inspectActiveBrowserSoftware({storage:other.args.storage,crypto,storeId:other.args.storeId}),null);
 const selected=await a.args.storage.root.getDirectoryHandle('MoonDog-PWA-v1').then(d=>d.getDirectoryHandle('software-selections')).then(d=>d.getDirectoryHandle(a.identity.storeId)).then(d=>d.getFileHandle('ACTIVE.json'));
 selected.bytes=b('invalid');
 await assert.rejects(selection.inspectActiveBrowserSoftware({storage:a.args.storage,crypto,storeId:a.identity.storeId}),/selection record unreadable|Corrupted active/);
 assert.equal(await read(a.store,'System Files/Workspace/data/SAPR.json'),'original report, do not touch');
});
test('explicit verified-original recovery clears a corrupted selector without touching original files',async()=>{
 const {args,store,identity}=await fixture(),c=await candidate(),selection=await select();
 const stage=await c.stageVerifiedBrowserSoftware(args);
 await selection.activateStagedBrowserSoftware(selectArgs(args,stage));
 const selected=await args.storage.root.getDirectoryHandle('MoonDog-PWA-v1').then(d=>d.getDirectoryHandle('software-selections')).then(d=>d.getDirectoryHandle(identity.storeId)).then(d=>d.getFileHandle('ACTIVE.json'));
 selected.bytes=b('truncated');
 await assert.rejects(selection.inspectActiveBrowserSoftware({storage:args.storage,crypto,storeId:identity.storeId}),/selection record unreadable|Corrupted active/);
 const recovered=await selection.recoverOriginalBrowserSoftware({storage:args.storage,crypto,locks:args.locks,storeId:identity.storeId,
  originalVersion:args.installedVersion,originalManifestHash:args.installedManifestHash});
 assert.equal(recovered.recoveredOriginal,true);
 assert.equal(await selection.inspectActiveBrowserSoftware({storage:args.storage,crypto,storeId:identity.storeId}),null);
 assert.equal(await read(store,'System Files/index.html'),'<html>synthetic</html>');
 assert.equal(await read(store,'System Files/Workspace/data/manual.txt'),'manual override preserved');
});
