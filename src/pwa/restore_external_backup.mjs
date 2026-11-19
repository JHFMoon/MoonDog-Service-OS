/**
 * Synthetic-stage browser-only Workspace backup restore (not wired to live UI).
 * Exact store identity only, new empty Workspace only, never overwrite originals.
 * A durable incomplete marker prevents reuse after a partial write.
 * Does not authenticate a user-edited archive or authorize production recovery.
 */
import {openExistingStore} from './opfs-store.mjs';

const FORMAT='moondog-pwa-external-workspace-backup';
const MARKER='INCOMPLETE-SETUP.json';
const INSTALL_HOLD='MOONDOG-PWA-INSTALL-INCOMPLETE.json';
const MAX_FILES=12000,MAX_TOTAL=192*1024*1024,MAX_FILE=64*1024*1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=message=>{throw new Error(message);};
const safePart=part=>typeof part==='string'&&part!==''&&part!=='.'&&part!=='..'&&
  !/[\\\x00-\x1f]/.test(part)&&!part.endsWith('.')&&!part.endsWith(' ');
const safePath=path=>typeof path==='string'&&path.length<1024&&path.split('/').every(safePart);
const digest=async(bytes,crypto)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
async function absent(dir,name){
 for(const method of ['getFileHandle','getDirectoryHandle']){
  try{await dir[method](name,{create:false});return false;}
  catch(error){if(error?.name!=='NotFoundError'&&error?.name!=='TypeMismatchError')throw error;}
 }
 return true;
}
async function bytes(handle){return new Uint8Array(await(await handle.getFile()).arrayBuffer());}
async function readArchive(source,crypto,JSZip){
 if(typeof crypto?.subtle?.digest!=='function'||typeof JSZip?.loadAsync!=='function')fail('Archive verification capability unavailable.');
 const raw=source instanceof Uint8Array?source:new Uint8Array(source);
 if(raw.byteLength<10||raw.byteLength>MAX_TOTAL)fail('Archive is missing or exceeds safe backup size limit.');
 const zip=await JSZip.loadAsync(raw);
 const entries=zip?.files;
 if(!entries||typeof entries!=='object')fail('ZIP entry index is unavailable.');
 const manifestEntry=zip.file('manifest.json');
 if(!manifestEntry)fail('Backup manifest missing.');
 let manifest;
 try{const text=await manifestEntry.async('string');if(text.length>4*1024*1024)fail('Oversized manifest.');manifest=JSON.parse(text);}
 catch(error){fail('Backup manifest cannot be read safely.');}
 if(manifest?.format!==FORMAT||manifest?.formatVersion!==1||!UUID.test(manifest.storeId||'')||
    !Array.isArray(manifest.files)||manifest.files.length>MAX_FILES)
   fail('Backup format or store identity is invalid.');
 const listed=new Set(['manifest.json']),prepared=[];
 let total=0;
 for(const item of manifest.files){
  if(!safePath(item?.path)||!Number.isSafeInteger(item.size)||item.size<0||item.size>MAX_FILE||
     !/^[a-f0-9]{64}$/.test(item.sha256||''))fail('Invalid private Workspace entry in backup.');
  const name='workspace/'+item.path;
  if(listed.has(name))fail('Duplicate private Workspace entry in backup.');
  listed.add(name);
  const entry=zip.file(name);
  if(!entry||entry.dir)fail('Backup file is missing or is a directory.');
  const value=new Uint8Array(await entry.async('uint8array'));
  total+=value.length;
  if(value.length!==item.size||total>MAX_TOTAL||await digest(value,crypto)!==item.sha256)
    fail('Backup member SHA-256 verification failed.');
  prepared.push({path:item.path,bytes:value,sha256:item.sha256});
 }
 // JSZip may synthesize parent folders, but never allow unlisted files,
 // ambiguous original (unsafe) names, or a second manifest.
 const allowedDirs=new Set(['workspace/']);
 for(const item of prepared){
  const parts=item.path.split('/');
  for(let n=1;n<parts.length;n++)allowedDirs.add('workspace/'+parts.slice(0,n).join('/')+'/');
 }
 for(const [name,entry] of Object.entries(entries)){
  if(entry?.unsafeOriginalName&&entry.unsafeOriginalName!==name)
    fail('Backup has a sanitized or unsafe original ZIP path.');
  if(entry?.dir){if(!allowedDirs.has(name))fail('Unapproved backup directory.');}
  else if(!listed.has(name))fail('Unexpected backup file.');
 }
 return {storeId:manifest.storeId,files:prepared,archiveHash:await digest(raw,crypto)};
}
function workdir(store){return store.getDirectoryHandle('System Files',{create:false}).then(d=>d.getDirectoryHandle('Workspace',{create:false}));}
async function emptyWorkspace(workspace){
 async function walk(dir,path=''){
  for await(const [name,handle] of dir.entries()){
   const n=path?path+'/'+name:name;
   if(handle.kind==='directory')await walk(handle,n);
   else if(handle.kind==='file'){
    // Official clean-install README is allowed; no other preexisting file can be adopted.
    if(n!=='README.txt')fail('Workspace already contains data. Restore cannot overwrite another store.');
   }else fail('Unexpected Workspace entry.');
  }
 }
 await walk(workspace);
}
async function putNew(workspace,path,contents,crypto){
 const parts=path.split('/'),name=parts.pop();let dir=workspace;
 for(const item of parts)dir=await dir.getDirectoryHandle(item,{create:true});
 if(!await absent(dir,name)){
  if(path==='README.txt'){
   const saved=await bytes(await dir.getFileHandle(name,{create:false}));
   if(saved.length===contents.length&&await digest(saved,crypto)===await digest(contents,crypto))return;
  }
  fail('Refusing to overwrite existing private Workspace file: '+path);
 }
 const handle=await dir.getFileHandle(name,{create:true});
 const stream=await handle.createWritable({keepExistingData:false});
 try{await stream.write(contents);await stream.close();}
 catch(error){try{await stream.abort?.();}catch(_){}throw error;}
 const saved=await bytes(handle);
 if(saved.length!==contents.length||await digest(saved,crypto)!==await digest(contents,crypto))
  fail('Private Workspace restore readback verification failed.');
}
/** Read-only backup preview; does not create or change a store. */
export async function inspectExternalBackup({archiveBytes,crypto,JSZip}={}){
 const v=await readArchive(archiveBytes,crypto,JSZip);
 return Object.freeze({storeId:v.storeId,files:v.files.length,archiveHash:v.archiveHash,
  integrityChecked:true,identityAuthenticated:false,productionReady:false});
}
/**
 * Apply a previously inspected backup to an EMPTY store with the SAME id.
 * Recovery into a new cleared-browser profile remains a separate unimplemented gate.
 */
