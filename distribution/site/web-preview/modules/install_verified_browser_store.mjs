/**
 * Web-only MoonDog preparation. No Desktop picker and NO production connection.
 * Accepts only an official ZIP that the EXISTING site ZIP verifier already
 * authenticated, then stages its exact package files into a brand-new OPFS
 * store identity. This module does not serve the runtime, change write authority,
 * bypass app setup, or claim a browser-private backup is externally recoverable.
 */
import {openExistingStore} from './opfs-store.mjs';

const MARKER='MOONDOG-PWA-INSTALL-INCOMPLETE.json';
const APPLICATION='INSTALLATION-MANIFEST.json';
const STORE='STORE-IDENTITY.json';
const REQUIRED_WORKSPACE=['data','backups','imports','exports'];
const fail=message=>{throw new Error(message);};
const asBytes=data=>data instanceof Uint8Array?data:new Uint8Array(data);
const sha256=async (bytes,subtle)=>Array.from(new Uint8Array(await subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
function safeName(value){return typeof value==='string'&&value!==''&&value!=='.'&&value!=='..'&&!value.includes('\\')&&!/[\x00-\x1f]/.test(value);}
function safePath(value){return typeof value==='string'&&value.split('/').every(safeName);}
async function absent(dir,name){
  for(const method of ['getFileHandle','getDirectoryHandle']){
    try {await dir[method](name,{create:false});return false;}
    catch(e){if(e?.name!=='NotFoundError'&&e?.name!=='TypeMismatchError')throw e;}
  }
  return true;
}
async function folder(dir,path,create=false){
  let current=dir;
  for(const p of path.split('/'))current=await current.getDirectoryHandle(p,{create});
  return current;
}
async function existingFile(dir,path){
  let f=dir;const names=path.split('/');
  for(const name of names.slice(0,-1))f=await f.getDirectoryHandle(name,{create:false});
  return f.getFileHandle(names.at(-1),{create:false});
}
async function read(dir,path){return new Uint8Array(await(await(await existingFile(dir,path)).getFile()).arrayBuffer());}
async function writeFresh(dir,path,bytes,subtle){
  const names=path.split('/'),name=names.pop();
  const parent=names.length?await folder(dir,names.join('/'),false):dir;
  if(!await absent(parent,name))fail('Refusing to overwrite existing browser-store bytes: '+path);
  const f=await parent.getFileHandle(name,{create:true});
  const stream=await f.createWritable({keepExistingData:false});
  try{await stream.write(bytes);await stream.close();}
  catch(e){try{await stream.abort?.();}catch(_){}throw e;}
  const saved=await read(dir,path);
  if(saved.byteLength!==bytes.byteLength||await sha256(saved,subtle)!==await sha256(bytes,subtle))
    fail('Unverified browser storage readback: '+path);
}
async function checkUnconfigured(dir){
  const entries=[];
  for await(const [name,handle] of dir.entries())entries.push([name,handle.kind]);
  if(entries.length!==2||!entries.some(([n,k])=>n===STORE&&k==='file')||
     !entries.some(([n,k])=>n==='System Files'&&k==='directory'))
    fail('Store already contains files or an installation. Never adopt or overwrite.');
  const system=await dir.getDirectoryHandle('System Files',{create:false});
  const systemEntries=[];
  for await(const [n,handle] of system.entries())systemEntries.push([n,handle.kind]);
  if(systemEntries.length!==1||systemEntries[0][0]!=='Workspace'||systemEntries[0][1]!=='directory')
    fail('The browser store contains an application or an unexpected folder.');
  const workspace=await system.getDirectoryHandle('Workspace',{create:false});
  const contents=[];
  for await(const [name,handle] of workspace.entries())contents.push([name,handle.kind]);
  if(contents.length!==REQUIRED_WORKSPACE.length||contents.some(([n,k])=>k!=='directory'||!REQUIRED_WORKSPACE.includes(n)))
    fail('A real or altered Workspace was found. No installation was started.');
  for(const n of REQUIRED_WORKSPACE){
    const d=await workspace.getDirectoryHandle(n,{create:false});
    for await(const _ of d.entries())fail('This Workspace contains data. Refusing to install.');
  }
}
function validatePlan(plan,version){
  if(!plan||plan.version!==version||!Array.isArray(plan.files)||!Array.isArray(plan.directories)||
     plan.files.length<5||plan.files.length>350||plan.directories.length>350)
    fail('The verified official Stable application inventory is unavailable.');
  const paths=new Set(),files=[];let total=0;
  for(const entry of plan.files){
    if(!safePath(entry?.path)||paths.has(entry.path)||!Number.isSafeInteger(entry?.bytes?.byteLength)||
       entry.bytes.byteLength>64*1024*1024||entry.bytes.byteLength<0)
      fail('The verified application inventory has invalid or duplicate filenames.');
    paths.add(entry.path);total+=entry.bytes.byteLength;
    if(total>192*1024*1024)fail('The verified application exceeds installation size limits.');
    if(entry.path.startsWith('System Files/Workspace/')&&entry.path!=='System Files/Workspace/README.txt')
      fail('Refusing a package containing initialized operational data.');
    if(entry.path===STORE||entry.path===MARKER)fail('Official software cannot replace browser store authority.');
    files.push(entry);
  }
  if(!paths.has(APPLICATION)||!paths.has('00 - OPEN DASHBOARD.html')||
     !paths.has('System Files/index.html')||!paths.has('System Files/Workspace/README.txt'))
    fail('Official package is incomplete.');
  const dirs=new Set(plan.directories);
  if(dirs.size!==plan.directories.length||[...dirs].some(p=>!p.endsWith('/')||!safePath(p.slice(0,-1))))
    fail('Verified directory inventory is invalid.');
  for(const f of files){
    const seg=f.path.split('/');
    for(let i=1;i<seg.length;i++)if(!dirs.has(seg.slice(0,i).join('/')+'/'))
      fail('A file has no verified parent folder.');
  }
  return {files,dirs:[...dirs].sort((a,b)=>a.split('/').length-b.split('/').length)};
}

export async function installVerifiedBrowserStore({storage,crypto,locks,storeId,zipBytes,version,expectedZipHash,inspectVerifiedZip}={}){
  // Web Locks serialize installer mutations across tabs of this exact origin.
  // Never invent a lock or fall back to a best-effort in-memory mutex.
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storeId||''))
    fail('Invalid browser-store identity. No files were changed.');
  if(typeof locks?.request!=='function')fail('Cross-tab browser installation lock is unavailable. No files were changed.');
  return locks.request('moondog-pwa-install-'+storeId,{mode:'exclusive',ifAvailable:true},async lock=>{
    if(!lock)fail('Another tab owns this browser-store installation. No files were changed.');
    return installWhileLocked({storage,crypto,storeId,zipBytes,version,expectedZipHash,inspectVerifiedZip});
  });
}

