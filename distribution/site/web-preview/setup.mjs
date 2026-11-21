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
  release=requireMetadata(awai…15202 tokens truncated…await fixture(),transport=await syntheticPinnedBeta(),gen=await candidate();
 const params={storage:args.storage,crypto,locks:args.locks,storeId:args.storeId,
  installedVersion:args.installedVersion,installedManifestHash:args.installedManifestHash,fetchImpl:transport.fetchImpl};
 const first=await gen.stageVerifiedBetaBrowserSoftware(params);
 const resumed=await gen.resumeVerifiedBetaBrowserSoftware(params);
 assert.equal(resumed.resumed,true);
 assert.equal(resumed.version,first.version);assert.equal(resumed.manifestHash,first.manifestHash);
 assert.equal(await read(store,'System Files/Workspace/data/manual.txt'),'manual override preserved');
 const stage=await args.storage.root.getDirectoryHandle('MoonDog-PWA-v1').then(x=>x.getDirectoryHandle('software-candidates'))
  .then(x=>x.getDirectoryHandle(args.storeId)).then(x=>x.getDirectoryHandle(first.version+'-'+first.zipHash));
 const asset=await stage.getDirectoryHandle('System Files').then(x=>x.getDirectoryHandle('assets')).then(x=>x.getFileHandle('app.js'));
 asset.bytes=b('tampered');
 await assert.rejects(gen.resumeVerifiedBetaBrowserSoftware(params),/checksum mismatch/);
 assert.equal(await read(store,'System Files/Workspace/data/SAPR.json'),'original report, do not touch');
});

test('two synthetic stores sharing one browser origin retain independent active Beta and Workspace generations',async()=>{
 const common=storage(),alpha=await fixture('SYNTHETIC Alpha',common),bravo=await fixture('SYNTHETIC Bravo',common);
 assert.notEqual(alpha.identity.storeId,bravo.identity.storeId);
 // Overlapping operational filename and identical official Beta version are intentional.
 await write(alpha.store,'System Files/Workspace/data/SAPR.json',b('CP GROSS ALPHA 500'));
 await write(bravo.store,'System Files/Workspace/data/SAPR.json',b('CP GROSS BRAVO 200'));
 const transport=await syntheticPinnedBeta(),gen=await candidate(),selector=await select();
 const params=x=>({storage:common,crypto,locks:x.args.locks,storeId:x.identity.storeId,
  installedVersion:x.args.installedVersion,installedManifestHash:x.args.installedManifestHash,
  fetchImpl:transport.fetchImpl});
 const stageA=await gen.stageVerifiedBetaBrowserSoftware(params(alpha));
 await assert.rejects(selector.activateStagedBrowserSoftware({
  storage:common,crypto,locks:bravo.args.locks,storeId:bravo.identity.storeId,
  originalVersion:bravo.args.installedVersion,originalManifestHash:bravo.args.installedManifestHash,
  version:stageA.version,zipHash:stageA.zipHash,manifestHash:stageA.manifestHash
 }),/NotFoundError|not found|missing/,'Alpha candidate must not be adopted by Bravo');
 const activatedA=await selector.activateStagedBrowserSoftware({
  storage:common,crypto,locks:alpha.args.locks,storeId:alpha.identity.storeId,
  originalVersion:alpha.args.installedVersion,originalManifestHash:alpha.args.installedManifestHash,
  version:stageA.version,zipHash:stageA.zipHash,manifestHash:stageA.manifestHash});
 assert.equal(activatedA.active,true);
 assert.equal(await selector.inspectActiveBrowserSoftware({storage:common,crypto,storeId:bravo.identity.storeId}),null);
 const stageB=await gen.stageVerifiedBetaBrowserSoftware(params(bravo));
 const activatedB=await selector.activateStagedBrowserSoftware({
  storage:common,crypto,locks:bravo.args.locks,storeId:bravo.identity.storeId,
  originalVersion:bravo.args.installedVersion,originalManifestHash:bravo.args.installedManifestHash,
  version:stageB.version,zipHash:stageB.zipHash,manifestHash:stageB.manifestHash});
 assert.equal(activatedB.active,true);
 await selector.rollbackBrowserSoftware({storage:common,crypto,locks:alpha.args.locks,storeId:alpha.identity.storeId,
  originalVersion:alpha.args.installedVersion,originalManifestHash:alpha.args.installedManifestHash});
 assert.equal(await selector.inspectActiveBrowserSoftware({storage:common,crypto,storeId:alpha.identity.storeId}),null);
 const bravoActive=await selector.inspectActiveBrowserSoftware({storage:common,crypto,storeId:bravo.identity.storeId});
 assert.equal(bravoActive.version,BETA_VERSION,'Alpha rollback cannot reset Bravo selection');
 assert.equal(await read(alpha.store,'System Files/Workspace/data/SAPR.json'),'CP GROSS ALPHA 500');
 assert.equal(await read(bravo.store,'System Files/Workspace/data/SAPR.json'),'CP GROSS BRAVO 200');
 assert.equal(await read(alpha.store,'System Files/Workspace/data/manual.txt'),'manual override preserved');
 assert.equal(await read(bravo.store,'System Files/Workspace/data/manual.txt'),'manual override preserved');
 assert.equal(await read(alpha.store,'System Files/index.html'),'<html>synthetic</html>');
 assert.equal(await read(bravo.store,'System Files/index.html'),'<html>synthetic</html>');
});

