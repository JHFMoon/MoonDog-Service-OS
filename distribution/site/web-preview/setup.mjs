/* Web-only MoonDog first-run PREVIEW. Verified Stable ZIP is user-selected,
 * never extracted into Windows folders, never uploaded. No real-store data. */
import {initializeFreshBrowserWorkspace} from './modules/initialize_fresh_browser_workspace.mjs';
import {createEmptyStore} from './modules/opfs-store.mjs';
import {installVerifiedBrowserStore} from './modules/install_verified_browser_store.mjs';
import {probeSitePackage,fetchVerifiedSitePackage} from './modules/verified_site_package.mjs';

const $=id=>document.getElementById(id);
const result=$('result'),open=$('openApp');let busy=false;
function status(text,error=false){result.textContent=text;result.className=error?'status error':'status';}
const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),b=>b.toString(16).padStart(2,'0')).join('');
const requireMetadata=value=>{
 if(typeof value?.version!=='string'||!/^\d+\.\d+\.\d+$/.test(value.version)||
    !/^[a-f0-9]{64}$/.test(value.sha256||'')||typeof value.asset!=='string'||
    !value.asset.startsWith('https://github.com/JHFMoon/MoonDog-Service-OS/'))
    throw Error('Trusted Stable release details could not be verified.');
 return value;
};
const PREVIOUS='moondog-pwa-synthetic-preview-pointer-v1';
const SITE_URL=new URL('./',import.meta.url).href;
let websiteAvailable=false;
let activePreview=null,backupUrl=null,verifiedBetaOffer=null;
function showPreview(pointer,launchPointer=pointer){
 // Keep the original Stable identity for backup/restore; launch a verified
 // newer generation only when its independent selection is active.
 activePreview=pointer;
 open.href='./store/'+launchPointer.storeId+'/'+launchPointer.manifestHash+'/'+launchPointer.version+'/index.html';
 open.hidden=false;
 $('prepareBackup').disabled=false;
 $('checkBeta').disabled=false;
 const selected=launchPointer.version!==pointer.version||launchPointer.manifestHash!==pointer.manifestHash;
 $('rollbackBeta').disabled=!selected;
 $('installBeta').disabled=true;
 $('recoverOriginal').disabled=true;
 verifiedBetaOffer=null;
}
async function registerPreviewWorker(){
 const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',type:'module',updateViaCache:'none'});
 if(registration.active?.state==='activated')return;
 const worker=registration.installing||registration.waiting||registration.active;
 if(!worker)throw Error('The preview service worker did not start.');
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>finish(Error('The preview service worker did not activate in time.')),30000);
  function finish(error){
   clearTimeout(timeout);
   worker.removeEventListener('statechange',check);
   if(error)reject(error);else resolve();
  }
  function check(){
   if(worker.state==='activated')finish();
   if(worker.state==='redundant')finish(Error('The preview service worker could not install its offline files.'));
  }
  worker.addEventListener('statechange',check);
  check();
 });
}
async function offerExistingPreview(){
 try{
  const prior=JSON.parse(localStorage.getItem(PREVIOUS)||'null');
  if(!prior||!navigator.storage?.getDirectory||!navigator.serviceWorker?.controller||
     !/^[a-f0-9]{64}$/.test(prior.manifestHash||'')||
     !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(prior.storeId||'')||
     !/^\d+\.\d+\.\d+$/.test(prior.version||''))return;
  const {inspectVerifiedBrowserInstallation}=await import('./modules/install_verified_browser_store.mjs');
  const {inspectActiveBrowserSoftware}=await import('./modules/browser_software_selection.mjs');
  const check=await inspectVerifiedBrowserInstallation({storage:navigator.storage,crypto,
   storeId:prior.storeId,version:prior.version,expectedManifestHash:prior.manifestHash});
  if(!check.applicationVerified||
     typeof check.identity?.label!=='string'||
     !/^SYNTHETIC(?:\s|$)/i.test(check.identity.label))return;
  // An invalid selector must not silently launch an original or a candidate.
  // Only an explicit user recovery action may clear a damaged selector.
  let selection;
  try{selection=await inspectActiveBrowserSoftware({storage:navigator.storage,crypto,storeId:prior.storeId});}
  catch(_){
   activePreview=prior;open.hidden=true;
   $('prepareBackup').disabled=true;$('checkBeta').disabled=true;
   $('rollbackBeta').disabled=true;$('installBeta').disabled=true;
   $('recoverOriginal').disabled=false;
   $('betaStatus').textContent='Software-selection verification failed. The original installation is still intact; close any dashboard tabs and explicitly recover the original verified software.';
   return;
  }
  if(selection&&(selection.originalVersion!==prior.version||selection.originalManifestHash!==prior.manifestHash))return;
  const launch=selection?{storeId:prior.storeId,version:selection.version,
   manifestHash:selection.manifestHash}:prior;
  showPreview(prior,launch);
  status('Existing SYNTHETIC preview verified in browser-private storage. You can reopen it without a ZIP.');
  if(selection)$('betaStatus').textContent='Verified selected Beta '+selection.version+' active. Close the dashboard to roll back to original Stable.';
 }catch(_){/* Missing/corrupt/cleared store must not appear as a usable saved app. */}
}
const existingPreview=offerExistingPreview();
let release=null;
(async()=>{
 try{const response=await fetch('../latest.json',{cache:'no-store'});
  if(!response.ok)throw Error('Release metadata unavailable.');
  release=requireMetadata(await response.json());
  $('version').textContent='Verified official Stable '+release.version;
  $('download').href=release.asset;
  $('download').hidden=false;
  $('install').disabled=false;
  websiteAvailable=await probeSitePackage({siteUrl:SITE_URL,version:release.version,
   sha256:release.sha256,fetchImpl:fetch,crypto});
  $('installFromWeb').disabled=!websiteAvailable;
  $('restoreBackup').disabled=!websiteAvailable;
  $('packageStatus').textContent=websiteAvailable?
   'Official package available for verified installation without any file or folder selection.':
   'Direct package publication is not available yet. No website installation can begin. The synthetic ZIP fallback remains available.';
 }catch(e){
  $('version').textContent='Official release metadata unavailable.';
  await existingPreview;
  if(open.hidden)status('Connect to the internet to start a new preview installation.',true);
 }
})();
async function installPreview(readBytes, recovery){
 if(busy)return;
 if(!$('consent').checked){status('Confirm this is for synthetic testing only.',true);return;}
 if(!release||!navigator.storage?.getDirectory||!navigator.locks?.request||!navigator.serviceWorker){
  status('A required secure Edge feature is unavailable. Nothing was installed.',true);return;
 }
 busy=true;$('install').disabled=true;$('installFromWeb').disabled=true;
 $('prepareBackup').disabled=true;$('restoreBackup').disabled=true;
 try{
  status('Checking the entire official ZIP before creating browser storage…');
  const buffer=await readBytes();
  const inspect=globalThis.MoonDogFreshInstall?.inspectVerifiedZip;
  if(typeof inspect!=='function')throw Error('The official ZIP verifier did not load.');
  const verified=await inspect(buffer,release.sha256,release.version);
  const manifest=verified.files.find(item=>item.path==='INSTALLATION-MANIFEST.json');
  if(!manifest)throw Error('Official installation inventory missing.');
  const manifestHash=await sha(manifest.bytes);
  const recoveryArgs={crypto,version:release.version,expectedManifestHash:manifestHash};
  if(recovery)await recovery.api.inspectSyntheticExternalBackup({...recoveryArgs,
   backup:recovery.backup,expectedStoreId:recovery.sourceStoreId});
  status('Creating an isolated, empty synthetic browser store…');
  const {identity}=await createEmptyStore({storage:navigator.storage,crypto,label:'SYNTHETIC MoonDog Web Preview'});
  await installVerifiedBrowserStore({storage:navigator.storage,crypto,locks:navigator.locks,
   storeId:identity.storeId,zipBytes:buffer,version:release.version,expectedZipHash:release.sha256,inspectVerifiedZip:inspect});
  if(!recovery)await initializeFreshBrowserWorkspace({...recoveryArgs,storage:navigator.storage,locks:navigator.locks,storeId:identity.storeId});
  if(recovery){
   status('Restoring and verifying the synthetic Workspace…');
   await recovery.api.restoreSyntheticExternalBackup({...recoveryArgs,storage:navigator.storage,
    locks:navigator.locks,storeId:identity.storeId,backup:recovery.backup,
    sourceStoreId:recovery.sourceStoreId,checksum:recovery.checksum});
  }
  status('Registering the browser app service worker…');
  await registerPreviewWorker();
  const pointer={storeId:identity.storeId,manifestHash,version:release.version};
  localStorage.setItem(PREVIOUS,JSON.stringify(pointer));
  showPreview(pointer);
  const persistent=await navigator.storage.persisted?.().catch(()=>false);
  status((recovery?'Synthetic Workspace restored and verified. ':'Verified SYNTHETIC preview is installed in browser-private storage. ')+
   'Click Open dashboard to inspect the real MoonDog interface. '+
   (persistent?'Browser persistence is enabled.':'Browser persistence is NOT guaranteed; clearing Edge site data removes this copy.'));
 }catch(e){status('Preview was not completed. Do not use an incomplete store. '+String(e?.message||e),true);}
 finally{busy=false;$('install').disabled=false;$('installFromWeb').disabled=!websiteAvailable;
  $('prepareBackup').disabled=!activePreview;$('restoreBackup').disabled=!websiteAvailable;}
}
$('install').addEventListener('click',()=>{
 const file=$('zip').files?.[0];
 if(!file){status('Select the original official Stable ZIP from Downloads first.',true);return;}
 return installPreview(()=>file.arrayBuffer());
});
async function readSiteBytes(){
 const bytes=await fetchVerifiedSitePackage({siteUrl:SITE_URL,version:release.version,
  sha256:release.sha256,fetchImpl:fetch,crypto});
 return bytes.buffer;
}
$('installFromWeb').addEventListener('click',()=>{
 if(websiteAvailable)return installPreview(readSiteBytes);
});
$('prepareBackup').addEventListener('click',async()=>{
 if(busy||!activePreview||!$('consent').checked){
  $('backupStatus').textContent='Confirm synthetic-only use before preparing a backup.';return;
 }
 $('prepareBackup').disabled=true;
 $('saveBackup').hidden=$('backupReceipt').hidden=$('backupReceiptLabel').hidden=true;
 if(backupUrl){URL.revokeObjectURL(backupUrl);backupUrl=null;}
 try{
  const {createSyntheticExternalBackup}=await import('./modules/synthetic_external_backup.mjs');
  const {storeId,manifestHash,version}=activePreview;
  const backup=await createSyntheticExternalBackup({storage:navigator.storage,locks:navigator.locks,
   crypto,storeId,version,expectedManifestHash:manifestHash});
  backupUrl=URL.createObjectURL(new Blob([JSON.stringify(backup)],{type:'application/json'}));
  $('saveBackup').href=backupUrl;
  $('saveBackup').download='MoonDog-synthetic-'+storeId+'.json';
  $('backupReceipt').value=storeId+':'+backup.sha256;
  $('saveBackup').hidden=$('backupReceipt').hidden=$('backupReceiptLabel').hidden=false;
  $('backupStatus').textContent='Snapshot verified. Download it and save the receipt separately.';
 }catch(error){$('backupStatus').textContent=error.message;}
 finally{$('prepareBackup').disabled=false;}
});
$('restoreBackup').addEventListener('click',async()=>{
 if(busy||!websiteAvailable)return;
 const file=$('backupFile').files?.[0];
 const receipt=/^([0-9a-f-]{36}):([0-9a-f]{64})$/.exec($('restoreReceipt').value.trim());
 if(!$('consent').checked||!file||!file.size||file.size>48*1024*1024||!receipt){
  $('backupStatus').textContent='Confirm synthetic use and provide the backup file and its separate receipt.';return;
 }
 $('restoreBackup').disabled=true;
 try{
  const backup=JSON.parse(await file.text());
  const [,sourceStoreId,checksum]=receipt;
  if(backup?.storeId!==sourceStoreId||backup?.sha256!==checksum)
   throw Error('The separate receipt does not match this backup.');
  const api=await import('./modules/synthetic_external_backup.mjs');
  await installPreview(readSiteBytes,{api,backup,sourceStoreId,checksum});
  $('backupStatus').textContent=result.textContent;
 }catch(error){$('backupStatus').textContent=error.message;}
 finally{$('restoreBackup').disabled=!websiteAvailable;}
});


