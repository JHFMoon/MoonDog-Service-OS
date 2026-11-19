/* Web-only MoonDog first-run PREVIEW. Verified Stable ZIP is user-selected,
 * never extracted into Windows folders, never uploaded. No real-store data. */
import {createEmptyStore} from './modules/opfs-store.mjs';
import {installVerifiedBrowserStore} from './modules/install_verified_browser_store.mjs';

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
async function offerExistingPreview(){
 try{
  const prior=JSON.parse(localStorage.getItem(PREVIOUS)||'null');
  if(!prior||!navigator.storage?.getDirectory||!/^[a-f0-9]{64}$/.test(prior.manifestHash||'')||
     !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(prior.storeId||'')||
     !/^\d+\.\d+\.\d+$/.test(prior.version||''))return;
  const {inspectVerifiedBrowserInstallation}=await import('./modules/install_verified_browser_store.mjs');
  const check=await inspectVerifiedBrowserInstallation({storage:navigator.storage,crypto,
   storeId:prior.storeId,version:prior.version,expectedManifestHash:prior.manifestHash});
  if(!check.applicationVerified)return;
  open.href='./store/'+prior.storeId+'/'+prior.manifestHash+'/'+prior.version+'/index.html';
  open.hidden=false;
  status('Existing SYNTHETIC preview verified in browser-private storage. You can reopen it without a ZIP.');
 }catch(_){/* Missing/corrupt/cleared store must not appear as a usable saved app. */}
}
void offerExistingPreview();
let release=null;
(async()=>{
 try{const response=await fetch('../latest.json',{cache:'no-store'});
  if(!response.ok)throw Error('Release metadata unavailable.');
  release=requireMetadata(await response.json());
  $('version').textContent='Verified official Stable '+release.version;
  $('download').href=release.asset;
  $('download').hidden=false;
  $('install').disabled=false;
 }catch(e){status('Official release metadata unavailable. Nothing can be installed.',true);}
})();
$('install').addEventListener('click',async()=>{
 if(busy)return;
 if(!$('consent').checked){status('Confirm this is for synthetic testing only.',true);return;}
 if(!release||!navigator.storage?.getDirectory||!navigator.locks?.request||!navigator.serviceWorker){
  status('A required secure Edge feature is unavailable. Nothing was installed.',true);return;
 }
 const file=$('zip').files?.[0];
 if(!file){status('Select the original official Stable ZIP from your Downloads first.',true);return;}
 busy=true;$('install').disabled=true;open.hidden=true;
 try{
  status('Checking the entire official ZIP before creating browser storage…');
  const buffer=await file.arrayBuffer();
  const inspect=globalThis.MoonDogFreshInstall?.inspectVerifiedZip;
  if(typeof inspect!=='function')throw Error('The official ZIP verifier did not load.');
  const verified=await inspect(buffer,release.sha256,release.version);
  const manifest=verified.files.find(item=>item.path==='INSTALLATION-MANIFEST.json');
  if(!manifest)throw Error('Official installation inventory missing.');
  const manifestHash=await sha(manifest.bytes);
  status('Creating an isolated, empty synthetic browser store…');
  const {identity}=await createEmptyStore({storage:navigator.storage,crypto,label:'SYNTHETIC MoonDog Web Preview'});
  await installVerifiedBrowserStore({storage:navigator.storage,crypto,locks:navigator.locks,
   storeId:identity.storeId,zipBytes:buffer,version:release.version,expectedZipHash:release.sha256,inspectVerifiedZip:inspect});
  status('Registering the browser app service worker…');
  const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',type:'module'});
  await navigator.serviceWorker.ready;
  if(!registration.active)throw Error('The browser app service worker is not active. The verified store was preserved.');
  const dest='./store/'+identity.storeId+'/'+manifestHash+'/'+release.version+'/index.html';
  open.href=dest;open.hidden=false;
  localStorage.setItem(PREVIOUS,JSON.stringify({storeId:identity.storeId,manifestHash,version:release.version}));
  const persistent=typeof navigator.storage.persisted==='function'?await navigator.storage.persisted():false;
  status('Verified SYNTHETIC preview is installed in browser-private storage. Click Open dashboard to inspect the real MoonDog interface. '+
   (persistent?'Browser persistence is enabled.':'Browser persistence is NOT guaranteed; clearing Edge site data removes this copy.'));
 }catch(e){status('Preview was not completed. Do not use an incomplete store. '+String(e?.message||e),true);}
 finally{busy=false;$('install').disabled=false;}
});