test('external Workspace backup made with selected Beta survives complete synthetic origin replacement',async()=>{
 const source=await fixture('SYNTHETIC Lost Origin');
 const gen=await candidate(),selector=await select(),backupApi=await import('../src/pwa/synthetic_external_backup.mjs');
 const transport=await syntheticPinnedBeta(),params={storage:source.args.storage,crypto,locks:source.args.locks,
  storeId:source.identity.storeId,installedVersion:source.args.installedVersion,
  installedManifestHash:source.args.installedManifestHash,fetchImpl:transport.fetchImpl};
 const staged=await gen.stageVerifiedBetaBrowserSoftware(params);
 await selector.activateStagedBrowserSoftware({storage:params.storage,crypto,locks:params.locks,storeId:params.storeId,
  originalVersion:params.installedVersion,originalManifestHash:params.installedManifestHash,
  version:staged.version,zipHash:staged.zipHash,manifestHash:staged.manifestHash});
 const exported=await backupApi.createSyntheticExternalBackup({storage:params.storage,crypto,locks:params.locks,
  storeId:params.storeId,version:params.installedVersion,expectedManifestHash:params.installedManifestHash});
 assert.equal(exported.softwareVersion,'0.10.17','Backups bind to original verified software, not selected Beta');
 assert.ok(exported.files.some(x=>x.path==='data/SAPR.json'));
 assert.ok(exported.files.every(x=>!x.path.includes('software-candidates')&&!x.path.includes('software-selections')));
 const receipt={sourceStoreId:source.identity.storeId,checksum:exported.sha256};
 // A brand new OPFS root simulates complete browser-origin site-data deletion.
 // The backup and separate receipt are retained outside that origin.
 const fresh=await fixture('SYNTHETIC Reinstalled');
 assert.notEqual(fresh.args.storage.root,source.args.storage.root);
 const freshData=await fresh.store.getDirectoryHandle('System Files').then(x=>x.getDirectoryHandle('Workspace'))
  .then(x=>x.getDirectoryHandle('data'));
 await freshData.removeEntry('SAPR.json');
 await freshData.removeEntry('manual.txt');
 const restore={storage:fresh.args.storage,crypto,locks:fresh.args.locks,storeId:fresh.identity.storeId,
  version:fresh.args.installedVersion,expectedManifestHash:fresh.args.installedManifestHash,
  backup:JSON.parse(JSON.stringify(exported)),...receipt};
 await assert.rejects(backupApi.restoreSyntheticExternalBackup({...restore,checksum:'0'.repeat(64)}),/receipt/);
 await assert.rejects(backupApi.restoreSyntheticExternalBackup({...restore,sourceStoreId:randomUUID()}),/Wrong-store/);
 const result=await backupApi.restoreSyntheticExternalBackup(restore);
 assert.equal(result.sourceStoreId,source.identity.storeId);
 assert.notEqual(result.storeId,result.sourceStoreId);
 assert.equal(await read(fresh.store,'System Files/Workspace/data/SAPR.json'),'original report, do not touch');
 assert.equal(await read(fresh.store,'System Files/Workspace/data/manual.txt'),'manual override preserved');
 assert.equal(await read(fresh.store,'System Files/index.html'),'<html>synthetic</html>');
 assert.equal(await selector.inspectActiveBrowserSoftware({storage:fresh.args.storage,crypto,storeId:fresh.identity.storeId}),null,
  'Restoring a Workspace must not adopt the erased origin software selection or staged Beta');
 // Reproduce the production sequence, not just isolated restore and Beta selection:
 // a deleted browser origin, restored Workspace, then a new verified Beta stage.
 const restaged=await gen.stageVerifiedBetaBrowserSoftware({storage:fresh.args.storage,crypto,
  locks:fresh.args.locks,storeId:fresh.identity.storeId,
  installedVersion:fresh.args.installedVersion,
  installedManifestHash:fresh.args.installedManifestHash,fetchImpl:transport.fetchImpl});
 assert.equal(restaged.status,'verified-staged');
 assert.equal(await read(fresh.store,'System Files/Workspace/data/SAPR.json'),'original report, do not touch');
 assert.equal(await read(fresh.store,'System Files/Workspace/data/manual.txt'),'manual override preserved');
 await assert.rejects(backupApi.restoreSyntheticExternalBackup(restore),/must be empty/);
});
