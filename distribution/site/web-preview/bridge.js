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
    const banner=document.createElement('div');banner.role='alert';
    banner.style.cssText='position:fixed;z-index:9999;bottom:0;left:0;right:0;padding:10px 15px;background:#5c290a;color:white;font:600 14px system-ui;text-align:center';
    banner.textContent='EXPERIMENTAL WEB PREVIEW — SYNTHETIC TEST DATA ONLY. Do not import real dealership files; external recovery is not yet production-verified.';
    document.body.append(banner);
  });
})();
