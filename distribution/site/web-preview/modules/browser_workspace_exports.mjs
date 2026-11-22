/** Explicit, read-only delivery of saved reports from one verified Workspace.
 * Private bytes become a user-selected Blob download, never a public URL,
 * CacheStorage entry, or network upload. No file or metadata is written. */
import {inspectActiveBrowserSoftware} from './browser_software_selection.mjs';
import {openVerifiedOperationalWorkspace} from './connect_operational_workspace.mjs';
const MAX_FILES=12000,MAX_BYTES=64*1024*1024;
const SHA=/^[a-f0-9]{64}$/;
const MIME={xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',csv:'text/csv',pdf:'application/pdf'};
const fail=message=>{throw Error(message);};
function mime(name){
 if(typeof name!=='string'||!name||name.length>255||/[\\/\x00-\x1f\x7f<>:]/.test(name)||name==='.'||name==='..')return null;
 return MIME[name.split('.').at(-1).toLowerCase()]||null;
}
const digest=async(bytes,crypto)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
function size(value){if(!Number.isSafeInteger(value)||value<0||value>MAX_BYTES)fail('Saved report exceeds the supported download size.');return value;}
async function withExports(args,read){
 if(args.signal?.aborted)fail('This MoonDog browser session is closed.');
 const selected=await inspectActiveBrowserSoftware(args);
 if(selected&&(selected.originalVersion!==args.version||selected.originalManifestHash!==args.expectedManifestHash))fail('Saved software authority does not match this Workspace.');
 const session=await openVerifiedOperationalWorkspace({...args,version:selected?.version??args.version,expectedManifestHash:selected?.manifestHash??args.expectedManifestHash});
 try{
  const identity=JSON.parse(await(await(await session.handle.getFileHandle('STORE-IDENTITY.json')).getFile()).text());
  const workspaceId=identity.workspaceId??identity.storeId;
  const exports=await(await(await session.handle.getDirectoryHandle('System Files')).getDirectoryHandle('Workspace')).getDirectoryHandle('exports');
  const result=await read(exports,{storeId:session.storeId,workspaceId});
  if(args.signal?.aborted)fail('This MoonDog browser session is closed.');
  return result;
 }finally{await session.close();}
}
export async function listBrowserWorkspaceExports(args={}){
 return withExports(args,async(exports,identity)=>{
  const files=[];let visited=0;
  for await(const[name,handle]of exports.entries()){
   if(++visited>MAX_FILES)fail('Too many saved reports to list at once.');
   if(handle.kind!=='file'||!mime(name))continue;
   const file=await handle.getFile();size(file.size);
   const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length!==file.size)fail('Report changed while loading. Load saved reports again.');
   files.push(Object.freeze({...identity,name,size:bytes.length,sha256:await digest(bytes,args.crypto)}));
  }
  return Object.freeze(files.sort((a,b)=>a.name.localeCompare(b.name)));
 });
}
export async function readBrowserWorkspaceExport({report,...args}={}){
 if(!report||report.storeId!==args.storeId||typeof report.workspaceId!=='string'||!mime(report.name)||!SHA.test(report.sha256||''))fail('Wrong-store or invalid saved report selection.');
 size(report.size);
 return withExports(args,async(exports,identity)=>{
  if(report.workspaceId!==identity.workspaceId)fail('Saved report belongs to another Workspace.');
  const file=await(await exports.getFileHandle(report.name,{create:false})).getFile();size(file.size);
  if(file.size!==report.size)fail('Report changed. Load saved reports again.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(bytes.length!==report.size||await digest(bytes,args.crypto)!==report.sha256)fail('Report changed. Load saved reports again.');
  if(args.signal?.aborted)fail('This MoonDog browser session is closed.');
  return Object.freeze({name:report.name,mime:mime(report.name),bytes});
 });
}
