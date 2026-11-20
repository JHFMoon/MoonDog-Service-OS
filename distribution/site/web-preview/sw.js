// SYNTHETIC-ONLY MoonDog Web Preview. Never cache reports or Workspace bytes.
// Verified application files are read from private OPFS, SHA-checked per fetch.
import {loadVerifiedPublicAsset,addPreviewBootstrap,parseBrowserAssetRoute} from './modules/serve_browser_app.mjs';
const CACHE_PREFIX='moondog-synthetic-preview-shell-';
const CACHE=CACHE_PREFIX+'v6';
const PUBLIC_SHELL=Object.freeze([
 './index.html','./setup.mjs','./bridge.js','./style.css','./app.webmanifest','./icon.svg',
 './modules/opfs-store.mjs','./modules/install_verified_browser_store.mjs',
 './modules/connect_operational_workspace.mjs','./modules/serve_browser_app.mjs',
 './modules/verified_site_package.mjs',
 // Public executable module only: backup data is NEVER added to CacheStorage.
 './modules/synthetic_external_backup.mjs',
 '../fresh-install-writer.js'
]);
const shellUrls=PUBLIC_SHELL.map(item=>new URL(item,self.registration.scope).href);
const allowedShell=new Set(shellUrls);
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 // Stage a complete shell without reusing cached HTTP responses from the previous release.
 await cache.addAll(shellUrls.map(url=>new Request(url,{cache:'reload',redirect:'error'})));
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith(CACHE_PREFIX)&&name!==CACHE)await caches.delete(name);
 await self.clients.claim();
})()));
const NO_STORE={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url),scope=new URL(self.registration.scope);
 if(url.origin!==scope.origin)return;
 if(url.pathname.startsWith(scope.pathname+'store/')){
  event.respondWith((async()=>{
   if(event.request.method!=='GET')return new Response('Method not allowed',{status:405,headers:NO_STORE});
   const route=parseBrowserAssetRoute(url.pathname,scope.pathname);
   if(!route)return new Response('MoonDog preview path refused',{status:404,headers:NO_STORE});
   try{
    const item=await loadVerifiedPublicAsset({storage:self.navigator.storage,crypto:self.crypto,...route});
    if(route.relativePath==='index.html'){
     const html=addPreviewBootstrap(new TextDecoder('utf-8',{fatal:true}).decode(item.bytes));
     return new Response(html,{status:200,headers:{...NO_STORE,'Content-Type':item.mime}});
    }
    return new Response(item.bytes,{status:200,headers:{...NO_STORE,'Content-Type':item.mime}});
   }catch(_){
    return new Response('Verified preview application unavailable; return to setup.',{status:404,headers:NO_STORE});
   }
  })());return;
 }
 // The shell is immutable public code only. No private paths can enter cache.
 const isSetupNavigation=event.request.mode==='navigate'&&url.href===scope.href;
 const shellUrl=isSetupNavigation?new URL('./index.html',scope).href:url.href;
 if(event.request.method==='GET'&&allowedShell.has(shellUrl)){
  event.respondWith((async()=>{
   const cache=await caches.open(CACHE);
   return await cache.match(shellUrl) || await fetch(event.request);
  })());
 }
});
