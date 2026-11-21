/**
 * EXPERIMENTAL web-only adapter: serves the exact verified OPFS store to the
 * EXISTING MoonDog connection flow, without choosing a Windows directory.
 * Does not bypass Edge's protected-folder rules or enable real-data use.
 */
(function(){
  'use strict';
  const thisScript=document.currentScript;
  const base=new URL('./',thisScript.src);
  const prefix=base.pathname+'store/';
  const pathname=decodeURI(location.pathname);
  if(!pathname.startsWith(prefix))throw Error('Invalid MoonDog preview origin.');
  const [storeId,expectedManifestHash,version]=pathname.slice(prefix.length).split('/');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storeId||'')||
     !/^[a-f0-9]{64}$/.test(expectedManifestHash||'')||
     !/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(version||''))throw Error('Invalid preview store route.');
  let active=null,connecting=null;
  const moduleUrl=new URL('./modules/connect_operational_workspace.mjs',base);
  // Only the app's intended connect action uses this bridge. Every other
  // native picker is blocked, never silently pointed at another store.
  window.showDirectoryPicker=async function(options={}){
    // Stable 0.10.17 selects in read mode and requests write authority later.
    if(options.id!=='moondog-operations'||!['read','readwrite'].includes(options.mode))
      throw Error('This browser preview supports only its verified local Workspace. No Windows folder was selected.');
    if(active)return active.handle;
    if(connecting)return connecting;
    connecting=(async()=>{
      const {openVerifiedOperationalWorkspace}=await import(moduleUrl.href);
      if(!navigator.storage?.getDirectory||!navigator.locks?.request)
        throw Error('Edge browser-private storage or per-store locking is unavailable.');
      active=await openVerifiedOperationalWorkspace({storage:navigator.storage,crypto,locks:navigator.locks,
        storeId,version,expectedManifestHash});
      return active.handle;
    })();
    try{return await connecting;}finally{connecting=null;}
  };
  window.addEventListener('pagehide',()=>{if(active)void active.close();active=null;},{once:true});
  document.addEventListener('DOMContentLoaded',()=>{
    const manifest=document.createElement('link');manifest.rel='manifest';
    manifest.href=new URL('./app.webmanifest',base).href;document.head.append(manifest);
    const bar=document.createElement('div');bar.setAttribute('aria-label','MoonDog app controls');
    bar.style.cssText='position:fixed;z-index:9999;bottom:0;left:0;right:0;padding:8px 15px;background:#153847;color:white;font:600 13px system-ui;display:flex;align-items:center;justify-content:space-between;gap:15px';
    const label=document.createElement('span');label.textContent='MoonDog · Synthetic pilot · Test files only';
    const settings=document.createElement('a');settings.id='browserAppSettings';
    settings.href=new URL('./index.html?manage=1',base).href;
    settings.textContent='App settings · Backup · Updates';settings.style.color='white';
    bar.append(label,settings);document.body.append(bar);
    document.body.style.paddingBottom='48px';
    // This browser installation has its own verified software authority. Do
    // not offer file:// updater controls against the OPFS application handle.
    const browserStyle=document.createElement('style');
    browserStyle.textContent='#connectionHelp{display:none!important}#settings-update>:not(h2):not(.browser-software-link){display:none!important}';
    document.head.append(browserStyle);
    let attempted=false;
    function connectWhenReady(){
      const updates=document.getElementById('settings-update');
      if(updates&&!document.getElementById('browserSoftwareSettings')){
        const link=document.createElement('a');link.id='browserSoftwareSettings';link.className='browser-software-link';
        link.href=settings.href;link.textContent='Open verified browser updates, rollback and external recovery';updates.append(link);
      }
      const button=document.getElementById('connectButton');
      if(!button||button.disabled)return;
      const watching=document.getElementById('folderWatchStatus')?.textContent||'';
      if(watching.startsWith('REPORT INBOX WATCHING')){
        button.hidden=true;observer.disconnect();return;
      }
      // Invoke the canonical connection handler once. It still verifies the
      // version-bound store, takes the exclusive lock and performs readback.
      // Do not repeat on a refused lock, recovery hold or failed connection.
      if(!attempted&&!active&&!connecting){attempted=true;button.click();}
    }
    const observer=new MutationObserver(connectWhenReady);
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled']});
    connectWhenReady();
  });
})();
