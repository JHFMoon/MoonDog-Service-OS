/**
 * SYNTHETIC PWA software selector. Only the verified active application routing
 * changes; neither original application bytes nor the Workspace are written.
 * The selected generation must be pre-staged and verified from an authenticated
 * package. No real-store deployment, release promotion, or automatic update.
 */
import {inspectVerifiedBrowserInstallation} from './install_verified_browser_store.mjs';
import {inspectStagedBrowserSoftware} from './browser_software_candidates.mjs';
const BUCKET='MoonDog-PWA-v1', DIR='software-selections', ACTIVE='ACTIVE.json';
const SHA=/^[a-f0-9]{64}$/, UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const VERSION=/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/;
const PUBLIC=/^(?:index\.html|assets\/[A-Za-z0-9._-]+|vendor\/[A-Za-z0-9._-]+)$/;
const TYPES={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml',json:'application/json'};
const fail=message=>{throw Error(message);};
const missing=error=>error?.name==='NotFoundError';
const sha256=async(value,crypto)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),b=>b.toString(16).padStart(2,'0')).join('');
function validate({storeId,originalVersion,originalManifestHash,version,zipHash,manifestHash},needCandidate=true){
 if(!UUID.test(storeId||'')||!VERSION.test(originalVersion||'')||!SHA.test(originalManifestHash||''))fail('Verified original application authority required.');
 if(needCandidate&&(!VERSION.test(version||'')||!SHA.test(zipHash||'')||!SHA.test(manifestHash||'')))fail('Verified staged software authority required.');
}
function validateRecord(v,storeId){
 if(v?.format!=='moondog-browser-software-selection'||v?.schemaVersion!==1||v.storeId!==storeId||
    v.status!=='candidate-active')fail('Unrecognized active software selection; refusing untrusted fallback.');
 validate(v);
 if(v.version===v.originalVersion&&v.manifestHash===v.originalManifestHash)fail('Candidate must differ from original generation.');
 return v;
}
async function folder(storage,storeId,create){
 const root=await storage.getDirectory();
 const bucket=await root.getDirectoryHandle(BUCKET,{create:false});
 const selections=await bucket.getDirectoryHandle(DIR,{create});
 return selections.getDirectoryHandle(storeId,{create});
}
async function readSelection(storage,storeId){
 if(!UUID.test(storeId||''))fail('Invalid browser store identity.');
 let dir,handle;
 try{dir=await folder(storage,storeId,false);handle=await dir.getFileHandle(ACTIVE,{create:false});}
 catch(error){if(missing(error))return null;throw error;}
 const bytes=new Uint8Array(await(await handle.getFile()).arrayBuffer());
 if(bytes.length<10||bytes.length>2048)fail('Active software selection record unreadable.');
 let record;try{record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
 catch(_){fail('Corrupted active software selection. Refusing untrusted fallback.');}
 return validateRecord(record,storeId);
}
async function proveOriginal({storage,crypto,storeId,originalVersion,originalManifestHash}){
 const original=await inspectVerifiedBrowserInstallation({storage,crypto,storeId,version:originalVersion,
  expectedManifestHash:originalManifestHash});
 if(!original?.applicationVerified||original.identity?.storeId!==storeId||
    !/^SYNTHETIC(?:\s|$)/i.test(original.identity?.label||''))fail('Only verified synthetic originals may change software selection.');
}
async function proveCandidate({storage,crypto,storeId,version,zipHash,manifestHash}){
 const proof=await inspectStagedBrowserSoftware({storage,crypto,storeId,version,zipHash,
  expectedManifestHash:manifestHash});
 if(proof.status!=='verified-staged'||proof.manifestHash!==manifestHash)fail('Staged software is not verified.');
 return proof;
}
async function withLock(locks,storeId,fn){
 if(typeof locks?.request!=='function')fail('Browser operational lock unavailable.');
 return locks.request('moondog-pwa-operational-'+storeId,{mode:'exclusive',ifAvailable:true},async lock=>{
  if(!lock)fail('Close the active browser dashboard before changing software.');
  return fn();
 });
}
/** Commit a verified candidate by an atomic OPFS writable close; all other bytes remain unchanged. */
export async function activateStagedBrowserSoftware(args={}){
 const {storage,crypto,storeId,locks}=args;
 validate(args);
 if(typeof storage?.getDirectory!=='function'||typeof crypto?.subtle?.digest!=='function')fail('Browser storage/crypto unavailable.');
 return withLock(locks,storeId,async()=>{
  await proveOriginal(args);
  await proveCandidate(args);
  if(await readSelection(storage,storeId))fail('Another software generation is already active. Roll back first.');
  const record={format:'moondog-browser-software-selection',schemaVersion:1,status:'candidate-active',
   storeId,originalVersion:args.originalVersion,originalManifestHash:args.originalManifestHash,
   version:args.version,zipHash:args.zipHash,manifestHash:args.manifestHash};
  const dir=await folder(storage,storeId,true);
  let exists=false;try{await dir.getFileHandle(ACTIVE,{create:false});exists=true;}catch(e){if(!missing(e))throw e;}
  if(exists)fail('Existing active software record cannot be overwritten.');
  const bytes=new TextEncoder().encode(JSON.stringify(record));
  const handle=await dir.getFileHandle(ACTIVE,{create:true}),stream=await handle.createWritable({keepExistingData:false});
  try{await stream.write(bytes);await stream.close();}
  catch(error){try{await stream.abort?.();}catch(_){}throw Error('Software selection incomplete, original untouched: '+error);}
  const readback=await readSelection(storage,storeId);
  if(readback.manifestHash!==record.manifestHash||readback.zipHash!==record.zipHash||
     await sha256(new Uint8Array(await(await handle.getFile()).arrayBuffer()),crypto)!==await sha256(bytes,crypto))
    fail('Active software record failed durable readback. Refusing to launch.');
  await proveCandidate(args);
  return Object.freeze({active:true,storeId,version:record.version,manifestHash:record.manifestHash,
   previousVersion:record.originalVersion,originalWorkspaceUntouched:true,productionReady:false});
 });
}
/** Recover a usable candidate only when its original and staged contents both pass reinspection. */
export async function inspectActiveBrowserSoftware({storage,crypto,storeId}={}){
 const record=await readSelection(storage,storeId);
 if(!record)return null;
 await proveOriginal({...record,storage,crypto});
 await proveCandidate({...record,storage,crypto});
 return Object.freeze({active:true,storeId,version:record.version,manifestHash:record.manifestHash,
  originalVersion:record.originalVersion,originalManifestHash:record.originalManifestHash,zipHash:record.zipHash});
}
/** Roll back to original verified software even if the candidate executable has become corrupt. */
export async function rollbackBrowserSoftware({storage,crypto,locks,storeId,originalVersion,originalManifestHash}={}){
 validate({storeId,originalVersion,originalManifestHash},false);
 return withLock(locks,storeId,async()=>{
  const record=await readSelection(storage,storeId);
  if(!record)fail('No active candidate to roll back.');
  if(record.originalVersion!==originalVersion||record.originalManifestHash!==originalManifestHash)
   fail('Rollback authority does not match verified original.');
  await proveOriginal({storage,crypto,storeId,originalVersion,originalManifestHash});
  const dir=await folder(storage,storeId,false);
  await dir.removeEntry(ACTIVE);
  if(await readSelection(storage,storeId))fail('Rollback did not clear the candidate selection.');
  return Object.freeze({rolledBack:true,storeId,version:originalVersion,
   manifestHash:originalManifestHash,originalWorkspaceUntouched:true,productionReady:false});
 });
}
/** Explicit synthetic recovery when an interrupted record cannot be parsed.
 * Never silently fall back. The caller must supply original manifest authority. */
export async function recoverOriginalBrowserSoftware({storage,crypto,locks,storeId,originalVersion,originalManifestHash}={}){
 validate({storeId,originalVersion,originalManifestHash},false);
 return withLock(locks,storeId,async()=>{
  await proveOriginal({storage,crypto,storeId,originalVersion,originalManifestHash});
  let dir;try{dir=await folder(storage,storeId,false);}catch(e){if(missing(e))return Object.freeze({alreadyOriginal:true,storeId});throw e;}
  let recordPresent=false;try{await dir.getFileHandle(ACTIVE,{create:false});recordPresent=true;}catch(e){if(!missing(e))throw e;}
  if(!recordPresent)return Object.freeze({alreadyOriginal:true,storeId});
  // This is an explicit recovery request, not an automatic fallback.
  // It deletes ONLY the untrusted active-selection record, never any store data.
  await dir.removeEntry(ACTIVE);
  if(await readSelection(storage,storeId))fail('Active software recovery could not clear the selection.');
  return Object.freeze({recoveredOriginal:true,storeId,version:originalVersion,
   manifestHash:originalManifestHash,originalWorkspaceUntouched:true,productionReady:false});
 });
}
/** Only fetch a selected candidate when both URL and staged bytes match active authority. */
export async function readActiveCandidateAsset({storage,crypto,storeId,version,expectedManifestHash,relativePath}={}){
 if(!PUBLIC.test(relativePath||''))fail('Only approved public application paths may be served.');
 const record=await readSelection(storage,storeId);
 if(!record)return null;
 if(version!==record.version||expectedManifestHash!==record.manifestHash)
  fail('Public software request does not match the active verified generation.');
 await proveOriginal({...record,storage,crypto});
 const candidate=await proveCandidate({...record,storage,crypto});
 // The staged candidate is stored outside the original Workspace and origin-owned store.
 const root=await storage.getDirectory(),bucket=await root.getDirectoryHandle(BUCKET,{create:false});
 const all=await bucket.getDirectoryHandle(candidate.candidateBucket,{create:false});
 const owned=await all.getDirectoryHandle(storeId,{create:false});
 let fileDir=await owned.getDirectoryHandle(record.version+'-'+record.zipHash,{create:false});
 const parts=('System Files/'+relativePath).split('/');
 for(const part of parts.slice(0,-1))fileDir=await fileDir.getDirectoryHandle(part,{create:false});
 const data=new Uint8Array(await(await(await fileDir.getFileHandle(parts.at(-1),{create:false})).getFile()).arrayBuffer());
 const stageRoot=await owned.getDirectoryHandle(record.version+'-'+record.zipHash,{create:false});
 const manifestBytes=new Uint8Array(await(await(await stageRoot.getFileHandle('INSTALLATION-MANIFEST.json',{create:false})).getFile()).arrayBuffer());
 if(await sha256(manifestBytes,crypto)!==record.manifestHash)fail('Active software manifest changed during asset read.');
 const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));
 const entry=manifest.files.find(x=>x.path==='System Files/'+relativePath);
 if(!entry||data.length!==entry.size||await sha256(data,crypto)!==entry.sha256)
  fail('Selected application file changed after software verification.');
 const extension=relativePath.split('.').at(-1);
 return Object.freeze({bytes:data,mime:TYPES[extension]||'application/octet-stream',verified:true});
}