async function installWhileLocked({storage,crypto,storeId,zipBytes,version,expectedZipHash,inspectVerifiedZip}={}){
  if(typeof inspectVerifiedZip!=='function'||typeof crypto?.subtle?.digest!=='function'||
     !/^[a-f0-9]{64}$/.test(expectedZipHash||'')||!/^\d+\.\d+\.\d+$/.test(version||''))
    fail('Verified Stable package authority is missing.');
  const archive=asBytes(zipBytes);
  if(archive.byteLength<22||archive.byteLength>256*1024*1024||
     await sha256(archive,crypto.subtle)!==expectedZipHash)
    fail('Stable package SHA-256 mismatch or invalid archive. Nothing was installed.');
  // Reuse the full audited official ZIP inventory verifier, not a weaker parser.
  const verified=validatePlan(await inspectVerifiedZip(archive.buffer.slice(archive.byteOffset,archive.byteOffset+archive.byteLength),expectedZipHash,version),version);
  const {store}=await openExistingStore({storage,storeId});
  await checkUnconfigured(store);
  const encoder=new TextEncoder();
  const token=encoder.encode(JSON.stringify({format:'moondog-browser-install-marker',version,storeId,status:'incomplete'}));
  await writeFresh(store,MARKER,token,crypto.subtle);
  try{
    for(const path of verified.dirs)await folder(store,path.slice(0,-1),true);
    for(const entry of verified.files){
      if(entry.path===APPLICATION)continue;
      const bytes=asBytes(entry.bytes);
      if(entry.sha256&&await sha256(bytes,crypto.subtle)!==entry.sha256)
        fail('A trusted application file changed before being written: '+entry.path);
      await writeFresh(store,entry.path,bytes,crypto.subtle);
    }
    const inventory=new Map(verified.files.filter(e=>e.path!==APPLICATION).map(e=>[e.path,e]));
    const actual=new Set();
    async function walk(dir,prefix=''){
      for await(const [name,handle] of dir.entries()){
        const path=prefix+name;
        if(path===STORE||path===MARKER)continue;
        if(handle.kind==='directory'){
          if(!verified.dirs.includes(path+'/'))fail('Unexpected directory appeared during installation.');
          await walk(handle,path+'/');
        } else if(handle.kind==='file'){
          const entry=inventory.get(path);
          if(!entry||actual.has(path))fail('Unexpected application file during installation.');
          const bytes=await read(store,path);
          if(bytes.byteLength!==entry.bytes.byteLength||
             await sha256(bytes,crypto.subtle)!==await sha256(asBytes(entry.bytes),crypto.subtle))
            fail('An installed application file changed before manifest commit.');
          actual.add(path);
        }else fail('Unexpected installed file entry.');
      }
    }
    await walk(store);
    if(actual.size!==inventory.size)fail('An application file disappeared before manifest commit.');
    const manifest=verified.files.find(x=>x.path===APPLICATION);
    await writeFresh(store,manifest.path,asBytes(manifest.bytes),crypto.subtle);
    await store.removeEntry(MARKER);
    if(!await absent(store,MARKER))fail('Incomplete-install marker could not be cleared.');
    return Object.freeze({status:'installed',version,storeId,files:verified.files.length,productionReady:false,externalBackupVerified:false});
  }catch(error){
    const e=new Error('Browser installation is incomplete; existing bytes have NOT been cleaned or overwritten. Preserve this store for investigation. '+String(error?.message||error));
    e.incomplete=true;throw e;
  }
}

