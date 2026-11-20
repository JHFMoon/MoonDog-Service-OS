/**
 * Stages verified PUBLIC browser software without changing the original app or
 * any Workspace bytes. SYNTHETIC preview only. Staging is not activation,
 * publication, a Stable promotion, or permission to use operational data.
 */
import {openExistingStore} from './opfs-store.mjs';
import {inspectVerifiedBrowserInstallation} from './install_verified_browser_store.mjs';

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
/**
 * Must receive ZIP bytes and checksum from an independently authenticated
 * release catalog. inspectVerifiedZip MUST be the existing full ZIP verifier.
 * This API never changes the active installed software or its Workspace.
 */
export async function stageVerifiedBrowserSoftware({storage,crypto,locks,storeId,installedVersion,installedManifestHash,version,zipHash,zipBytes,inspectVerifiedZip}={}){
 if(typeof crypto?.subtle?.digest!=='function'||typeof locks?.request!=='function'||typeof inspectVerifiedZip!=='function')fail('Verified software staging dependencies are unavailable.');
 const id=candidateId(version,zipHash),archive=bytes(zipBytes||new Uint8Array());
 if(archive.length<22||archive.length>256*1024*1024||await digest(archive,crypto.subtle)!==zipHash)fail('Candidate ZIP digest mismatch. No storage changed.');
 const plan=inspectPlan(await inspectVerifiedZip(archive.buffer.slice(archive.byteOffset,archive.byteOffset+archive.byteLength),zipHash,version),version);
 for(const file of plan.selected)if(await digest(file.bytes,crypto.subtle)!==file.sha)fail('Candidate software changed after verification.');
 const manifestHash=await digest(plan.manifestBytes,crypto.subtle);
 return locks.request('moondog-pwa-operational-'+storeId,{mode:'exclusive',ifAvailable:true},async lock=>{
  if(!lock)fail('Active browser dashboard must close before staging software.');
  await assertOriginal({storage,crypto,storeId,installedVersion,installedManifestHash});
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
  }catch(e){throw Error('Candidate staging incomplete and quarantined: '+String(e?.message||e));}
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
