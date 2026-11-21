'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const f=require('./helpers/pwa_install_fixture.cjs');
const source=fs.readFileSync(path.join(__dirname,'../distribution/site/web-preview/setup.mjs'),'utf8');
const PROFILE={name:'Example Motors (SYNTHETIC TEST ONLY)',code:'0001',brand:'',timeZone:'America/Los_Angeles'};
const VERSION='0.10.18-beta.456',COMMIT='a'.repeat(40),SITE='https://jhfmoon.github.io/MoonDog-Service-OS/';
async function stablePlan(){
 const plan=await f.plan();
 for(const name of ['jszip.min.js','pdf.min.js','pdf.worker.min.js'])plan.files.push({path:'System Files/vendor/'+name,bytes:f.bytes('SYNTHETIC vendor '+name)});
 const manifest=plan.files.find(x=>x.path==='INSTALLATION-MANIFEST.json'),value=JSON.parse(new TextDecoder().decode(manifest.bytes));
 value.files=[];for(const file of plan.files)if(file!==manifest)value.files.push({path:file.path,size:file.bytes.length,sha256:await f.hash(file.bytes)});
 manifest.bytes=f.bytes(JSON.stringify(value));return plan;
}
async function transport(wrongHash=false){
 const names=['index.html','assets/app.js','assets/styles.css','assets/freshness.js','vendor/xlsx.full.min.js'],files=[];
 for(const name of names){const bytes=f.bytes('SYNTHETIC verified Beta '+name);files.push({path:name,action:'put',sha256:await f.hash(bytes),contentBase64:Buffer.from(bytes).toString('base64')});}
 const pkg=f.bytes(JSON.stringify({formatVersion:1,version:VERSION,approvedFiles:names,files})),prefix='https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/'+COMMIT+'/';
 const manifest=f.bytes(JSON.stringify({stable:{version:'0.10.17'},beta:{version:VERSION,sha256:wrongHash?'0'.repeat(64):await f.hash(pkg),migrationRequired:false,minimumCompatibleVersion:'0.10.9',packageUrl:'https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/updates/packages/moondog-'+VERSION+'.json'}}));
 const responses=new Map([[SITE+'site-version.json',f.bytes(JSON.stringify({mainSha:COMMIT}))],[prefix+'updates/manifest.json',manifest],[prefix+'updates/packages/moondog-'+VERSION+'.json',pkg]]),calls=[];
 return {calls,async fetch(url,options){
  assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');calls.push(url);
  const bytes=responses.get(url);if(!bytes)throw Error('Unexpected synthetic transport request');
  return {ok:true,url,type:'cors',redirected:false,headers:{get:()=>String(bytes.length)},body:{getReader(){let sent=false;return {async read(){if(sent)return {done:true};sent=true;return {done:false,value:bytes};},async cancel(){}};}}};
 }};
}
async function harness({profile=PROFILE,consent=true,quota=10**9,wrongHash=false}={}){
 const storage=f.storage(),plan=await stablePlan(),network=await transport(wrongHash),nodes=new Map(),saved=new Map(),messages=[];
 storage.estimate=async()=>({quota,usage:0});storage.persist=async()=>false;
 const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,handlers:{},addEventListener(type,fn){this.handlers[type]=fn;}});return nodes.get(id);};
 $('workspaceMode').value='operational';$('consent').checked=consent;
 for(const[key,id]of Object.entries({name:'enrollmentName',code:'enrollmentCode',brand:'enrollmentBrand',timeZone:'enrollmentTimeZone'}))$(id).value=profile[key];
 const context=vm.createContext({$,busy:false,activePreview:null,verifiedBetaOffer:null,open:$('openApp'),offlineShellError:null,websiteAvailable:true,
  navigator:{storage,locks:f.locks,serviceWorker:{}},crypto:f.webcrypto,release:{version:'0.10.17',sha256:await f.hash(f.zip)},
  MoonDogFreshInstall:{inspectVerifiedZip:async()=>plan},localStorage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)},PREVIOUS:'pointer',
  shellReady:Promise.resolve(),fetch:network.fetch,sha:f.hash,status:message=>messages.push(message),enterApplication(){},
  ...await import('../src/pwa/browser_workspace_enrollment.mjs'),...await import('../src/pwa/opfs-store.mjs'),
  ...await import('../src/pwa/install_verified_browser_store.mjs'),...await import('../src/pwa/initialize_fresh_browser_workspace.mjs'),
  ...await import('../src/pwa/verified_beta_transport.mjs'),...await import('../src/pwa/browser_software_candidates.mjs'),...await import('../src/pwa/browser_software_selection.mjs')});
 vm.runInContext(source.slice(source.indexOf('function selectedWorkspaceMode('),source.indexOf('async function registerPreviewWorker(')),context);
 vm.runInContext(source.slice(source.indexOf('async function requireBrowserCapacity('),source.indexOf('async function readSiteBytes('))+';globalThis.runInstall=installPreview;',context);
 return {$,context,storage,network,saved,messages,plan,async install(recovery){await context.runInstall(async()=>f.zip,recovery);},pointer(){return JSON.parse(saved.get('pointer')||'null');}};
}
test('explicit dealership confirmation installs verified Beta, retains original authority and seeds no invented reports',async()=>{
 const h=await harness();await h.install();const pointer=h.pointer();assert.ok(pointer,h.messages.at(-1));assert.equal(pointer.version,'0.10.17');assert.equal(pointer.mode,'operational');
 assert.match(h.$('openApp').href,/0\.10\.18-beta\.456/);
 const {openExistingStore}=await import('../src/pwa/opfs-store.mjs'),{identity,store}=await openExistingStore({storage:h.storage,storeId:pointer.storeId});
 assert.deepEqual(identity.enrollment.store,PROFILE);
 const data=await(await store.getDirectoryHandle('System Files')).getDirectoryHandle('Workspace').then(x=>x.getDirectoryHandle('data'));
 assert.deepEqual([...data.map.keys()],['settings.json']);assert.equal(JSON.parse(await(await(await data.getFileHandle('settings.json')).getFile()).text()).store.code,'0001');
 const selection=await(await import('../src/pwa/browser_software_selection.mjs')).inspectActiveBrowserSoftware({storage:h.storage,crypto:f.webcrypto,storeId:pointer.storeId});assert.equal(selection.version,VERSION);
});
test('missing confirmation, incomplete store configuration and failed Beta hash never create a saved pointer',async()=>{
 for(const options of [{consent:false},{profile:{...PROFILE,code:''}},{wrongHash:true}]){
  const h=await harness(options);await h.install();assert.equal(h.pointer(),null);assert.equal(h.storage.root.map.size,0);
  if(!options.wrongHash)assert.equal(h.network.calls.length,0);
  else assert.match(h.messages.at(-1),/SHA-256 mismatch/);
 }
});
test('changing Workspace type clears prior synthetic consent',async()=>{
 const h=await harness();h.$('workspaceMode').handlers.change();assert.equal(h.$('consent').checked,false);await h.install();assert.equal(h.network.calls.length,0);assert.equal(h.pointer(),null);
});
test('enrolled external recovery confirms the matching profile and restores into a fresh verified Beta Workspace',async()=>{
 const a=await harness();await a.install();const original=a.pointer(),api=await import('../src/pwa/synthetic_external_backup.mjs');
 const backup=await api.createBrowserExternalBackup({storage:a.storage,crypto:f.webcrypto,locks:f.locks,storeId:original.storeId,version:original.version,expectedManifestHash:original.manifestHash});
 const recovery={api,backup,sourceStoreId:backup.storeId,checksum:backup.sha256},b=await harness();await b.install(recovery);const restored=b.pointer();assert.ok(restored,b.messages.at(-1));
 assert.notEqual(restored.storeId,original.storeId);assert.equal(restored.workspaceId,original.workspaceId);assert.match(b.$('openApp').href,/0\.10\.18-beta\.456/);
 const wrong=await harness({profile:{...PROFILE,code:'0002'}});await wrong.install(recovery);assert.equal(wrong.pointer(),null);assert.equal(wrong.storage.root.map.size,0);assert.equal(wrong.network.calls.length,0);assert.match(wrong.messages.at(-1),/different dealership/);
});
