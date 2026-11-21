'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {webcrypto,randomUUID}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const lib=()=>import('../src/pwa/serve_browser_app.mjs');
const stores=()=>import('../src/pwa/opfs-store.mjs');
const b=value=>new TextEncoder().encode(value);
const missing=()=>Object.assign(new Error('missing'),{name:'NotFoundError'});
class File{constructor(name,bytes=new Uint8Array()){this.kind='file';this.name=name;this.bytes=bytes;}
 async getFile(){const bytes=this.bytes.slice();return {arrayBuffer:async()=>bytes.buffer,text:async()=>new TextDecoder().decode(bytes)};}
 async createWritable(){let bytes=new Uint8Array();return {write:async x=>{bytes=typeof x==='string'?b(x):new Uint8Array(x)},close:async()=>{this.bytes=bytes},abort:async()=>{}};}}
class Dir{constructor(name){this.kind='directory';this.name=name;this.map=new Map();}
 async getDirectoryHandle(name,{create=false}={}){let value=this.map.get(name);if(!value&&create){value=new Dir(name);this.map.set(name,value)}if(!value)throw missing();if(value.kind!=='directory')throw Error('wrong type');return value;}
 async getFileHandle(name,{create=false}={}){let value=this.map.get(name);if(!value&&create){value=new File(name);this.map.set(name,value)}if(!value)throw missing();if(value.kind!=='file')throw Error('wrong type');return value;}
 async *entries(){yield* this.map.entries();}async removeEntry(name){if(!this.map.delete(name))throw missing();}}
