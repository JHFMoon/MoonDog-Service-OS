/**
 * Browser-only LOCAL backup experiment. Not wired to a production dashboard.
 * Caller must obtain a user-approved external save handle synchronously from
 * a click before any awaited work, and provide a trusted JSZip implementation.
 * No network, telemetry, upload, store mutation, or background save.
 */
import {openExistingStore} from './opfs-store.mjs';
const MAX_FILES=12000,MAX_TOTAL=192*1024*1024,MAX_FILE=64*1024*1024;
const FORMAT='moondog-pwa-external-workspace-backup';
const fail=message=>{throw new Error(message);};
const sha256=async (bytes,subtle)=>Array.from(new Uint8Array(await subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const safe=segment=>Boolean(segment&&segment!=='.'&&segment!=='..'&&!segment.includes('/')&&!/[\\\x00-\x1f]/.test(segment));
async function existsFile(directory,name){try{await directory.getFileHandle(name,{create:false});return true;}catch(error){if(error?.name==='NotFoundError')return false;throw error;}}
async function fileBytes(handle){return new Uint8Array(await(await handle.getFile()).arrayBuffer());}
async function workspaceEntries(directory,subtle){
 const output=[];let total=0,seen=0;
 async function visit(folder,prefix){
   for await(const [name,handle] of folder.entries()){
     if(++seen>MAX_FILES)fail('Too many Workspace entries for a safe backup.');
     if(!safe(name))fail('Unsafe Workspace file or directory name. No backup written.');
     const path=prefix?prefix+'/'+name:name;
     if(handle.kind==='directory'){
       if(output.length>MAX_FILES)fail('Too many source files for safe in-memory backup.');
       await visit(handle,path);
     }else if(handle.kind==='file'){
       if(output.length>=MAX_FILES)fail('Too many source files for safe backup.');
       const bytes=await fileBytes(handle);total+=bytes.byteLength;
       if(bytes.byteLength>MAX_FILE||total>MAX_TOTAL)fail('Workspace exceeds safe in-memory backup limit. No partial export is claimed.');
       output.push({path,bytes,sha256:await sha256(bytes,subtle)});
     }else fail('Unknown Workspace filesystem entry.');
   }
 }
 await visit(directory,'');return output.sort((a,b)=>a.path.localeCompare(b.path));
}
/** Requires a FileSystemFileHandle from a real user gesture, never an OPFS path. */
export async function exportExternalWorkspaceBackup({storage,storeId,crypto,locks,destination,JSZip,now=()=>new Date().toISOString()}={}){
 if(typeof crypto?.subtle?.digest!=='function'||typeof locks?.request!=='function'||
    !destination||typeof destination.createWritable!=='function'||typeof destination.getFile!=='function'||
    typeof JSZip!=='function'||typeof JSZip.loadAsync!=='function')
    fail('External backup permissions, ZIP verifier, or browser lock unavailable.');
 return locks.request('moondog-pwa-backup-'+storeId,{mode:'exclusive',ifAvailable:true},async lock=>{
  if(!lock)fail('Another backup is using this store. No archive was written.');
  const {identity,store}=await openExistingStore({storage,storeId});
  if(await existsFile(store,'MOONDOG-PWA-INSTALL-INCOMPLETE.json'))fail('Cannot back up an incomplete browser installation.');
  const app=await store.getDirectoryHandle('System Files',{create:false});
  const workspace=await app.getDirectoryHandle('Workspace',{create:false});
  const files=await workspaceEntries(workspace,crypto.subtle);
  const zip=new JSZip();
  const manifest={format:FORMAT,formatVersion:1,storeId:identity.storeId,
   createdAt:now(),files:files.map(f=>({path:f.path,size:f.bytes.byteLength,sha256:f.sha256}))};
  for(const f of files)zip.file('workspace/'+f.path,f.bytes);
  zip.file('manifest.json',JSON.stringify(manifest));
  const archive=new Uint8Array(await zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:6}}));
  if(archive.byteLength>MAX_TOTAL)fail('External backup archive is too large; nothing was written.');
  // Recheck each source before writing: a concurrent writer not respecting this
  // early-stage PWA lock must never result in a falsely current backup.
  for(const f of files){
    let folder=workspace;const parts=f.path.split('/');
    for(const p of parts.slice(0,-1))folder=await folder.getDirectoryHandle(p,{create:false});
    const bytes=await fileBytes(await folder.getFileHandle(parts.at(-1),{create:false}));
    if(bytes.byteLength!==f.bytes.byteLength||await sha256(bytes,crypto.subtle)!==f.sha256)
      fail('Workspace changed during backup. No archive was written.');
  }
  const output=await destination.createWritable();
  try{await output.write(archive);await output.close();}
  catch(e){try{await output.abort?.();}catch(_){}throw e;}
  const check=await fileBytes(destination);
  if(check.length!==archive.length||await sha256(check,crypto.subtle)!==await sha256(archive,crypto.subtle))
    fail('External archive readback mismatch. No verified backup exists.');
  const verify=await JSZip.loadAsync(check),readable=verify.file('manifest.json');
  if(!readable)fail('Saved external archive has no manifest.');
  let verified;
  try{verified=JSON.parse(await readable.async('string'));}catch(_){fail('Saved external manifest is unreadable.');}
  if(verified.format!==FORMAT||verified.storeId!==storeId||verified.formatVersion!==1||
     JSON.stringify(verified.files)!==JSON.stringify(manifest.files))fail('Saved external manifest does not match original store.');
  for(const item of manifest.files){
    const reader=verify.file('workspace/'+item.path);
    if(!reader)fail('Saved backup is missing a Workspace file.');
    const bytes=new Uint8Array(await reader.async('uint8array'));
    if(bytes.byteLength!==item.size||await sha256(bytes,crypto.subtle)!==item.sha256)
      fail('Saved backup contains corrupt or changed Workspace bytes.');
  }
  return Object.freeze({status:'externally-verified',storeId,files:files.length,sha256:await sha256(check,crypto.subtle),
   productionReady:false,restoreVerified:false});
 });
}