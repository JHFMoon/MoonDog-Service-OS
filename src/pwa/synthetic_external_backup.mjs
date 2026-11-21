/**
 * Bounded, locally enrolled or synthetic OPFS Workspace export, offline validation, and recovery into
 * a new verified browser store. Backup and recovery use no network transport.
 */
import {inspectVerifiedBrowserInstallation} from './install_verified_browser_store.mjs';
import {inspectBrowserWorkspaceEnrollment} from './browser_workspace_enrollment.mjs';

const FORMAT='moondog-synthetic-workspace-export';
const OPERATIONAL_FORMAT='moondog-enrolled-workspace-export';
const VERSION=1;
const MAX_FILES=256,MAX_DIRS=256,MAX_FILE_BYTES=8*1024*1024,MAX_TOTAL_BYTES=32*1024*1024;
const LEGACY_LIMITS={MAX_FILES,MAX_DIRS,MAX_FILE_BYTES,MAX_TOTAL_BYTES};
const OPERATIONAL_LIMITS={MAX_FILES:12000,MAX_DIRS:12000,MAX_FILE_BYTES:64*1024*1024,MAX_TOTAL_BYTES:192*1024*1024};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const APP_VERSION=/^\d+\.\d+\.\d+$/;
const fail=message=>{throw new Error(message);};
const synthetic=label=>typeof label==='string'&&/^SYNTHETIC(?:\s|$)/i.test(label);
const part=name=>typeof name==='string'&&name!==''&&name!=='.'&&name!=='..'&&
  !/[\x00-\x1f\x7f\\/:]/.test(name);
const pathOK=value=>typeof value==='string'&&value.split('/').every(part);
const bytesHash=async(bytes,crypto)=>Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
  x=>x.toString(16).padStart(2,'0')).join('');