const storage=()=>({root:new Dir('OPFS'),getDirectory(){return Promise.resolve(this.root)}});
const sha=async bytes=>Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
async function write(root,name,data){const parts=name.split('/');let dir=root;for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part,{create:true});const file=await dir.getFileHandle(parts.at(-1),{create:true});file.bytes=data;return file;}
const HTML='<!doctype html><html lang="en"><head><title>MoonDog synthetic app</title></head><body>Real layout loaded<script src="assets/app.js"></script></body></html>';
async function create(label='SYNTHETIC PREVIEW'){
 const s=storage(),{identity,store}=await (await stores()).createEmptyStore({storage:s,crypto:{randomUUID},label});
 const files=[['System Files/index.html',HTML],['System Files/assets/app.js','var sample=1;'],['System Files/assets/styles.css','body{color:black}'],['System Files/vendor/jszip.min.js','/* synthetic vendor */'],['00 - OPEN DASHBOARD.html','launcher']];
 const entries=[];for(const [name,contents] of files){const raw=b(contents);await write(store,name,raw);entries.push({path:name,size:raw.byteLength,sha256:await sha(raw)});}
 const manifest={format:'service-operations-dashboard-clean-install',formatVersion:1,version:'0.10.17',applicationRoot:'System Files',workspaceRoot:'System Files/Workspace',workspaceProtectedFromUpdates:true,files:entries};
 const raw=b(JSON.stringify(manifest));await write(store,'INSTALLATION-MANIFEST.json',raw);
 const args={storage:s,crypto:webcrypto,storeId:identity.storeId,expectedManifestHash:await sha(raw),version:'0.10.17'};
 return {args,store};
}
test('preview URL parses exact store id/hash/version and only public asset routes',async()=>{
 const {args}=await create(),{parseBrowserAssetRoute}=await lib();const base='/MoonDog-Service-OS/web-preview/';
 for(const name of ['index.html','assets/app.js','assets/styles.css','vendor/jszip.min.js']){
  const parsed=parseBrowserAssetRoute(base+'store/'+args.storeId+'/'+args.expectedManifestHash+'/0.10.17/'+name,base);
  assert.equal(parsed.relativePath,name);assert.equal(parsed.storeId,args.storeId);
 }
 for(const path of ['System Files/Workspace/data/report.json','assets/../evil.js','Workspace/a.json','unknown.js','assets/a%2fb.js']){
  assert.equal(parseBrowserAssetRoute(base+'store/'+args.storeId+'/'+args.expectedManifestHash+'/0.10.17/'+path,base),null);
 }
 assert.equal(parseBrowserAssetRoute('/other/store/'+args.storeId+'/'+args.expectedManifestHash+'/0.10.17/index.html',base),null);
});
test('verified app files are served from OPFS without entering the private Workspace',async()=>{
 const {args,store}=await create();const {loadVerifiedPublicAsset}=await lib();
 const out=await loadVerifiedPublicAsset({...args,relativePath:'index.html'});
 assert.equal(new TextDecoder().decode(out.bytes),HTML);assert.match(out.mime,/text\/html/);
 const data=await store.getDirectoryHandle('System Files').then(d=>d.getDirectoryHandle('Workspace')).then(d=>d.getDirectoryHandle('data'));
 const privateReport=await data.getFileHandle('customer-report.json',{create:true});privateReport.bytes=b('PRIVATE ORIGINAL — never read');
 const reloaded=await loadVerifiedPublicAsset({...args,relativePath:'assets/app.js'});
 assert.equal(new TextDecoder().decode(reloaded.bytes),'var sample=1;');
});
test('application-file tampering or wrong manifest hash never reaches the response',async()=>{
 const {args,store}=await create();const {loadVerifiedPublicAsset}=await lib();
 await assert.rejects(loadVerifiedPublicAsset({...args,expectedManifestHash:'0'.repeat(64),relativePath:'index.html'}),/does not match/);
 const system=await store.getDirectoryHandle('System Files');(await system.getFileHandle('index.html')).bytes=b('tampered');
 await assert.rejects(loadVerifiedPublicAsset({...args,relativePath:'index.html'}),/no longer matches/);
});
test('unlisted path and incomplete marker are refused before serving any public app file',async()=>{
 const {args,store}=await create();const {loadVerifiedPublicAsset}=await lib();
 await assert.rejects(loadVerifiedPublicAsset({...args,relativePath:'System Files/Workspace/data/report.json'}),/Unverified/);
 await write(store,'MOONDOG-PWA-INSTALL-INCOMPLETE.json',b('incomplete'));
 await assert.rejects(loadVerifiedPublicAsset({...args,relativePath:'assets/app.js'}),/Incomplete installation/);
});
test('HTML bootstrap is reviewed insertion only; there is no unverified asset rewrite',async()=>{
 const {addPreviewBootstrap}=await lib(),out=addPreviewBootstrap(HTML);
 assert.equal(out.includes('src="../../../../bridge.js"'),true);
 assert.equal(out.replace('<script src="../../../../bridge.js"></script>',''),HTML);
 assert.throws(()=>addPreviewBootstrap('<head><base href="elsewhere"></head>'),/cannot safely/);
});
test('bridge routes the Stable and newer Workspace picker modes, and refuses unrelated pickers',async()=>{
 const filename=path.join(__dirname,'../distribution/site/web-preview/bridge.js');
 const src=pathToFileURL(filename);
 const storePath=new URL(`./store/${randomUUID()}/${'0'.repeat(64)}/0.10.17/index.html`,src);
 const window={addEventListener(){}};
 const document={currentScript:{src},addEventListener(){}};
 const runBridge=new Function('window','document','location','navigator',fs.readFileSync(filename,'utf8'));
 runBridge(window,document,storePath,{});
 for(const mode of ['read','readwrite']){
  await assert.rejects(window.showDirectoryPicker({id:'moondog-operations',mode}),/browser-private storage or per-store locking is unavailable/);
  await assert.rejects(window.showDirectoryPicker({id:'moondog-new-store',mode}),/No Windows folder was selected/);
 }
 await assert.rejects(window.showDirectoryPicker({id:'moondog-operations'}),/No Windows folder was selected/);
});
test('static PWA source mirrors reviewed canonical modules byte-for-byte',()=>{
 const root=path.join(__dirname,'..');for(const name of ['opfs-store.mjs','install_verified_browser_store.mjs','connect_operational_workspace.mjs','serve_browser_app.mjs','verified_site_package.mjs','browser_software_candidates.mjs','browser_software_selection.mjs','verified_beta_transport.mjs']){
  const canonical=fs.readFileSync(path.join(root,'src/pwa',name));
  const published=fs.readFileSync(path.join(root,'distribution/site/web-preview/modules',name));
  assert.deepEqual(published,canonical,`${name} must not silently fork public installer authority`);
 }
});
test('preview is separate from production site and refuses real data at the entrypoint',()=>{
 const root=path.join(__dirname,'..','distribution/site/web-preview');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const js=fs.readFileSync(path.join(root,'setup.mjs'),'utf8');
 const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
 assert.match(html,/synthetic testing only/i);assert.match(html,/do not import any real dealership files/i);
 assert.match(js,/createEmptyStore/);assert.match(js,/inspectVerifiedZip/);assert.match(js,/MOONDOG|SYNTHETIC/);
 assert.match(js,/updateViaCache:'none'/);
 assert.match(js,/fetchVerifiedSitePackage/);assert.match(js,/probeSitePackage/);
 assert.match(html,/id="installFromWeb"[^>]*disabled/);
 assert.match(sw,/verified_site_package\.mjs/);
 assert.match(sw,/['"]\.\/modules\/synthetic_external_backup\.mjs['"]/);
 assert.match(sw,/const CACHE=CACHE_PREFIX\+'v13'/);
 assert.doesNotMatch(sw,/PUBLIC_SHELL[\s\S]*?moondog-0\.10\.17\.zip/);
 assert.match(sw,/parseBrowserAssetRoute/);
 assert.match(sw,/browser_software_candidates\.mjs/);
 assert.match(sw,/browser_software_selection\.mjs/);
 assert.match(sw,/verified_beta_transport\.mjs/);assert.match(sw,/const PUBLIC_SHELL/);
 assert.doesNotMatch(sw,/cache\.put\(|PUBLIC_SHELL[\s\S]*?Workspace\/data/);
 assert.doesNotMatch(js,/showDirectoryPicker|showSaveFilePicker/);
 const m=JSON.parse(fs.readFileSync(path.join(root,'app.webmanifest'),'utf8'));
 assert.equal(m.id,'/MoonDog-Service-OS/web-preview/','Native app identity must not alias the origin root or web lab');
 assert.equal(m.display,'standalone');assert.match(m.start_url,/index\.html/);
});


test('public preview refuses non-synthetic store even with valid official app hash',async()=>{
 const {args,store}=await create('Actual dealership');
 const {loadVerifiedPublicAsset}=await lib();
 await assert.rejects(loadVerifiedPublicAsset({...args,relativePath:'index.html'}),/refuses non-synthetic/);
 const system=await store.getDirectoryHandle('System Files');
 const workspace=await system.getDirectoryHandle('Workspace');
 const data=await workspace.getDirectoryHandle('data');
 await write(data,'original.txt',b('ORIGINAL TEST ONLY'));
 assert.equal(new TextDecoder().decode((await data.getFileHandle('original.txt')).bytes),'ORIGINAL TEST ONLY');
 const setup=fs.readFileSync(path.join(__dirname,'../distribution/site/web-preview/setup.mjs'),'utf8');
 assert.match(setup,/check\.identity\.label/);
 assert.match(setup,/SYNTHETIC/);
});


test('installing an updated preview shell leaves the current offline cache untouched until activation', async () => {
 const vm = require('node:vm');
 const worker = fs.readFileSync(path.join(__dirname,'../distribution/site/web-preview/sw.js'),'utf8');
 const currentCache = 'moondog-synthetic-preview-shell-v5';
 const cacheNames = new Set([currentCache]);
 let failStaging = true;
 let staged;
 let waiting = false;
 const handlers = {};
 const self = {
  registration:{scope:'https://jhfmoon.github.io/MoonDog-Service-OS/web-preview/'},
  addEventListener(type, handler){handlers[type]=handler;},
  skipWaiting(){waiting=true;},
  clients:{claim(){}}
 };
 const caches = {
  async open(name){
   cacheNames.add(name);
   return {async addAll(requests){
    if(failStaging)throw new Error('Offline shell asset unavailable');
    staged={name, requests};
   }};
  },
  async keys(){return Array.from(cacheNames);},
  async delete(name){return cacheNames.delete(name);}
 };
 // The worker's route imports are irrelevant to its install and activate events.
 vm.runInNewContext(worker.replace(/^import .*;$/m,''), {self, caches, URL, Request});
 async function dispatch(type){
  let work;
  handlers[type]({waitUntil(promise){work=promise;}});
  await work;
 }
 await assert.rejects(dispatch('install'),/Offline shell asset unavailable/);
 assert.equal(cacheNames.has(currentCache),true);
 assert.equal(waiting,false);
 failStaging=false;
 await dispatch('install');
 assert.notEqual(staged.name,currentCache,'installation must never rewrite the currently active shell');
 assert.equal(cacheNames.has(currentCache),true);
 assert.equal(waiting,true);
 assert.ok(staged.requests.every(request=>request.cache==='reload' && request.redirect==='error'));
 await dispatch('activate');
 assert.deepEqual(Array.from(cacheNames),[staged.name]);
});


test('synthetic Beta update UI requires explicit verified stage, rollback and interrupted-selection recovery',()=>{
 const root=path.join(__dirname,'../distribution/site/web-preview');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const setup=fs.readFileSync(path.join(root,'setup.mjs'),'utf8');
 const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
 for(const id of ['checkBeta','installBeta','rollbackBeta','recoverOriginal']){
  assert.match(html,new RegExp('id="'+id+'"[^>]*disabled'));
  assert.match(setup,new RegExp("\\$\\('"+id+"'\\)\\.addEventListener"));
 }
 assert.match(html,/synthetic test Workspaces only/i);
 assert.match(setup,/fetchVerifiedPinnedBeta/);
 assert.match(setup,/stageVerifiedBetaBrowserSoftware/);
 assert.match(setup,/activateStagedBrowserSoftware/);
 assert.match(setup,/rollbackBrowserSoftware/);
 assert.match(setup,/recoverOriginalBrowserSoftware/);
 assert.match(setup,/verifyActiveBetaShell/);
 assert.match(setup,/MOONDOG_PREVIEW_SHELL_PROBE/);
 assert.match(sw,/MOONDOG_PREVIEW_SHELL_PROOF/);
 assert.match(setup,/selection=await inspectActiveBrowserSoftware/);
 assert.match(setup,/if\(selection\&\&\(selection.originalVersion/);
 assert.match(sw,/const CACHE=CACHE_PREFIX\+'v13'/);
 assert.match(sw,/verified_beta_transport\.mjs/);
 assert.doesNotMatch(sw,/cache\.put\(|Workspace\/data/);
 assert.doesNotMatch(setup,/showDirectoryPicker|showSaveFilePicker|cache\.put/);
});


test('active preview worker reports only the reviewed shell v13 in explicit software-update handshake',()=>{
 const vm=require('node:vm');
 const src=fs.readFileSync(path.join(__dirname,'../distribution/site/web-preview/sw.js'),'utf8');
 const handlers={};const received=[];
 const self={registration:{scope:'https://jhfmoon.github.io/MoonDog-Service-OS/web-preview/'},
  addEventListener(name,fn){handlers[name]=fn;}};
 vm.runInNewContext(src.replace(/^import .*;$/m,''),{self,caches:{},URL,Request});
 assert.equal(typeof handlers.message,'function');
 const port={postMessage(value){received.push({type:value.type,cache:value.cache});}};
 handlers.message({data:{type:'UNRELATED'},ports:[port]});
 assert.equal(received.length,0,'Unrelated messages must not advertise update authority');
 handlers.message({data:{type:'MOONDOG_PREVIEW_SHELL_PROBE'},ports:[port]});
 assert.deepEqual(received,[{type:'MOONDOG_PREVIEW_SHELL_PROOF',
  cache:'moondog-synthetic-preview-shell-v13'}]);
});

test('browser startup waits for canonical readiness, connects once, and leaves refusals under user control',()=>{
 const vm=require('node:vm');
 const handlers={};let observe,disconnected=false,clicks=0;
 const button={disabled:true,hidden:false,click(){clicks++;}};
 const watch={textContent:''};
 const setupNote={textContent:'Open Service Operations Dashboard: 00 - OPEN DASHBOARD.html · Add reports: 01 - DROP REPORTS HERE'};
 const setupRoot={querySelectorAll(){return [setupNote];}};
 const status={textContent:'No reusable saved folder was found. Choose the Service Operations Dashboard working folder.'};
 const make=()=>({style:{},setAttribute(){},append(){}});
 const document={currentScript:{src:'https://jhfmoon.github.io/MoonDog-Service-OS/web-preview/bridge.js'},
  addEventListener(name,fn){handlers[name]=fn;},createElement:make,head:{append(){}},body:{style:{},append(){}},
  getElementById(id){return id==='connectButton'?button:id==='folderWatchStatus'?watch:id==='status'?status:id==='view-setup'?setupRoot:null;}};
 const route=`https://jhfmoon.github.io/MoonDog-Service-OS/web-preview/store/${randomUUID()}/${'0'.repeat(64)}/0.10.17/index.html`;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../distribution/site/web-preview/bridge.js'),'utf8'),{
  document,window:{addEventListener(){}},location:new URL(route),navigator:{},URL,
  MutationObserver:class{constructor(fn){observe=fn;}observe(){}disconnect(){disconnected=true;}}
 });
 handlers.DOMContentLoaded();assert.match(setupNote.textContent,/Complete setup below/);assert.doesNotMatch(setupNote.textContent,/00 - OPEN/);assert.equal(clicks,0,'Never connect before the canonical handler is ready');
 button.disabled=false;observe();assert.equal(clicks,1);
 observe();observe();assert.equal(clicks,1,'A refused lock or failed connect must not trigger automatic retries');
 assert.equal(button.hidden,false,'Keep recovery available until the real Workspace is watching');
 watch.textContent='REPORT INBOX WATCHING · verified';observe();
 assert.equal(button.hidden,true);assert.equal(disconnected,true);
 assert.equal(status.textContent,'Browser-private Workspace connected and verified.');
});

test('new entry waits for replacement worker control and shell proof before accepting a saved Workspace',async()=>{
 const vm=require('node:vm');
 const source=fs.readFileSync(path.join(__dirname,'../distribution/site/web-preview/setup.mjs'),'utf8');
 const start=source.indexOf('async function registerPreviewWorker(){'),end=source.indexOf('async function offerExistingPreview(){',start);
 const old={state:'activated'},listeners={},controlListeners={};
 const next={state:'installing',addEventListener(type,fn){listeners[type]=fn;},removeEventListener(type){delete listeners[type];}};
 const workers={controller:old,register:async()=>({active:old,installing:next}),
  addEventListener(type,fn){controlListeners[type]=fn;},removeEventListener(type){delete controlListeners[type];}};
 let proof=0,finished=false;
 const register=vm.runInNewContext(source.slice(start,end)+';registerPreviewWorker',{
  navigator:{serviceWorker:workers},setTimeout:()=>1,clearTimeout(){},
  verifyActiveBetaShell:async()=>{assert.equal(workers.controller,next);proof++;}
 });
 const pending=register().then(()=>{finished=true;});
 await new Promise(setImmediate);assert.equal(finished,false,'An old active worker must not satisfy new shell readiness');
 next.state='activated';listeners.statechange();
 await new Promise(setImmediate);assert.equal(finished,false,'Activation alone must not authorize the new app');
 workers.controller=next;controlListeners.controllerchange();await pending;
 assert.equal(proof,1);assert.equal(finished,true);
});

test('versioned entry script and native manifest bypass old shell URLs and remain available offline',()=>{
 const vm=require('node:vm'),root=path.join(__dirname,'../distribution/site/web-preview');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
 const context={self:{registration:{scope:'https://jhfmoon.github.io/MoonDog-Service-OS/web-preview/'},addEventListener(){}},URL};
 vm.runInNewContext(sw.replace(/^import .*;$/m,'')+';globalThis.shell=PUBLIC_SHELL',context);
 const version=sw.match(/const CACHE=CACHE_PREFIX\+'v([0-9]+)'/)[1];
 const refs=[html.match(/<script type="module" src="([^"]+)"/)[1],html.match(/rel="manifest" href="([^"]+)"/)[1]];
 for(const ref of refs){assert.equal(new URL(ref,context.self.registration.scope).searchParams.get('v'),version);assert.ok(context.shell.includes(ref),'Exact entry URL must be staged for offline launch: '+ref);}
});


test('primary website install is never blocked by an unanswered native PWA prompt',async()=>{
 const vm=require('node:vm');
 const source=fs.readFileSync(path.join(__dirname,'../distribution/site/web-preview/setup.mjs'),'utf8');
 const start=source.indexOf("$('installFromWeb').addEventListener('click',");
 const end=source.indexOf("$('prepareBackup').addEventListener(",start);
 assert.ok(start>0&&end>start,'Production website install handler must be present');
 assert.match(source,/\$\('installEdge'\)\.addEventListener\('click',async\(\)=>\{/,
  'Native Edge install must remain a separate, opt-in action');
 let handler=null,installCalls=0,nativePromptCalls=0;
 const never=new Promise(()=>{});
 const installPrompt={prompt(){nativePromptCalls++;return never;},userChoice:never};
 const readSiteBytes=()=>new Uint8Array([1]);
 const installPreview=async reader=>{
  assert.strictEqual(reader,readSiteBytes);
  installCalls++;
 };
 const $=id=>({addEventListener(type,fn){if(id==='installFromWeb'&&type==='click')handler=fn;}});
 vm.runInNewContext(source.slice(start,end),{$,installPrompt,readSiteBytes,installPreview,websiteAvailable:true});
 assert.equal(typeof handler,'function');
 const completed=await Promise.race([
  Promise.resolve(handler()).then(()=>true),
  new Promise(resolve=>setImmediate(()=>resolve(false)))
 ]);
 assert.equal(completed,true,'Primary install must not wait for an unanswered browser installation prompt');
 assert.equal(installCalls,1,'The production verified installation must start immediately');
 assert.equal(nativePromptCalls,0,'The main installation must not open the separate OS prompt');
});
