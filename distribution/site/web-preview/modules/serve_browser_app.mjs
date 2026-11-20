import {readActiveCandidateAsset} from './browser_software_selection.mjs';
/**
 * Browser-owned MoonDog application file server. Can be used by a same-origin
 * service worker without publishing or uploading a store's private Workspace.
 * An untrusted URL hash alone is NOT proof of software authenticity; the
 * installer must first verify the immutable official Stable ZIP, and the
 * hosted application remains an experimental preview until independent trust
 * and recovery acceptance. This handler never reads Workspace contents.
 */
const BUCKET='MoonDog-PWA-v1',STORES='stores',INSTALL='INSTALLATION-MANIFEST.json';
const HOLD='MOONDOG-PWA-INSTALL-INCOMPLETE.json',SETUP='INCOMPLETE-SETUP.json';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const VERSION=/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/;
const PUBLIC=/^(?:index\.html|assets\/[A-Za-z0-9._-]+|vendor\/[A-Za-z0-9._-]+)$/;
const TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.txt':'text/plain; charset=utf-8'};
const fail=message=>{throw new Error(message);};
const digest=async(value,crypto)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),b=>b.toString(16).padStart(2,'0')).join('');
async function present(dir,name){try{await dir.getFileHandle(name,{create:false});return true;}catch(e){if(e?.name==='NotFoundError')return false;throw e;}}
async function read(dir,name){const f=await dir.getFileHandle(name,{create:false});return new Uint8Array(await (await f.getFile()).arrayBuffer());}
async function publicDir(store){return (await store.getDirectoryHandle('System Files',{create:false}));}
async function fileFor(store,rel){const parts=rel.split('/');let dir=await publicDir(store);for(const segment of parts.slice(0,-1))dir=await dir.getDirectoryHandle(segment,{create:false});return new Uint8Array(await(await (await dir.getFileHandle(parts.at(-1),{create:false})).getFile()).arrayBuffer());}
function inspectManifest(raw,version){
 let value;
 try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch(_){fail('Unreadable installed app manifest.');}
 if(value?.format!=='service-operations-dashboard-clean-install'||value?.formatVersion!==1||value.version!==version||
    value.applicationRoot!=='System Files'||value.workspaceRoot!=='System Files/Workspace'||
    value.workspaceProtectedFromUpdates!==true||!Array.isArray(value.files)||value.files.length<5||value.files.length>350)
   fail('Installed app manifest is invalid.');
 return value;
}
/** Returns verified public bytes; never a private Workspace file. */
export async function loadVerifiedPublicAsset({storage,crypto,storeId,expectedManifestHash,version,relativePath}={}){
 if(!UUID.test(storeId||'')||!SHA.test(expectedManifestHash||'')||!VERSION.test(version||'')||
    !PUBLIC.test(relativePath||'')||typeof storage?.getDirectory!=='function'||typeof crypto?.subtle?.digest!=='function')
   fail('Unverified browser app request refused.');
 // A selected candidate must be verified and served, or fail closed. Never
 // silently fall back to original while an active selector exists.
 const selected=await readActiveCandidateAsset({storage,crypto,storeId,expectedManifestHash,version,relativePath});
 if(selected)return selected;
 const root=await storage.getDirectory(),bucket=await root.getDirectoryHandle(BUCKET,{create:false});
 const stores=await bucket.getDirectoryHandle(STORES,{create:false}),store=await stores.getDirectoryHandle(storeId,{create:false});
 if(await present(store,HOLD)||await present(store,SETUP))fail('Incomplete installation is blocked.');
 const identity=JSON.parse(new TextDecoder().decode(await read(store,'STORE-IDENTITY.json')));
 if(identity?.format!=='moondog-pwa-local-store'||identity.storeId!==storeId||identity.version!==1)
   fail('Wrong or missing browser-store identity.');
 // Public website preview must not open or serve stores created for actual work.
 if(typeof identity.label!=='string'||!/^SYNTHETIC(?:\s|$)/i.test(identity.label))
   fail('Browser preview refuses non-synthetic stores.');
 const manifestRaw=await read(store,INSTALL);
 if(await digest(manifestRaw,crypto)!==expectedManifestHash)fail('Installed manifest does not match verified authority.');
 const manifest=inspectManifest(manifestRaw,version);
 const filename='System Files/'+relativePath;
 const entry=manifest.files.find(v=>v.path===filename);
 if(!entry||!Number.isSafeInteger(entry.size)||entry.size<0||entry.size>64*1024*1024||!SHA.test(entry.sha256||''))
   fail('Unapproved or oversized public runtime file.');
 const data=await fileFor(store,relativePath);
 if(data.byteLength!==entry.size||await digest(data,crypto)!==entry.sha256)
   fail('App file no longer matches verified install.');
 const ext=relativePath.slice(relativePath.lastIndexOf('.'));
 return Object.freeze({bytes:data,mime:TYPES[ext]||'application/octet-stream',verified:true});
}
/**
 * Minimal HTML overlay includes only our reviewed bootstrap. Application
 * bytes were checked above, but the returned HTML is MODIFIED and must never
 * be represented as a byte-identical official Stable asset.
 */
export function addPreviewBootstrap(html){
 if(typeof html!=='string'||!/<head>/i.test(html)||!/<\/head>/i.test(html)||
    /<base\b/i.test(html)||/<script[^>]*src=["']\.\.\/\.\.\/\.\.\/\.\.\/bridge\.js/i.test(html))
   fail('Application HTML cannot safely receive the preview bootstrap.');
 return html.replace(/<head>/i,'<head><script src="../../../../bridge.js"></script>');
}
/** Parse only a same-origin URL under the registered service-worker scope. */
export function parseBrowserAssetRoute(pathname,scopePath){
 if(typeof pathname!=='string'||typeof scopePath!=='string'||!scopePath.endsWith('/')||
    !pathname.startsWith(scopePath+'store/'))return null;
 const parts=pathname.slice((scopePath+'store/').length).split('/');
 if(parts.length<4)return null;
 const [storeId,expectedManifestHash,version,...rest]=parts;
 const relativePath=rest.join('/');
 if(!UUID.test(storeId)||!SHA.test(expectedManifestHash)||!VERSION.test(version)||!PUBLIC.test(relativePath))return null;
 return {storeId,expectedManifestHash,version,relativePath};
}