import {fetchVerifiedSitePackage} from './web-preview/modules/verified_site_package.mjs';
const $=id=>document.getElementById(id);
const consent=$('newInstallConsent'), identityConfirm=$('identityConfirm'),
 button=$('installNow'),folder=$('folderName'),
 storeName=$('storeName'),storeCode=$('storeCode'),storeBrand=$('storeBrand'),
 storeTimeZone=$('storeTimeZone');
const progress=$('installStatus'), releaseStatus=$('releaseStatus'), installed=$('installed');
let stable=null,busy=false;
const releaseUrl=new URL('./latest.json',location.href);
const siteUrl='https://jhfmoon.github.io/MoonDog-Service-OS/web-preview/';
const officialAsset='https://github.com/JHFMoon/MoonDog-Service-OS/releases/latest/download/Service-Operations-Dashboard.zip';
function message(text,error=false,success=false){
 progress.textContent=text;progress.className='status'+(error?' error':success?' ok':'');
}
function identityValue(){
 return {name:storeName.value.trim(),code:storeCode.value.trim(),
  brand:storeBrand.value.trim(),timeZone:storeTimeZone.value};
}
function validIdentity({name,code,brand,timeZone}){
 return !!name&&name.length<=120&&!/[\x00-\x1f\x7f<>]/.test(name)&&
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(code)&&
  brand.length<=80&&!/[\x00-\x1f\x7f<>]/.test(brand)&&
  ['America/Los_Angeles','America/Denver','America/Chicago','America/New_York'].includes(timeZone);
}
function ready(){
 button.disabled=busy||!stable||!consent.checked||!identityConfirm.checked||
  !validIdentity(identityValue())||
  typeof window.showDirectoryPicker!=='function'||
  typeof globalThis.MoonDogFreshInstall?.install!=='function';
}
consent.addEventListener('change',ready);
identityConfirm.addEventListener('change',ready);
for(const field of [storeName,storeCode,storeBrand,storeTimeZone]){
 field.addEventListener('input',()=>{identityConfirm.checked=false;ready();});
 field.addEventListener('change',()=>{identityConfirm.checked=false;ready();});
}
(async()=>{
 try{
  if(location.origin!=='https://jhfmoon.github.io'||
     location.pathname!=='/MoonDog-Service-OS/local-install.html')
    throw Error('Open the official MoonDog installation website in Microsoft Edge.');
  if(!/Windows/i.test(navigator.userAgent||'')||typeof window.showDirectoryPicker!=='function')
    throw Error('This installation requires current Microsoft Edge on Windows.');
  const response=await fetch(releaseUrl.href,{cache:'no-store',redirect:'error',credentials:'omit'});
  if(!response.ok||response.redirected||response.url!==releaseUrl.href)throw Error('Release information unavailable.');
  const data=await response.json();
  if(!/^\d+\.\d+\.\d+$/.test(data?.version||'')||
     !/^[a-f0-9]{64}$/.test(data?.sha256||'')||data?.asset!==officialAsset)
    throw Error('The official Stable release metadata is invalid.');
  stable={version:data.version,sha256:data.sha256};
  releaseStatus.textContent='Verified release authority: Stable '+stable.version+'. Package fingerprint will be checked before writing.';
  releaseStatus.className='status ok';
  ready();
 }catch(e){
  releaseStatus.textContent=e.message||'The official release could not be verified.';
  releaseStatus.className='status error';
  stable=null;ready();
 }
})();
button.addEventListener('click',async()=>{
 if(busy||!stable||!consent.checked||!identityConfirm.checked||!validIdentity(identityValue()))return;
 busy=true;installed.hidden=true;ready();
 message('Select an existing parent folder in Edge. Nothing will be overwritten.');
 try{
  // The writer invokes the folder picker immediately while the button's
  // user gesture is active. The network download begins ONLY after consent.
  const outcome=await globalThis.MoonDogFreshInstall.install({
   folderName:folder.value,version:stable.version,sha256:stable.sha256,
   identity:identityValue(),
   loadArchive:()=>fetchVerifiedSitePackage({
    siteUrl,version:stable.version,sha256:stable.sha256,
    fetchImpl:fetch,crypto,signal:undefined
   }),
   onProgress:text=>message(text)
  });
  if(outcome?.status!=='installed')throw Error('Installation was not verified.');
  if(!outcome.identitySaved)throw Error('Dealership identity could not be verified in the local Workspace.');
  message('INSTALLED AND VERIFIED — '+outcome.folderName+' · Stable '+outcome.version+'. Dealership identity saved locally; SAPR still required.',false,true);
  installed.hidden=false;
 }catch(error){
  message(error?.name==='AbortError'
   ?'No location selected; nothing was installed.'
   :String(error?.message||'Installation stopped. No working installation was claimed.'),true);
 }finally{busy=false;ready();}
});
ready();