/**
 * Read-only live-install preflight. Caller MUST provide the SHA-256 of the
 * installation manifest from the independently verified Stable distribution.
 * This never authorizes editing or claims external backup availability.
 */
export async function inspectVerifiedBrowserInstallation({storage,crypto,storeId,version,expectedManifestHash}={}){
  if(typeof crypto?.subtle?.digest!=='function'||!/^[a-f0-9]{64}$/.test(expectedManifestHash||'')||
     !/^\d+\.\d+\.\d+$/.test(version||''))fail('Trusted app manifest authority is missing.');
  const {store,identity}=await openExistingStore({storage,storeId});
  if(!await absent(store,MARKER))fail('A browser-app installation remains incomplete. No store writes are authorized.');
  const manifestBytes=await read(store,APPLICATION);
  if(await sha256(manifestBytes,crypto.subtle)!==expectedManifestHash)
    fail('The installed app manifest differs from trusted Stable authority.');
  let manifest;
  try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));}
  catch(_){fail('The installed app manifest cannot be parsed safely.');}
  if(manifest?.format!=='service-operations-dashboard-clean-install'||
     manifest?.formatVersion!==1||manifest?.version!==version||
     manifest?.packageRoot!=='Service Operations Dashboard'||
     manifest?.applicationRoot!=='System Files'||
     manifest?.workspaceRoot!=='System Files/Workspace'||
     manifest?.workspaceProtectedFromUpdates!==true||
     !Array.isArray(manifest?.files)||manifest.files.length<5||manifest.files.length>350)
    fail('Installed software identity or Workspace boundary changed.');
  const listed=new Map();
  for(const item of manifest.files){
    if(!safePath(item?.path)||listed.has(item.path)||!Number.isSafeInteger(item.size)||
       item.size<0||item.size>64*1024*1024||!(/^[a-f0-9]{64}$/.test(item.sha256||'')))
      fail('The trusted app inventory contains an unsafe file.');
    if(item.path.startsWith('System Files/Workspace/')&&item.path!=='System Files/Workspace/README.txt')
      fail('The app inventory unexpectedly contains private Workspace files.');
    listed.set(item.path,item);
  }
  if(!listed.has('System Files/index.html')||!listed.has('00 - OPEN DASHBOARD.html'))
    fail('Trusted app launcher or entry is missing.');
  // Unknown executable/application files are not harmless. Inspect only public
  // application names; never enumerate report bytes or operational Workspace.
  const allowedFiles=new Set([STORE,APPLICATION,...listed.keys()]);
  async function scanApplication(folder,prefix=''){
    for await(const [name,handle] of folder.entries()){
      const path=prefix+name;
      if(path==='System Files/Workspace'){
        if(handle.kind!=='directory')fail('Protected Workspace layout changed.');
        continue; // No operational file enumeration.
      }
      if(handle.kind==='file'){
        if(!allowedFiles.has(path))fail('Unapproved browser application file appeared: '+path);
      }else if(handle.kind==='directory'){
        if(![...allowedFiles].some(p=>p.startsWith(path+'/')))
          fail('Unexpected browser application directory appeared: '+path);
        await scanApplication(handle,path+'/');
      }else fail('Unknown browser application filesystem entry.');
    }
  }
  await scanApplication(store);
  let verified=0;
  for(const [path,item] of listed){
    const bytes=await read(store,path);
    if(bytes.byteLength!==item.size||await sha256(bytes,crypto.subtle)!==item.sha256)
      fail('Browser application file bytes changed: '+path);
    verified++;
  }
  return Object.freeze({identity,store,version,verifiedAppFiles:verified,
    applicationVerified:true,productionReady:false,externalBackupVerified:false});
}