function assertInputs({crypto,storeId,version,expectedManifestHash}){
  if(typeof crypto?.subtle?.digest!=='function'||!UUID.test(storeId||'')||
     !APP_VERSION.test(version||'')||!SHA.test(expectedManifestHash||''))
    fail('Verified synthetic store identity and application authority are required.');
}
function encode(bytes){
  let chars='';
  for(let i=0;i<bytes.length;i+=8192)
    chars+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(chars);
}
function decode(value,limits=LEGACY_LIMITS){
  const {MAX_FILE_BYTES}=limits;
  if(typeof value!=='string'||value.length>Math.ceil(MAX_FILE_BYTES/3)*4+8||
     value.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    fail('Backup includes invalid or oversized encoded bytes.');
  let raw;
  try{raw=atob(value);}catch(_){fail('Unreadable encoded backup bytes.');}
  if(raw.length>MAX_FILE_BYTES)fail('Backup file exceeds the synthetic limit.');
  const bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  if(encode(bytes)!==value)fail('Backup bytes have a noncanonical encoding.');
  return bytes;
}
function checkLayout(files,dirs,limits=LEGACY_LIMITS){
  const {MAX_FILES,MAX_DIRS,MAX_FILE_BYTES}=limits;
  if(!Array.isArray(files)||!Array.isArray(dirs)||files.length>MAX_FILES||
     dirs.length>MAX_DIRS)fail('Excessive or unreadable backup inventory.');
  const folders=new Set(),folderAliases=new Set();
  for(const d of dirs){
    if(!pathOK(d)||folders.has(d)||folderAliases.has(d.toLowerCase()))
      fail('Unsafe, duplicate or inconsistent backup directory.');
    folders.add(d);folderAliases.add(d.toLowerCase());
  }
  const names=new Set(),fileAliases=new Set();
  for(const f of files){
    if(!f||!pathOK(f.path)||names.has(f.path)||fileAliases.has(f.path.toLowerCase())||
       folderAliases.has(f.path.toLowerCase())||
       !Number.isSafeInteger(f.size)||f.size<0||f.size>MAX_FILE_BYTES||
       !SHA.test(f.sha256||''))fail('Unsafe or repeated backup file.');
    names.add(f.path);fileAliases.add(f.path.toLowerCase());
    const segments=f.path.split('/');
    for(let i=1;i<segments.length;i++)
      if(!folders.has(segments.slice(0,i).join('/')))
        fail('Backup file has an unlisted parent directory.');
  }
  for(const d of folders){
    const segments=d.split('/');
    for(let i=1;i<segments.length;i++)
      if(!folders.has(segments.slice(0,i).join('/')))
        fail('Backup directory has an unlisted parent.');
  }
  const orderedFiles=files.map(f=>f.path);
  if(orderedFiles.some((v,i)=>i&&orderedFiles[i-1]>=v)||
     dirs.some((v,i)=>i&&dirs[i-1]>=v))
    fail('Backup inventory must be canonical and sorted.');
}
async function collectWorkspace(workspace,crypto,limits=LEGACY_LIMITS){
  const {MAX_FILES,MAX_DIRS,MAX_FILE_BYTES,MAX_TOTAL_BYTES}=limits;
  const dirs=[],files=[],seen=new Set();
  let total=0;
  async function walk(dir,prefix=''){
    for await(const [name,handle] of dir.entries()){
      if(!part(name))fail('Unsafe Workspace entry name; export refused.');
      const path=prefix?prefix+'/'+name:name;
      if(seen.has(path.toLowerCase()))fail('Case-colliding Workspace entries; export refused.');
      seen.add(path.toLowerCase());
      if(handle.kind==='directory'){
        if(dirs.length>=MAX_DIRS)fail('Too many Workspace directories to export.');
        dirs.push(path);await walk(handle,path);
      }else if(handle.kind==='file'){
        if(files.length>=MAX_FILES)fail('Too many Workspace files to export.');
        const file=await handle.getFile();
        if(!Number.isSafeInteger(file.size)||file.size>MAX_FILE_BYTES)
          fail('Workspace file is too large for this synthetic export.');
        const bytes=new Uint8Array(await file.arrayBuffer());
        total+=bytes.byteLength;
        if(bytes.byteLength!==file.size||total>MAX_TOTAL_BYTES)
          fail('Workspace changed during export or exceeds safe export bounds.');
        files.push({path,size:bytes.length,sha256:await bytesHash(bytes,crypto),base64:encode(bytes)});
      }else fail('Unknown Workspace filesystem entry.');
    }
  }
  await walk(workspace);
  dirs.sort();files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  checkLayout(files,dirs,limits);
  return {directories:dirs,files};
}
function backupWorkspaceId(backup){
  return Object.hasOwn(backup,'workspaceId') ? backup.workspaceId : backup.storeId;
}
function canonicalBackup(backup){
  return {format:backup.format??FORMAT,formatVersion:VERSION,storeId:backup.storeId,
    ...(backup.format===OPERATIONAL_FORMAT?{enrollment:backup.enrollment}:{}),
    ...(Object.hasOwn(backup,'workspaceId')?{workspaceId:backup.workspaceId}:{}),
    storeLabel:backup.storeLabel,softwareVersion:backup.softwareVersion,
    appManifestHash:backup.appManifestHash,
    directories:backup.directories,files:backup.files};
}
async function createExternalBackup({
  storage,crypto,locks,storeId,version,expectedManifestHash
}={},allowOperational=false){
  assertInputs({crypto,storeId,version,expectedManifestHash});
  if(typeof locks?.request!=='function')fail('Exclusive per-store Web Lock is required for export.');
  return locks.request('moondog-pwa-operational-'+storeId,
    {mode:'exclusive',ifAvailable:true},async lock=>{
      if(!lock)fail('An active tab is using the store; export refused.');
      const verified=await inspectVerifiedBrowserInstallation({
        storage,crypto,storeId,version,expectedManifestHash});
      if(!verified.applicationVerified||verified.identity.storeId!==storeId||
         (!allowOperational&&!synthetic(verified.identity.label)))
        fail('Only a complete, verified SYNTHETIC store can be exported.');
      const scope=inspectBrowserWorkspaceEnrollment(verified.identity);
      if(scope.mode==='operational'&&!allowOperational)fail('Synthetic backup refuses operational enrollment.');
      const limits=scope.mode==='operational'?OPERATIONAL_LIMITS:LEGACY_LIMITS;
      const workspace=await(await verified.store.getDirectoryHandle('System Files',{create:false}))
        .getDirectoryHandle('Workspace',{create:false});
      const inventory=await collectWorkspace(workspace,crypto,limits);
      if(scope.mode==='operational')verifyConfiguredStore(inventory.files,verified.identity.enrollment,limits);
      const body=canonicalBackup({format:scope.mode==='operational'?OPERATIONAL_FORMAT:FORMAT,
        ...(scope.mode==='operational'?{enrollment:verified.identity.enrollment}:{}),
        storeId,workspaceId:verified.identity.workspaceId,
        storeLabel:verified.identity.label,
        softwareVersion:version,appManifestHash:expectedManifestHash,...inventory});
      const checksum=await bytesHash(new TextEncoder().encode(JSON.stringify(body)),crypto);
      return Object.freeze({...body,sha256:checksum,productionReady:false});
    });
}
/** Validate the exported envelope without creating, modifying or adopting any store. */
async function inspectExternalBackup({
  backup,crypto,expectedStoreId,expectedManifestHash,version
}={},allowOperational=false){
  assertInputs({crypto,storeId:expectedStoreId,version,expectedManifestHash});
  const operational=allowOperational&&backup?.format===OPERATIONAL_FORMAT;
  if(!backup||(!operational&&backup.format!==FORMAT)||backup.formatVersion!==VERSION||
     backup.storeId!==expectedStoreId||typeof backupWorkspaceId(backup)!=='string'||
     !UUID.test(backupWorkspaceId(backup))||(!operational&&!synthetic(backup.storeLabel))||
     backup.softwareVersion!==version||backup.appManifestHash!==expectedManifestHash||
     !SHA.test(backup.sha256||'')||backup.productionReady!==false)
    fail('Wrong-store, untrusted or incomplete synthetic backup.');
  let scope={mode:'synthetic'};
  if(operational){
    scope=inspectBrowserWorkspaceEnrollment({label:backup.storeLabel,enrollment:backup.enrollment});
    if(scope.mode!=='operational')fail('Explicit operational enrollment is required.');
  }else if(Object.hasOwn(backup,'enrollment'))fail('Synthetic backup cannot carry operational enrollment.');
  const limits=operational?OPERATIONAL_LIMITS:LEGACY_LIMITS;
  checkLayout(backup.files,backup.directories,limits);
  let size=0;
  for(const file of backup.files){
    const data=decode(file.base64,limits);
    size+=data.length;
    if(size>limits.MAX_TOTAL_BYTES||data.length!==file.size||
       await bytesHash(data,crypto)!==file.sha256)
      fail('Backup file bytes differ from authenticated inventory.');
  }
  const expected=await bytesHash(new TextEncoder().encode(JSON.stringify(canonicalBackup(backup))),crypto);
  if(expected!==backup.sha256)fail('Backup envelope checksum does not match.');
  if(operational)verifyConfiguredStore(backup.files,backup.enrollment,limits);
  return Object.freeze({verified:true,storeId:expectedStoreId,workspaceId:backupWorkspaceId(backup),
    directories:backup.directories.length,files:backup.files.length,
    bytes:size,restoreAuthorized:false,productionReady:false,
    ...(allowOperational?{mode:scope.mode,...(operational?{enrollment:structuredClone(backup.enrollment)}:{})}:{})});
}

/** Recover into a newly installed, empty synthetic Workspace. The separate
 * receipt identifies the source snapshot. The replacement gets its own ID. */
async function restoreExternalBackup({
  storage,crypto,locks,storeId,version,expectedManifestHash,backup,sourceStoreId,checksum
}={},allowOperational=false){
  assertInputs({crypto,storeId,version,expectedManifestHash});
  // Snapshot before the first await: UI/caller mutation cannot substitute a
  // different payload between verification and durable restore.
  backup=structuredClone(backup);
  if(storeId===sourceStoreId||!SHA.test(checksum||'')||backup?.sha256!==checksum)
    fail('The separate backup receipt does not identify this snapshot.');
  const verifiedBackup=await inspectExternalBackup({backup,crypto,expectedStoreId:sourceStoreId,
    expectedManifestHash,version},allowOperational);
  const operational=backup.format===OPERATIONAL_FORMAT,limits=operational?OPERATIONAL_LIMITS:LEGACY_LIMITS;
  if(typeof locks?.request!=='function')fail('Exclusive per-store Web Lock is required for restore.');
  return locks.request('moondog-pwa-operational-'+storeId,
    {mode:'exclusive',ifAvailable:true},async lock=>{
      if(!lock)fail('An active tab is using the replacement store; restore refused.');
      const {identity,store}=await inspectVerifiedBrowserInstallation({
        storage,crypto,storeId,version,expectedManifestHash});
      if(!allowOperational&&!synthetic(identity.label))fail('The replacement must be a verified SYNTHETIC store.');
      const scope=inspectBrowserWorkspaceEnrollment(identity);
      if((scope.mode==='operational')!==operational||operational&&
         JSON.stringify(scope)!==JSON.stringify(inspectBrowserWorkspaceEnrollment({label:backup.storeLabel,enrollment:backup.enrollment})))
        fail('Wrong-store backup: replacement enrollment does not match the confirmed source.');
      if(identity.workspaceId!==verifiedBackup.workspaceId)
        fail('Wrong-store backup: the replacement belongs to a different Workspace.');
      const workspace=await(await store.getDirectoryHandle('System Files')).getDirectoryHandle('Workspace');
      const empty=await collectWorkspace(workspace,crypto,limits);
      const scaffold=['backups','data','exports','imports'];
      const approvedDirectories=new Set([...scaffold,'data/history','support','01 - DROP REPORTS HERE']);
      if(empty.directories.some(path=>!approvedDirectories.has(path))||
         empty.files.some(item=>item.path!=='README.txt'))
        fail('The replacement Workspace must be empty before restore.');
      if(empty.files.length!==1||!backup.files.some(item=>
         item.path==='README.txt'&&item.sha256===empty.files[0].sha256))
        fail('The backup does not match the verified Workspace README.');
      if(empty.directories.some(path=>!backup.directories.includes(path)))
        fail('The backup omits required Workspace folders.');

      async function writeNew(dir,name,data){
        try{
          await dir.getFileHandle(name);
          fail('Restore refuses to replace an existing file.');
        }catch(error){if(error.name!=='NotFoundError')throw error;}
        const writable=await(await dir.getFileHandle(name,{create:true})).createWritable();
        try{await writable.write(data);await writable.close();}
        catch(error){try{await writable.abort();}catch(_){}throw error;}
      }
      const marker='MOONDOG-PWA-INSTALL-INCOMPLETE.json';
      // The existing launcher and bridge both refuse this store until complete.
      const markerBytes=new TextEncoder().encode(JSON.stringify({
        status:'incomplete',operation:'synthetic-restore',storeId,sourceStoreId,checksum
      }));
      await writeNew(store,marker,markerBytes);
      const directories=new Map([['',workspace]]);
      for(const path of backup.directories){
        const split=path.lastIndexOf('/');
        directories.set(path,await directories.get(path.slice(0,Math.max(0,split)))
          .getDirectoryHandle(path.slice(split+1),{create:true}));
      }
      for(const file of backup.files){
        if(file.path==='README.txt')continue;
        const split=file.path.lastIndexOf('/');
        await writeNew(directories.get(file.path.slice(0,Math.max(0,split))),
          file.path.slice(split+1),decode(file.base64,limits));
      }
      const restored=await collectWorkspace(workspace,crypto,limits);
      if(JSON.stringify(restored.directories)!==JSON.stringify(backup.directories)||
         JSON.stringify(restored.files)!==JSON.stringify(backup.files))
        fail('Restored Workspace differs from the verified snapshot.');
      await store.removeEntry(marker);
      try{
        await inspectVerifiedBrowserInstallation({storage,crypto,storeId,version,expectedManifestHash});
      }catch(error){
        try{await writeNew(store,marker,markerBytes);}catch(_){/* No launch pointer is published. */}
        throw error;
      }
      return Object.freeze({storeId,sourceStoreId,files:restored.files.length,productionReady:false});
    });
}

// Legacy entry points retain their original synthetic-only authority and limits.
export const createSyntheticExternalBackup=args=>createExternalBackup(args,false);
export const inspectSyntheticExternalBackup=args=>inspectExternalBackup(args,false);
export const restoreSyntheticExternalBackup=args=>restoreExternalBackup(args,false);
// Explicit enrollment is still required; these APIs never infer authority from
// a display label, bypass verified binaries/locks, or publish Workspace bytes.
export const createBrowserExternalBackup=args=>createExternalBackup(args,true);
export const inspectBrowserExternalBackup=args=>inspectExternalBackup(args,true);
export const restoreBrowserExternalBackup=args=>restoreExternalBackup(args,true);
function verifyConfiguredStore(files,enrollment,limits){
 const settings=files.find(file=>file.path==='data/settings.json');
 if(!settings||settings.size>1024*1024)fail('Enrolled backup requires its matching dealership configuration.');
 let value;
 try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decode(settings.base64,limits)));}
 catch(_){fail('Enrolled backup dealership configuration is unreadable.');}
 if(['name','code','brand','timeZone'].some(key=>value?.store?.[key]!==enrollment.store[key]))
   fail('Wrong-store configuration: Workspace does not match its confirmed enrollment.');
}
