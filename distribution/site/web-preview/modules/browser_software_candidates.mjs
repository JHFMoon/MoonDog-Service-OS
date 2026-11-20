/**
 * Stages verified PUBLIC browser software without changing the original app or
 * any Workspace bytes. SYNTHETIC preview only. Staging is not activation,
 * publication, a Stable promotion, or permission to use operational data.
 */
import {openExistingStore} from './opfs-store.mjs';
import {inspectVerifiedBrowserInstallation} from './install_verified_browser_store.mjs';
import {fetchVerifiedPinnedBeta} from './verified_beta_transport.mjs';

const ROOT='MoonDog-PWA-v1', CANDIDATES='software-candidates';
const MARKER='STAGING-INCOMPLETE.json', MANIFEST='INSTALLATION-MANIFEST.json';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/, VERSION=/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/;
const PATH=/^(?:00 - OPEN DASHBOARD\.html|System Files\/(?:index\.html|assets\/[A-Za-z0-9._-]+|vendor\/[A-Za-z0-9._-]+))$/;
const fail=msg=>{throw new Error(msg);};
const bytes=input=>input instanceof Uint8Array?input:new Uint8Array(input);
const digest=async(input,subtle)=>Array.from(new Uint8Array(await subtle.digest('SHA-256',input)),x=>x.toString(16).padStart(2,'0')).join('');
const missing=e=>e?.name==='NotFoundError';
async function read(folder,name){const handle=await folder.getFileHandle(name,{create:false});return new Uint8Array(await(await handle.getFile()).arrayBuffer());}
async function absent(folder,name){
 for(const fn of ['getFileHandle','getDirectoryHandle']){
  try{await folder[fn](name,{create:false});return false;}catch(e){if(!missing(e)&&e?.name!=='TypeMismatchError')throw e;}
 }return true;
}
async function directory(folder,path,create){let dir=folder;for(const name of path.split('/'))dir=await dir.getDirectoryHandle(name,{create});return dir;}
async function writeNew(folder,path,value,subtle){
 const parts=path.split('/'),name=parts.pop();const dir=parts.length?await directory(folder,parts.join('/'),true):folder;
 if(!await absent(dir,name))fail('Staged software file already exists; no overwrite.');
 const file=await dir.getFileHandle(name,{create:true});const stream=await file.createWritable({keepExistingData:false});
 try{await stream.write(value);await stream.close();}catch(e){try{await stream.abort?.()}catch(_){}throw e;}
 const saved=await read(dir,name);
 if(saved.length!==value.length||await digest(saved,subtle)!==await digest(value,subtle))fail('Candidate software durable readback failed.');
}
async function assertOriginal({storage,crypto,storeId,installedVersion,installedManifestHash}){
 if(!UUID.test(storeId||'')||!VERSION.test(installedVersion||'')||!SHA.test(installedManifestHash||''))fail('Verified original-store authority is required.');
 const proof=await inspectVerifiedBrowserInstallation({storage,crypto,storeId,version:installedVersion,expectedManifestHash:installedManifestHash});
 if(!proof.applicationVerified||proof.identity?.storeId!==storeId||!/^SYNTHETIC(?:\s|$)/i.test(proof.identity?.label||''))
  fail('Browser update staging is restricted to verified synthetic stores.');
 return (await openExistingStore({storage,storeId})).store;
}
async function candidatesFolder(storage,storeId,create){
 const root=await storage.getDirectory();
 const bucket=await root.getDirectoryHandle(ROOT,{create:false});
 const candidates=await bucket.getDirectoryHandle(CANDIDATES,{create});
 return candidates.getDirectoryHandle(storeId,{create});
}
function inspectPlan(plan,version){
 if(plan?.version!==version||!Array.isArray(plan.files)||plan.files.length<5||plan.files.length>350)fail('Trusted package plan is incomplete.');
 const byPath=new Map(),manifestEntry=plan.files.find(x=>x.path===MANIFEST);
 if(!manifestEntry)fail('Verified package installation manifest missing.');
 let manifest;
 try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes(manifestEntry.bytes)))}catch(_){fail('Unreadable candidate package manifest.');}
 if(manifest?.format!=='service-operations-dashboard-clean-install'||manifest?.formatVersion!==1||manifest.version!==version||
    manifest.packageRoot!=='Service Operations Dashboard'||manifest.applicationRoot!=='System Files'||
    manifest.workspaceRoot!=='System Files/Workspace'||manifest.workspaceProtectedFromUpdates!==true||
    !Array.isArray(manifest.files)||manifest.files.length<5||manifest.files.length>350)fail('Candidate package has unsafe software/Workspace authority.');
 const catalog=new Map();
 for(const file of manifest.files){
  if(typeof file?.path!=='string'||catalog.has(file.path)||!Number.isSafeInteger(file.size)||file.size<0||file.size>64*1024*1024||!SHA.test(file.sha256||''))
   fail('Invalid software manifest inventory.');
  if(file.path.startsWith('System Files/Workspace/')&&file.path!=='System Files/Workspace/README.txt')fail('Private Workspace file in software package.');
  catalog.set(file.path,file);
 }
 const selected=[];let length=0;
 for(const entry of plan.files){
  if(byPath.has(entry?.path)||typeof entry?.path!=='string'||!(entry.bytes instanceof Uint8Array))fail('Invalid or duplicated package bytes.');
  byPath.set(entry.path,entry);
  if(entry.path===MANIFEST)continue;
  if(entry.path==='System Files/Workspace/README.txt')continue;
  if(!PATH.test(entry.path)&&!['index.html','README - START HERE.txt'].includes(entry.path))fail('Unapproved candidate software path.');
  const meta=catalog.get(entry.path);
  if(!meta||entry.bytes.length!==meta.size)fail('Candidate software inventory differs from the official manifest.');
  if(PATH.test(entry.path)){length+=entry.bytes.length;if(length>192*1024*1024)fail('Candidate software exceeds safe size.');selected.push({path:entry.path,bytes:entry.bytes,sha:meta.sha256});}
 }
 if(byPath.size!==catalog.size+1||!catalog.has('System Files/index.html')||!catalog.has('00 - OPEN DASHBOARD.html'))fail('Candidate package files are incomplete.');
 return {manifestBytes:bytes(manifestEntry.bytes),manifest,catalog,selected};
}
function candidateId(version,zipHash){if(!VERSION.test(version||'')||!SHA.test(zipHash||''))fail('A trusted exact candidate release is required.');return version+'-'+zipHash;}
function versionParts(input){
 const m=/^([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(input||'');
 if(!m)fail('Invalid candidate compatibility version.');
 return m.slice(1).map(Number);
}
function versionCompare(a,b){
 const aa=versionParts(a),bb=versionParts(b);
 for(let i=0;i<3;i++)if(aa[i]!==bb[i])return aa[i]>bb[i]?1:-1;
 return 0;
}
/**
 * Must receive ZIP bytes and checksum from an independently authenticated
 * release catalog. inspectVerifiedZip MUST be the existing full ZIP verifier.
 * This API never changes the active installed software or its Workspace.
 */

async function readPath(store,path){
 const parts=path.split('/'),name=parts.pop();let folder=store;
 for(const part of parts)folder=await folder.getDirectoryHandle(part,{create:false});
 return read(folder,name);
}
async function deriveBetaCandidatePlan(store,beta,crypto){
 // Only immutable public bootstrap bytes are reused from the verified Stable
 // installation. All executable runtime files come from the pinned Beta.
 const roots=['00 - OPEN DASHBOARD.html','README - START HERE.txt','index.html','System Files/Workspace/README.txt'];
 const files=[],seen=new Set();
 for(const path of roots){
  const content=await readPath(store,path);files.push({path,bytes:content,sha256:await digest(content,crypto.subtle)});seen.add(path);
 }
 for(const item of beta.files){
  const path='System Files/'+item.path;
  if(seen.has(path)||!PATH.test(path))fail('Beta candidate runtime contains an unsafe or duplicated file.');
  seen.add(path);files.push({path,bytes:item.bytes,sha256:item.sha256});
 }
 const ordered=files.slice().sort((a,b)=>a.path.localeCompare(b.path));
 const manifest={format:'service-operations-dashboard-clean-install',formatVersion:1,
  version:beta.version,packageRoot:'Service Operations Dashboard',launcher:'00 - OPEN DASHBOARD.html',
  applicationRoot:'System Files',workspaceRoot:'System Files/Workspace',updateChannel:'beta',
  workspaceProtectedFromUpdates:true,
  files:ordered.map(item=>({path:item.path,size:item.bytes.length,sha256:item.sha256}))};
 files.push({path:MANIFEST,bytes:new TextEncoder().encode(JSON.stringify(manifest)+'\n')});
 return {version:beta.version,files};
}
/** Internal only: after independent source verification, commit a quarantined
 * candidate under the exclusive original-store lock. Never mutate Workspace. */
async function stageAuthenticatedPlan({storage,crypto,locks,storeId,installedVersion,installedManifestHash,version,zipHash,makePlan}){
 if(typeof crypto?.subtle?.digest!=='function'||typeof locks?.request!=='function'||typeof makePlan!=='function')
  fail('Verified software staging dependencies are unavailable.');
 const id=candidateId(version,zipHash);
 return locks.request('moondog-pwa-operational-'+storeId,{mode:'exclusive',ifAvailable:true},async lock=>{
  if(!lock)fail('Active browser dashboard must close before staging software.');
  const store=await assertOriginal({storage,crypto,storeId,installedVersion,installedManifestHash});
  const plan=inspectPlan(await makePlan(store),version);
  for(const file of plan.selected)if(await digest(file.bytes,crypto.subtle)!==file.sha)
   fail('Candidate software changed after verification.');
  const manifestHash=await digest(plan.manifestBytes,crypto.subtle);
  const parent=await candidatesFolder(storage,storeId,true);
  if(!await absent(parent,id))fail('Candidate generation already exists; no overwrite or adoption.');
  const dir=await parent.getDirectoryHandle(id,{create:true});
  await writeNew(dir,MARKER,new TextEncoder().encode('INCOMPLETE'),crypto.subtle);
  try{
   await writeNew(dir,MANIFEST,plan.manifestBytes,crypto.subtle);
   for(const file of plan.selected)await writeNew(dir,file.path,file.bytes,crypto.subtle);
   await dir.removeEntry(MARKER);
   const result=await inspectStagedBrowserSoftware({storage,crypto,storeId,version,zipHash,expectedManifestHash:manifestHash});
   return Object.freeze({...result,active:false,productionReady:false});
  }catch(error){throw Error('Candidate staging incomplete and quarantined: '+String(error?.message||error));}
 });
}
/** Existing independent full official ZIP verifier; never substitute a JSON parser. */
export async function stageVerifiedBrowserSoftware({storage,crypto,locks,storeId,installedVersion,installedManifestHash,version,zipHash,zipBytes,inspectVerifiedZip}={}){
 if(typeof crypto?.subtle?.digest!=='function'||typeof inspectVerifiedZip!=='function')fail('Verified ZIP inspector unavailable.');
 const archive=bytes(zipBytes||new Uint8Array());
 if(archive.length<22||archive.length>256*1024*1024||await digest(archive,crypto.subtle)!==zipHash)
  fail('Candidate ZIP digest mismatch. No storage changed.');
 const trusted=await inspectVerifiedZip(archive.buffer.slice(archive.byteOffset,archive.byteOffset+archive.byteLength),zipHash,version);
 return stageAuthenticatedPlan({storage,crypto,locks,storeId,installedVersion,installedManifestHash,version,zipHash,
  makePlan:async()=>trusted});
}
/** Pinned, separately authenticated Beta JSON transport: no ZIP impersonation. */
export async function stageVerifiedBetaBrowserSoftware({storage,crypto,locks,storeId,installedVersion,installedManifestHash,fetchImpl,siteUrl}={}){
 const beta=await fetchVerifiedPinnedBeta({siteUrl,fetchImpl,crypto});
 if(beta.verified!==true||!VERSION.test(beta.version)||!SHA.test(beta.packageHash))fail('Verified Beta authority missing.');
 if(beta.migrationRequired!==false||!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(beta.minimumCompatibleVersion||'')||
    !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(installedVersion||'')||
    versionCompare(installedVersion,beta.minimumCompatibleVersion)<0||versionCompare(beta.version,installedVersion)<=0)
  fail('Beta update is incompatible with the installed original or requires an unsupported migration.');
 // zipHash is the existing immutable candidate-directory digest field; for
 // this call it binds the official Beta JSON package, not a ZIP.
 return stageAuthenticatedPlan({storage,crypto,locks,storeId,installedVersion,installedManifestHash,
  version:beta.version,zipHash:beta.packageHash,makePlan:store=>deriveBetaCandidatePlan(store,beta,crypto)});
}
/** Explicit retry after an already-staged Beta; it never adopts a candidate by
 * filename alone. Recompute the exact expected manifest from the newly
 * authenticated pinned package and original verified Stable file bytes, then
 * inspect every staged executable and the incomplete-install hold.
 * No stored byte is created, overwritten or deleted by this operation. */
export async function resumeVerifiedBetaBrowserSoftware({storage,crypto,locks,storeId,installedVersion,installedManifestHash,fetchImpl,siteUrl}={}){
 const beta=await fetchVerifiedPinnedBeta({siteUrl,fetchImpl,crypto});
 if(!beta.verified||!VERSION.test(beta.version)||!SHA.test(beta.packageHash)||
    typeof crypto?.subtle?.digest!=='function'||typeof locks?.request!=='function')
  fail('Verified Beta resume authority is unavailable.');
 if(beta.migrationRequired!==false||!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(beta.minimumCompatibleVersion||'')||
    !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(installedVersion||'')||
    versionCompare(installedVersion,beta.minimumCompatibleVersion)<0||versionCompare(beta.version,installedVersion)<=0)
  fail('Beta resume is incompatible with the installed original or requires a migration.');
 return locks.request('moondog-pwa-operational-'+storeId,{mode:'exclusive',ifAvailable:true},async lock=>{
  if(!lock)fail('Active browser dashboard must close before resuming staged software.');
  const store=await assertOriginal({storage,crypto,storeId,installedVersion,installedManifestHash});
  const plan=inspectPlan(await deriveBetaCandidatePlan(store,beta,crypto),beta.version);
  for(const file of plan.selected)if(await digest(file.bytes,crypto.subtle)!==file.sha)
   fail('Authenticated Beta runtime file mismatch.');
  const manifestHash=await digest(plan.manifestBytes,crypto.subtle);
  const verified=await inspectStagedBrowserSoftware({storage,crypto,storeId,version:beta.version,
   zipHash:beta.packageHash,expectedManifestHash:manifestHash});
  return Object.freeze({...verified,resumed:true,active:false,productionReady:false});
 });
}
/** Resume only a previously QUARANTINED, partially written pinned Beta.
 * Re-authenticate all source bytes, original installed software and ownership.
 * Existing candidate files are immutable: mismatched/unapproved files refuse
 * recovery; only missing exact verified public files may be created. The hold
 * marker is the FINAL mutation, after complete durable readback. */
export async function completeInterruptedVerifiedBetaBrowserSoftware({
 storage,crypto,locks,storeId,installedVersion,installedManifestHash,fetchImpl,siteUrl
}={}){
 const beta=await fetchVerifiedPinnedBeta({siteUrl,fetchImpl,crypto});
 if(!beta?.verified||!VERSION.test(beta.version)||!SHA.test(beta.packageHash)||
    typeof crypto?.subtle?.digest!=='function'||typeof locks?.request!=='function')
  fail('Authenticated interrupted Beta recovery authority is missing.');
 if(beta.migrationRequired!==false||!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(beta.minimumCompatibleVersion||'')||
    !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(installedVersion||'')||
    versionCompare(installedVersion,beta.minimumCompatibleVersion)<0||
    versionCompare(beta.version,installedVersion)<=0)
  fail('Interrupted Beta update is incompatible or requires a migration.');
 return locks.request('moondog-pwa-operational-'+storeId,{mode:'exclusive',ifAvailable:true},async lock=>{
  if(!lock)fail('Close the active dashboard before recovering interrupted Beta software.');
  const original=await assertOriginal({storage,crypto,storeId,installedVersion,installedManifestHash});
  const plan=inspectPlan(await deriveBetaCandidatePlan(original,beta,crypto),beta.version);
  const expected=new Map([[MANIFEST,plan.manifestBytes]]);
  for(const file of plan.selected){
   if(expected.has(file.path)||await digest(file.bytes,crypto.subtle)!==file.sha)
    fail('Authenticated Beta candidate inventory is inconsistent.');
   expected.set(file.path,file.bytes);
  }
  const id=candidateId(beta.version,beta.packageHash);
  const parent=await candidatesFolder(storage,storeId,false);
  const stage=await parent.getDirectoryHandle(id,{create:false});
  // Never adopt a normally completed candidate or a different marker format.
  if(await absent(stage,MARKER))fail('No incomplete software candidate is available for recovery.');
  const marker=await read(stage,MARKER);
  if(new TextDecoder('utf-8',{fatal:true}).decode(marker)!=='INCOMPLETE')
   fail('Unrecognized incomplete candidate marker; original remains untouched.');
  const present=new Set();
  async function inspectExisting(node,prefix=''){
   for await(const [name,handle] of node.entries()){
    const path=prefix+name;
    if(path===MARKER&&handle.kind==='file')continue;
    if(handle.kind==='directory'){
     if(![...expected.keys()].some(file=>file.startsWith(path+'/')))
      fail('Unexpected candidate directory; recovery refuses untrusted staged content.');
     await inspectExisting(handle,path+'/');
    }else if(handle.kind==='file'){
     const verified=expected.get(path);
     if(!verified||present.has(path))fail('Unexpected candidate software file; refusing adoption.');
     const stored=await read(node,name);
     if(stored.length!==verified.length||await digest(stored,crypto.subtle)!==await digest(verified,crypto.subtle))
      fail('Existing staged software differs from authenticated Beta; no overwrite.');
     present.add(path);
    }else fail('Unrecognized candidate entry; recovery refused.');
   }
  }
  // Before any writes, prove every pre-existing byte is allowed and unchanged.
  await inspectExisting(stage);
  for(const [path,content] of expected){
   if(!present.has(path))await writeNew(stage,path,content,crypto.subtle);
  }
  // Read back complete tree while still quarantined. A failed read preserves
  // the incomplete marker, so no partial generation can ever be activated.
  present.clear();
  await inspectExisting(stage);
  if(present.size!==expected.size)fail('Interrupted candidate recovery did not fully materialize.');
  await stage.removeEntry(MARKER);
  const manifestHash=await digest(plan.manifestBytes,crypto.subtle);
  const result=await inspectStagedBrowserSoftware({storage,crypto,storeId,version:beta.version,
   zipHash:beta.packageHash,expectedManifestHash:manifestHash});
  return Object.freeze({...result,completedInterrupted:true,active:false,productionReady:false});
 });
}

/** Read-only integrity verification; no Workspace enumeration, no activation. */
export async function inspectStagedBrowserSoftware({storage,crypto,storeId,version,zipHash,expectedManifestHash}={}){
 if(typeof crypto?.subtle?.digest!=='function'||!UUID.test(storeId||'')||!SHA.test(expectedManifestHash||''))fail('Candidate inspection authority is missing.');
 const id=candidateId(version,zipHash),parent=await candidatesFolder(storage,storeId,false);
 const dir=await parent.getDirectoryHandle(id,{create:false});
 if(!await absent(dir,MARKER))fail('Incomplete candidate software must not run.');
 const raw=await read(dir,MANIFEST);
 if(await digest(raw,crypto.subtle)!==expectedManifestHash)fail('Candidate software manifest checksum mismatch.');
 let manifest;
 try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch(_){fail('Candidate software manifest invalid.');}
 if(manifest?.format!=='service-operations-dashboard-clean-install'||manifest?.version!==version||
    manifest?.applicationRoot!=='System Files'||manifest?.workspaceRoot!=='System Files/Workspace'||
    manifest?.workspaceProtectedFromUpdates!==true||!Array.isArray(manifest.files))fail('Candidate software manifest violates Workspace boundary.');
 const expected=new Map([[MANIFEST,null]]);
 for(const entry of manifest.files){
  if(['System Files/Workspace/README.txt','README - START HERE.txt','index.html'].includes(entry.path))continue;
  if(!PATH.test(entry.path)||expected.has(entry.path)||!Number.isSafeInteger(entry.size)||
     entry.size<0||entry.size>64*1024*1024||!SHA.test(entry.sha256||''))fail('Candidate runtime inventory is unsafe.');
  expected.set(entry.path,entry);
 }
 let found=0;
 async function walk(node,prefix=''){
  for await(const [name,handle] of node.entries()){
   const full=prefix+name;
   if(handle.kind==='directory'){
    if(![...expected.keys()].some(x=>x.startsWith(full+'/')))fail('Unexpected candidate software directory.');
    await walk(handle,full+'/');
   }else if(handle.kind==='file'){
    if(!expected.has(full))fail('Unexpected candidate software file.');
    const entry=expected.get(full),data=await read(node,name);
    if(entry&&(data.length!==entry.size||await digest(data,crypto.subtle)!==entry.sha256))fail('Candidate software file checksum mismatch.');
    found++;
   }else fail('Unexpected candidate software entry.');
  }
 }
 await walk(dir);
 if(found!==expected.size)fail('Candidate software missing an approved file.');
 return Object.freeze({status:'verified-staged',storeId,version,zipHash,manifestHash:expectedManifestHash,files:found,active:false,productionReady:false});
}
