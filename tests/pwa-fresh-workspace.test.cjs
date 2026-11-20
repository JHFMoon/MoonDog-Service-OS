'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {storage,create,install,plan,hash,locks,webcrypto,randomUUID,bytes}=require('./helpers/pwa_install_fixture.cjs');
const api=()=>import('../src/pwa/initialize_fresh_browser_workspace.mjs');
async function fixture(){
 const s=storage(),base=await create(s);await install(s,base.identity.storeId);
 const manifest=(await plan()).files.find(f=>f.path==='INSTALLATION-MANIFEST.json').bytes;
 const ws=await(await base.store.getDirectoryHandle('System Files')).getDirectoryHandle('Workspace');
 return {base,ws,args:{storage:s,crypto:{subtle:webcrypto.subtle,randomUUID},locks,storeId:base.identity.storeId,version:'0.10.17',expectedManifestHash:await hash(manifest)}};
}
test('fresh browser store receives only the canonical blank adapter, durably readable after reopen',async()=>{
 const {args,ws}=await fixture();const result=await(await api()).initializeFreshBrowserWorkspace(args);
 assert.equal(result.blankSourceAdapterInitialized,true);
 const json=JSON.parse(await(await(await(await ws.getDirectoryHandle('data')).getFileHandle('settings.json')).getFile()).text());
 assert.deepEqual(json,{sourceAdapters:{schemaVersion:1}});
 const {inspectVerifiedBrowserInstallation}=await import('../src/pwa/install_verified_browser_store.mjs');
 assert.equal((await inspectVerifiedBrowserInstallation(args)).applicationVerified,true);
 await assert.rejects((await api()).initializeFreshBrowserWorkspace(args),/Existing Workspace data/);
});
test('existing manual settings, wrong authority and active tabs cannot be replaced by a fresh bootstrap',async()=>{
 const {args,ws}=await fixture(),a=await api();
 const h=await(await ws.getDirectoryHandle('data')).getFileHandle('settings.json',{create:true});h.bytes=bytes('synthetic manual configuration');
 await assert.rejects(a.initializeFreshBrowserWorkspace(args),/Existing Workspace data/);
 assert.equal(await(await h.getFile()).text(),'synthetic manual configuration');
 await assert.rejects(a.initializeFreshBrowserWorkspace({...args,expectedManifestHash:'0'.repeat(64)}),/trusted Stable authority/);
 await assert.rejects(a.initializeFreshBrowserWorkspace({...args,locks:{request:async(_n,_o,fn)=>fn(null)}}),/Another tab/);
});
test('public module matches canonical initializer and recovery skips the fresh-only bootstrap',()=>{
 assert.deepEqual(fs.readFileSync('src/pwa/initialize_fresh_browser_workspace.mjs'),fs.readFileSync('distribution/site/web-preview/modules/initialize_fresh_browser_workspace.mjs'));
 assert.match(fs.readFileSync('distribution/site/web-preview/setup.mjs','utf8'),/if\(!recovery\)await initializeFreshBrowserWorkspace/);
});
test('interrupted fresh initialization remains held and cannot expose a partial Workspace',async()=>{
 const {args,ws,base}=await fixture(),data=await ws.getDirectoryHandle('data');
 const get=data.getFileHandle.bind(data);
 data.getFileHandle=async(name,options)=>{
  const h=await get(name,options);
  if(name==='settings.json')h.createWritable=async()=>({write:async()=>{},close:async()=>{throw Error('synthetic quota refusal');},abort:async()=>{}});
  return h;
 };
 await assert.rejects((await api()).initializeFreshBrowserWorkspace(args),/quota refusal/);
 assert.match(await(await(await base.store.getFileHandle('MOONDOG-PWA-INSTALL-INCOMPLETE.json')).getFile()).text(),/fresh-browser-workspace/);
 const {inspectVerifiedBrowserInstallation}=await import('../src/pwa/install_verified_browser_store.mjs');
 await assert.rejects(inspectVerifiedBrowserInstallation(args),/remains incomplete/);
});
