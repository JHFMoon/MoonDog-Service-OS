/** Bootstrap only a verified, empty SYNTHETIC PWA Workspace. Mirrors the
 * canonical new-store handoff's blank schema-1 source adapter; never supplies
 * store identity or bypasses an existing store's adapter/recovery checks.
 */
import {inspectVerifiedBrowserInstallation} from './install_verified_browser_store.mjs';
const MARKER='MOONDOG-PWA-INSTALL-INCOMPLETE.json';
const fail=message=>{throw new Error(message);};
async function writeNew(dir,name,value){
 try{await dir.getFileHandle(name);fail('Fresh browser initialization refuses existing files.');}
 catch(error){if(error.name!=='NotFoundError')throw error;}
 const writer=await(await dir.getFileHandle(name,{create:true})).createWritable();
 try{await writer.write(value);await writer.close();}
 catch(error){try{await writer.abort();}catch(_){}throw error;}
 const actual=await(await(await dir.getFileHandle(name)).getFile()).text();
 if(actual!==value)fail('Fresh browser initialization failed durable readback.');
}
export async function initializeFreshBrowserWorkspace(args={}){
 if(typeof args.locks?.request!=='function')fail('Exclusive browser-store lock required.');
 return args.locks.request('moondog-pwa-operational-'+args.storeId,{mode:'exclusive',ifAvailable:true},async lock=>{
  if(!lock)fail('Another tab owns this browser Workspace.');
  const {store,identity}=await inspectVerifiedBrowserInstallation(args);
  if(!/^SYNTHETIC(?:\s|$)/i.test(identity.label||''))fail('Only fresh SYNTHETIC previews may be initialized.');
  const workspace=await(await store.getDirectoryHandle('System Files')).getDirectoryHandle('Workspace');
  async function empty(dir,prefix=''){
   for await(const [name,h] of dir.entries()){
    const path=prefix+name;
    if(h.kind==='directory')await empty(h,path+'/');
    else if(path!=='README.txt')fail('Existing Workspace data must be preserved; fresh initialization refused.');
   }
  }
  await empty(workspace);
  // Any interrupted bootstrap stays unlaunchable. No existing bytes are reset.
  await writeNew(store,MARKER,JSON.stringify({operation:'fresh-browser-workspace',storeId:args.storeId,status:'incomplete'}));
  const data=await workspace.getDirectoryHandle('data',{create:false});
  await writeNew(data,'settings.json',JSON.stringify({sourceAdapters:{schemaVersion:1}})+'\n');
  await store.removeEntry(MARKER);
  return Object.freeze({storeId:args.storeId,blankSourceAdapterInitialized:true,productionReady:false});
 });
}