async function verifyActiveBetaShell(){
 const controller=navigator.serviceWorker?.controller;
 if(!controller||typeof MessageChannel!=='function')
  throw Error('Verified offline browser shell is not controlling this page. Reload the website before applying Beta software.');
 const channel=new MessageChannel();
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{
   channel.port1.close();
   reject(Error('The active browser shell cannot prove its Beta-update version. Reload before changing software.'));
  },4000);
  channel.port1.onmessage=event=>{
   clearTimeout(timer);channel.port1.close();
   if(event.data?.type==='MOONDOG_PREVIEW_SHELL_PROOF'&&
      event.data.cache==='moondog-synthetic-preview-shell-v9')resolve();
   else reject(Error('The active offline browser shell is outdated. Reload before changing software.'));
  };
  try{controller.postMessage({type:'MOONDOG_PREVIEW_SHELL_PROBE'},[channel.port2]);}
  catch(error){clearTimeout(timer);channel.port1.close();reject(error);}
 });
}
function softwareStatus(message,error=false){
 const el=$('betaStatus');el.textContent=message;el.className=error?'status error':'status';
}
function requireSyntheticUpdate(){
 if(busy||!activePreview||!$('consent').checked||!navigator.storage?.getDirectory||!navigator.locks?.request)
  throw Error('Install a verified synthetic preview, consent to testing and close the dashboard before changing software.');
}
$('checkBeta').addEventListener('click',async()=>{
 if(busy)return;
 try{
  requireSyntheticUpdate();
  busy=true;$('checkBeta').disabled=true;$('installBeta').disabled=true;
  await verifyActiveBetaShell();
  softwareStatus('Checking the immutable published Beta package and every public runtime file…');
  const {fetchVerifiedPinnedBeta}=await import('./modules/verified_beta_transport.mjs');
  const beta=await fetchVerifiedPinnedBeta({fetchImpl:fetch,crypto});
  const {inspectActiveBrowserSoftware}=await import('./modules/browser_software_selection.mjs');
  const selection=await inspectActiveBrowserSoftware({storage:navigator.storage,crypto,storeId:activePreview.storeId});
  if(selection)throw Error('A verified Beta is already selected. Roll back before installing another generation.');
  verifiedBetaOffer={version:beta.version,mainSha:beta.mainSha,sha256:beta.packageHash};
  $('installBeta').disabled=false;
  softwareStatus('Verified Beta '+beta.version+' available from published main '+beta.mainSha.slice(0,12)+'. Close the dashboard and select Install verified Beta to stage it safely.');
 }catch(error){verifiedBetaOffer=null;softwareStatus('Beta check refused: '+String(error?.message||error),true);}
 finally{busy=false;$('checkBeta').disabled=!activePreview;}
});
$('installBeta').addEventListener('click',async()=>{
 if(busy)return;
 try{
  requireSyntheticUpdate();
  if(!verifiedBetaOffer)throw Error('Check the verified Beta first.');
  busy=true;$('installBeta').disabled=true;$('checkBeta').disabled=true;
  await verifyActiveBetaShell();
  softwareStatus('Verifying and staging the published Beta outside your Workspace…');
  const {stageVerifiedBetaBrowserSoftware,resumeVerifiedBetaBrowserSoftware}=await import('./modules/browser_software_candidates.mjs');
  const {activateStagedBrowserSoftware}=await import('./modules/browser_software_selection.mjs');
  const {storeId,version,manifestHash}=activePreview;
  const params={storage:navigator.storage,crypto,locks:navigator.locks,
   storeId,installedVersion:version,installedManifestHash:manifestHash,fetchImpl:fetch};
  let staged;
  try{staged=await stageVerifiedBetaBrowserSoftware(params);}
  catch(error){
   // Explicit retry is allowed only when the exact pinned candidate already
   // exists and every staged executable passes complete renewed verification.
   if(!/Candidate generation already exists/.test(String(error?.message||error)))throw error;
   staged=await resumeVerifiedBetaBrowserSoftware(params);
  }
  if(staged.version!==verifiedBetaOffer.version||staged.zipHash!==verifiedBetaOffer.sha256)
   throw Error('Beta authority changed between check and staging. No selector was changed.');
  softwareStatus('Beta files verified. Committing the selection without changing any Workspace file…');
  await activateStagedBrowserSoftware({storage:navigator.storage,crypto,locks:navigator.locks,
   storeId,originalVersion:version,originalManifestHash:manifestHash,
   version:staged.version,zipHash:staged.zipHash,manifestHash:staged.manifestHash});
  showPreview(activePreview,{storeId,version:staged.version,manifestHash:staged.manifestHash});
  softwareStatus('SYNTHETIC Beta '+staged.version+' selected. Open dashboard to test. Your original Stable application and Workspace are unchanged.');
 }catch(error){softwareStatus('Beta installation was refused or incomplete: '+String(error?.message||error)+'. Original software and Workspace are preserved. Do not delete partial candidate storage.',true);}
 finally{busy=false;$('checkBeta').disabled=!activePreview;$('installBeta').disabled=!verifiedBetaOffer;}
});
$('rollbackBeta').addEventListener('click',async()=>{
 if(busy)return;
 try{
  requireSyntheticUpdate();busy=true;$('rollbackBeta').disabled=true;
  const {rollbackBrowserSoftware}=await import('./modules/browser_software_selection.mjs');
  const {storeId,version,manifestHash}=activePreview;
  await rollbackBrowserSoftware({storage:navigator.storage,crypto,locks:navigator.locks,storeId,
   originalVersion:version,originalManifestHash:manifestHash});
  showPreview(activePreview);
  softwareStatus('Verified original Stable '+version+' restored. The same browser-private Workspace and all manual files were preserved.');
 }catch(error){softwareStatus('Rollback refused: '+String(error?.message||error),true);$('rollbackBeta').disabled=false;}
 finally{busy=false;}
});
$('recoverOriginal').addEventListener('click',async()=>{
 if(busy)return;
 try{
  requireSyntheticUpdate();busy=true;$('recoverOriginal').disabled=true;
  const {recoverOriginalBrowserSoftware}=await import('./modules/browser_software_selection.mjs');
  const {storeId,version,manifestHash}=activePreview;
  await recoverOriginalBrowserSoftware({storage:navigator.storage,crypto,locks:navigator.locks,storeId,
   originalVersion:version,originalManifestHash:manifestHash});
  showPreview(activePreview);
  softwareStatus('Verified original Stable '+version+' recovered by explicit request. Original Workspace files were not modified.');
 }catch(error){softwareStatus('Original software recovery refused: '+String(error?.message||error),true);$('recoverOriginal').disabled=false;}
 finally{busy=false;}
});
