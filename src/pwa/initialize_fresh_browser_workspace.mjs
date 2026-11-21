/** Bootstrap only a verified, empty, explicitly enrolled or synthetic Workspace. Mirrors the
 * canonical new-store handoff's blank schema-1 source adapter; never supplies
 * invented operational values or bypasses an existing store's recovery checks.
 */
import {inspectVerifiedBrowserInstallation} from './install_verified_browser_store.mjs';
import {inspectBrowserWorkspaceEnrollment} from './browser_workspace_enrollment.mjs';
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
  const enrollment=inspectBrowserWorkspaceEnrollment(identity);
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
  const settings={sourceAdapters:{schemaVersion:1}};
  if(enrollment.mode==='operational'){
    const {name,code,brand,timeZone}=enrollment.store;
    settings.store={name,code,brand,timeZone,confirmed:{name:true,code:true,brand:Boolean(brand),timeZone:true}};
    settings.storeName=name;
  }
  await writeNew(data,'settings.json',JSON.stringify(settings)+'\n');
  await store.removeEntry(MARKER);
  return Object.freeze({storeId:args.storeId,mode:enrollment.mode,blankSourceAdapterInitialized:true,productionReady:false});
 });
}
