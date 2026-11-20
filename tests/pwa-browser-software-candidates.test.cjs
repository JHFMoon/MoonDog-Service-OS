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
async function fixture(label='SYNTHETIC A',sharedStorage){
 const s=sharedStorage||storage(),{store,identity}=await(await stores()).createEmptyStore({storage:s,crypto,label});
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


test('browser serves exact selected generation then reconnects original Workspace without altering data',async()=>{
 const {store,identity,args}=await fixture(),generation=await candidate();
 const select=await import('../src/pwa/browser_software_selection.mjs');
 const web=await import('../src/pwa/serve_browser_app.mjs');
 const bridge=await import('../src/pwa/connect_operational_workspace.mjs');
 const staged=await generation.stageVerifiedBrowserSoftware(args);
 await select.activateStagedBrowserSoftware({storage:args.storage,crypto,locks:args.locks,storeId:identity.storeId,
  originalVersion:args.installedVersion,originalManifestHash:args.installedManifestHash,
  version:args.version,zipHash:args.zipHash,manifestHash:staged.manifestHash});
 const base='/MoonDog-Service-OS/web-preview/';
 const path=base+'store/'+identity.storeId+'/'+staged.manifestHash+'/'+args.version+'/assets/app.js';
 const route=web.parseBrowserAssetRoute(path,base);
 assert.equal(route.version,args.version);
 const asset=await web.loadVerifiedPublicAsset({...route,storage:args.storage,crypto});
 assert.equal(new TextDecoder().decode(asset.bytes),'synthetic app');
 await assert.rejects(web.loadVerifiedPublicAsset({storage:args.storage,crypto,storeId:identity.storeId,
  version:args.installedVersion,expectedManifestHash:args.installedManifestHash,relativePath:'index.html'}),/active verified generation/);
 assert.equal(web.parseBrowserAssetRoute(base+'store/'+identity.storeId+'/'+staged.manifestHash+'/0.10.18-beta.bad/assets/app.js',base),null);
 assert.equal(web.parseBrowserAssetRoute(base+'store/'+identity.storeId+'/'+staged.manifestHash+'/'+args.version+'/System Files/Workspace/data/SAPR.json',base),null);
 const session=await bridge.openVerifiedOperationalWorkspace({storage:args.storage,crypto,locks:args.locks,storeId:identity.storeId,
  version:args.version,expectedManifestHash:staged.manifestHash});
 try{
  assert.equal(session.handle.kind,'directory');
  const ws=await session.handle.getDirectoryHandle('System Files').then(d=>d.getDirectoryHandle('Workspace'));
  const report=await ws.getDirectoryHandle('data').then(d=>d.getFileHandle('SAPR.json'));
  assert.equal(await(await report.getFile()).text(),'original report, do not touch');
  const executable=await session.handle.getDirectoryHandle('System Files').then(d=>d.getFileHandle('index.html'));
  await assert.rejects(executable.createWritable(),/read-only/);
 }finally{await session.close();}
 await select.rollbackBrowserSoftware({storage:args.storage,crypto,locks:args.locks,storeId:identity.storeId,
  originalVersion:args.installedVersion,originalManifestHash:args.installedManifestHash});
 const original=await web.loadVerifiedPublicAsset({storage:args.storage,crypto,storeId:identity.storeId,
  version:args.installedVersion,expectedManifestHash:args.installedManifestHash,relativePath:'index.html'});
 assert.equal(new TextDecoder().decode(original.bytes),'<html>synthetic</html>');
 assert.equal(await read(store,'System Files/Workspace/data/manual.txt'),'manual override preserved');
});


const BETA_ROOT='https://jhfmoon.github.io/MoonDog-Service-OS/';
const BETA_COMMIT='a'.repeat(40),BETA_VERSION='0.10.18-beta.456';
async function syntheticPinnedBeta({badHash=false,wrongFile=false,unsafe=false,wrongStable=false,migrationRequired=false,minimumCompatibleVersion='0.10.9'}={}){
 const names=['index.html','assets/app.js','assets/styles.css','assets/freshness.js','vendor/xlsx.full.min.js'];
 if(unsafe)names[4]='Workspace/data/private.json';
 const files=[];
 for(const path of names){
  const source=b('synthetic-only '+path);
  files.push({path,action:'put',sha256:await sha(source),contentBase64:Buffer.from(source).toString('base64')});
 }
 if(wrongFile)files[1].contentBase64=Buffer.from('tampered').toString('base64');
 const pkg=b(JSON.stringify({formatVersion:1,version:BETA_VERSION,approvedFiles:names,files}));
 const manifest=b(JSON.stringify({
  stable:{version:wrongStable?'0.10.18':'0.10.17'},
  beta:{version:BETA_VERSION,sha256:badHash?'0'.repeat(64):await sha(pkg),migrationRequired,minimumCompatibleVersion,
   packageUrl:'https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/updates/packages/moondog-'+BETA_VERSION+'.json'}
 }));
 const prefix='https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/'+BETA_COMMIT+'/';
 const responses=new Map([[BETA_ROOT+'site-version.json',b(JSON.stringify({mainSha:BETA_COMMIT}))],
  [prefix+'updates/manifest.json',manifest],[prefix+'updates/packages/moondog-'+BETA_VERSION+'.json',pkg]]);
 const fetchImpl=async(url,options)=>{
  assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
  const body=responses.get(url);if(!body)throw Error('unexpected synthetic transport '+url);
  return {ok:true,type:'cors',redirected:false,url,headers:{get:()=>String(body.length)},
   body:{getReader(){let emitted=false;return {read:async()=>emitted?{done:true}:{done:(emitted=true,false),value:body},cancel:async()=>{}};}}};
 };
 return {fetchImpl};
}
test('pinned Beta JSON stages a separate verified generation then rolls back with original Workspace unchanged',async()=>{
 const {store,args,identity}=await fixture(),transport=await syntheticPinnedBeta();
 const gen=await candidate(),selected=await select();
 const staged=await gen.stageVerifiedBetaBrowserSoftware({storage:args.storage,crypto,locks:args.locks,storeId:args.storeId,
  installedVersion:args.installedVersion,installedManifestHash:args.installedManifestHash,fetchImpl:transport.fetchImpl});
 assert.equal(staged.status,'verified-staged');assert.equal(staged.version,BETA_VERSION);assert.equal(staged.active,false);
 assert.equal(await read(store,'System Files/Workspace/data/manual.txt'),'manual override preserved');
 assert.equal(await read(store,'System Files/index.html'),'<html>synthetic</html>');
 const activated=await selected.activateStagedBrowserSoftware({storage:args.storage,crypto,locks:args.locks,storeId:identity.storeId,
  originalVersion:args.installedVersion,originalManifestHash:args.installedManifestHash,
  version:staged.version,zipHash:staged.zipHash,manifestHash:staged.manifestHash});
 assert.equal(activated.active,true);
 const asset=await selected.readActiveCandidateAsset({storage:args.storage,crypto,storeId:identity.storeId,
  version:staged.version,expectedManifestHash:staged.manifestHash,relativePath:'assets/app.js'});
 assert.equal(new TextDecoder().decode(asset.bytes),'synthetic-only assets/app.js');
 const rollback=await selected.rollbackBrowserSoftware({storage:args.storage,crypto,locks:args.locks,storeId:identity.storeId,
  originalVersion:args.installedVersion,originalManifestHash:args.installedManifestHash});
 assert.equal(rollback.rolledBack,true);
 assert.equal(await read(store,'System Files/Workspace/data/SAPR.json'),'original report, do not touch');
});
test('tampered, private, stale-manifest or locked Beta never stages candidate bytes',async()=>{
 const gen=await candidate();
 for(const bad of [{badHash:true},{wrongFile:true},{unsafe:true},{wrongStable:true},{migrationRequired:true},{minimumCompatibleVersion:'0.10.99'}]){
  const {store,args}=await fixture(),transport=await syntheticPinnedBeta(bad);
  await assert.rejects(gen.stageVerifiedBetaBrowserSoftware({storage:args.storage,crypto,locks:args.locks,storeId:args.storeId,
   installedVersion:args.installedVersion,installedManifestHash:args.installedManifestHash,fetchImpl:transport.fetchImpl}),/mismatch|unapproved|Stable channel|migration|incompatible/);
  assert.equal(await read(store,'System Files/Workspace/data/manual.txt'),'manual override preserved');
 }
 const {store,args}=await fixture(),transport=await syntheticPinnedBeta();
 const params={storage:args.storage,crypto,storeId:args.storeId,installedVersion:args.installedVersion,
  installedManifestHash:args.installedManifestHash,fetchImpl:transport.fetchImpl};
 await assert.rejects(gen.stageVerifiedBetaBrowserSoftware({...params,locks:{request:async(_n,_o,fn)=>fn(null)}}),/must close/);
 await assert.rejects(gen.stageVerifiedBetaBrowserSoftware({...params,locks:args.locks,installedManifestHash:'0'.repeat(64)}),/differs|authority|wrong installed manifest/);
 assert.equal(await read(store,'System Files/Workspace/data/SAPR.json'),'original report, do not touch');
});
test('pinned Beta staging refuses to adopt or overwrite a previous candidate',async()=>{
 const {args,store}=await fixture(),transport=await syntheticPinnedBeta(),gen=await candidate();
 const params={storage:args.storage,crypto,locks:args.locks,storeId:args.storeId,
  installedVersion:args.installedVersion,installedManifestHash:args.installedManifestHash,fetchImpl:transport.fetchImpl};
 await gen.stageVerifiedBetaBrowserSoftware(params);
 await assert.rejects(gen.stageVerifiedBetaBrowserSoftware(params),/already exists/);
 assert.equal(await read(store,'System Files/Workspace/data/manual.txt'),'manual override preserved');
});


test('staged pinned Beta may be reverified for explicit retry without overwriting candidate or Workspace',async()=>{
 const {store,args}=await fixture(),transport=await syntheticPinnedBeta(),gen=await candidate();
 const params={storage:args.storage,crypto,locks:args.locks,storeId:args.storeId,
  installedVersion:args.installedVersion,installedManifestHash:args.installedManifestHash,fetchImpl:transport.fetchImpl};
 const first=await gen.stageVerifiedBetaBrowserSoftware(params);
 const resumed=await gen.resumeVerifiedBetaBrowserSoftware(params);
 assert.equal(resumed.resumed,true);
 assert.equal(resumed.version,first.version);assert.equal(resumed.manifestHash,first.manifestHash);
 assert.equal(await read(store,'System Files/Workspace/data/manual.txt'),'manual override preserved');
 const stage=await args.storage.root.getDirectoryHandle('MoonDog-PWA-v1').then(x=>x.getDirectoryHandle('software-candidates'))
  .then(x=>x.getDirectoryHandle(args.storeId)).then(x=>x.getDirectoryHandle(first.version+'-'+first.zipHash));
 const asset=await stage.getDirectoryHandle('System Files').then(x=>x.getDirectoryHandle('assets')).then(x=>x.getFileHandle('app.js'));
 asset.bytes=b('tampered');
 await assert.rejects(gen.resumeVerifiedBetaBrowserSoftware(params),/checksum mismatch/);
 assert.equal(await read(store,'System Files/Workspace/data/SAPR.json'),'original report, do not touch');
});

test('two synthetic stores sharing one browser origin retain independent active Beta and Workspace generations',async()=>{
 const common=storage(),alpha=await fixture('SYNTHETIC Alpha',common),bravo=await fixture('SYNTHETIC Bravo',common);
 assert.notEqual(alpha.identity.storeId,bravo.identity.storeId);
 // Overlapping operational filename and identical official Beta version are intentional.
 await write(alpha.store,'System Files/Workspace/data/SAPR.json',b('CP GROSS ALPHA 500'));
 await write(bravo.store,'System Files/Workspace/data/SAPR.json',b('CP GROSS BRAVO 200'));
 const transport=await syntheticPinnedBeta(),gen=await candidate(),select=await selection();
 const params=x=>({storage:common,crypto,locks:x.args.locks,storeId:x.identity.storeId,
  installedVersion:x.args.installedVersion,installedManifestHash:x.args.installedManifestHash,
  fetchImpl:transport.fetchImpl});
 const stageA=await gen.stageVerifiedBetaBrowserSoftware(params(alpha));
 await assert.rejects(select.activateStagedBrowserSoftware({
  storage:common,crypto,locks:bravo.args.locks,storeId:bravo.identity.storeId,
  originalVersion:bravo.args.installedVersion,originalManifestHash:bravo.args.installedManifestHash,
  version:stageA.version,zipHash:stageA.zipHash,manifestHash:stageA.manifestHash
 }),/NotFoundError|not found|missing/,'Alpha candidate must not be adopted by Bravo');
 const activatedA=await select.activateStagedBrowserSoftware({
  storage:common,crypto,locks:alpha.args.locks,storeId:alpha.identity.storeId,
  originalVersion:alpha.args.installedVersion,originalManifestHash:alpha.args.installedManifestHash,
  version:stageA.version,zipHash:stageA.zipHash,manifestHash:stageA.manifestHash});
 assert.equal(activatedA.active,true);
 assert.equal(await select.inspectActiveBrowserSoftware({storage:common,crypto,storeId:bravo.identity.storeId}),null);
 const stageB=await gen.stageVerifiedBetaBrowserSoftware(params(bravo));
 const activatedB=await select.activateStagedBrowserSoftware({
  storage:common,crypto,locks:bravo.args.locks,storeId:bravo.identity.storeId,
  originalVersion:bravo.args.installedVersion,originalManifestHash:bravo.args.installedManifestHash,
  version:stageB.version,zipHash:stageB.zipHash,manifestHash:stageB.manifestHash});
 assert.equal(activatedB.active,true);
 await select.rollbackBrowserSoftware({storage:common,crypto,locks:alpha.args.locks,storeId:alpha.identity.storeId,
  originalVersion:alpha.args.installedVersion,originalManifestHash:alpha.args.installedManifestHash});
 assert.equal(await select.inspectActiveBrowserSoftware({storage:common,crypto,storeId:alpha.identity.storeId}),null);
 const bravoActive=await select.inspectActiveBrowserSoftware({storage:common,crypto,storeId:bravo.identity.storeId});
 assert.equal(bravoActive.version,BETA_VERSION,'Alpha rollback cannot reset Bravo selection');
 assert.equal(await read(alpha.store,'System Files/Workspace/data/SAPR.json'),'CP GROSS ALPHA 500');
 assert.equal(await read(bravo.store,'System Files/Workspace/data/SAPR.json'),'CP GROSS BRAVO 200');
 assert.equal(await read(alpha.store,'System Files/Workspace/data/manual.txt'),'manual override preserved');
 assert.equal(await read(bravo.store,'System Files/Workspace/data/manual.txt'),'manual override preserved');
 assert.equal(await read(alpha.store,'System Files/index.html'),'<html>synthetic</html>');
 assert.equal(await read(bravo.store,'System Files/index.html'),'<html>synthetic</html>');
});
