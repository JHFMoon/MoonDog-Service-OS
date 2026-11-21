'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const f=require('./helpers/pwa_install_fixture.cjs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../distribution/site/web-preview/setup.mjs'),'utf8');
// Execute the shipped installer, including its capacity gate, rather than a
// duplicate of the arithmetic. File handles and durable software writes use
// the existing installation fixture; only browser chrome/transport is stubbed.
async function harness({quota=10**9,recoveryBytes=0,recovery=false}={}){
 const storage=f.storage(),plan=await f.plan(),saved=new Map(),elements=new Map(),messages=[];
 storage.estimate=async()=>({quota,usage:0});storage.persist=async()=>false;
 const nodes=id=>{if(!elements.has(id))elements.set(id,{checked:true,disabled:false});return elements.get(id);};
 const {createEmptyStore}=await import('../src/pwa/opfs-store.mjs');
 const {installVerifiedBrowserStore}=await import('../src/pwa/install_verified_browser_store.mjs');
 const {initializeFreshBrowserWorkspace}=await import('../src/pwa/initialize_fresh_browser_workspace.mjs');
 let allocations=0,restores=0;
 const context=vm.createContext({
  selectedWorkspaceMode:()=>"synthetic",navigator:{storage,locks:f.locks,serviceWorker:{}},crypto:f.webcrypto,release:{version:'0.10.17',sha256:await f.hash(f.zip)},
  MoonDogFreshInstall:{inspectVerifiedZip:async()=>plan},busy:false,activePreview:null,offlineShellError:null,websiteAvailable:true,
  $:nodes,status:message=>messages.push(message),shellReady:Promise.resolve(),
  localStorage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)},PREVIOUS:'test-pointer',
  sha:bytes=>f.hash(bytes),showPreview:pointer=>{context.activePreview=pointer;},enterApplication(){},
  createEmptyStore:async args=>{allocations++;return createEmptyStore(args);},installVerifiedBrowserStore,initializeFreshBrowserWorkspace,
 });
 const capacity=source.slice(source.indexOf('async function requireBrowserCapacity('),source.indexOf('async function readSiteBytes('));
 vm.runInContext(capacity+'\nglobalThis.runInstall=installPreview;',context);
 const restore=recovery?{sourceStoreId:'12345678-1234-4234-8234-123456789012',backup:{workspaceId:'22345678-1234-4234-8234-123456789012'},api:{
  inspectBrowserExternalBackup:async()=>({mode:'synthetic',bytes:recoveryBytes,workspaceId:'22345678-1234-4234-8234-123456789012'}),
  restoreBrowserExternalBackup:async()=>{restores++;}
 }}:undefined;
 await context.runInstall(async()=>f.zip,restore);
 return {allocations,restores,messages,saved,softwareBytes:plan.files.reduce((n,f)=>n+f.bytes.byteLength,0),storage};
}
test('website installer budgets verified plan bytes and completes a fresh verified installation',async()=>{
 const result=await harness();assert.equal(result.allocations,1);assert.equal(result.saved.size,1);
 assert.match(result.messages.at(-1),/verified SYNTHETIC|Verified SYNTHETIC/);
});
test('insufficient browser quota refuses before allocation or saved-pointer replacement',async()=>{
 const result=await harness({quota:1});assert.equal(result.allocations,0);assert.equal(result.saved.size,0);
 assert.match(result.messages.at(-1),/insufficient space/);
});
test('storage-loss recovery includes verified backup bytes in preflight before allocating replacement',async()=>{
 const result=await harness({quota:100000,recovery:true,recoveryBytes:100000});
 assert.equal(result.allocations,0);assert.equal(result.restores,0);assert.equal(result.saved.size,0);
 assert.match(result.messages.at(-1),/insufficient space/);
 const enough=await harness({recovery:true,recoveryBytes:100000});assert.equal(enough.allocations,1);assert.equal(enough.restores,1);assert.equal(enough.saved.size,1);
});