export async function restoreExternalBackupToEmptyStore({storage,storeId,crypto,locks,JSZip,archiveBytes,expectedArchiveHash}={}){
 if(!UUID.test(storeId||'')||typeof locks?.request!=='function'||
    !/^[a-f0-9]{64}$/.test(expectedArchiveHash||''))fail('Backup restoration identity or lock unavailable.');
 return locks.request('moondog-pwa-store-'+storeId,{mode:'exclusive',ifAvailable:true},async lock=>{
  if(!lock)fail('Another tab is using this Workspace; no restore started.');
  const backup=await readArchive(archiveBytes,crypto,JSZip);
  if(backup.storeId!==storeId||backup.archiveHash!==expectedArchiveHash)
    fail('Wrong-store backup or backup changed after inspection. Nothing restored.');
  const {store}=await openExistingStore({storage,storeId});
  if(!await absent(store,MARKER)||!await absent(store,INSTALL_HOLD))
    fail('A partial setup or installation is present. Refusing restore.');
  const workspace=await workdir(store);
  await emptyWorkspace(workspace);
  const marker=await store.getFileHandle(MARKER,{create:true});
  const out=await marker.createWritable({keepExistingData:false});
  try{await out.write(JSON.stringify({format:'moondog-pwa-restore-hold',storeId,archiveHash:expectedArchiveHash,status:'incomplete'})+'\n');await out.close();}
  catch(error){try{await out.abort?.();}catch(_){}throw error;}
  try{
   for(const file of backup.files)await putNew(workspace,file.path,file.bytes,crypto);
   // Read back EVERY archived file a second time before releasing durable hold.
   for(const file of backup.files){
    let dir=workspace;const parts=file.path.split('/');
    for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part,{create:false});
    const current=await bytes(await dir.getFileHandle(parts.at(-1),{create:false}));
    if(current.length!==file.bytes.length||await digest(current,crypto)!==file.sha256)
      fail('Restored Workspace changed before final verification.');
   }
   await store.removeEntry(MARKER);
   if(!await absent(store,MARKER))fail('Durable incomplete restore marker was not cleared.');
   return Object.freeze({status:'restored-and-verified',storeId,files:backup.files.length,
     productionReady:false,externalBackupRestoreProvenForSameStore:true});
  }catch(error){
   const failure=new Error('Restore incomplete; store is held closed. Do not use until manually reviewed: '+String(error?.message||error));
   failure.incomplete=true;throw failure;
  }
 });
}