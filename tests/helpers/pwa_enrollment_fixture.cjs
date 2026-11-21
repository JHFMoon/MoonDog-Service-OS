'use strict';
const f=require('./pwa_install_fixture.cjs');
async function fixture({s=f.storage(),enrollment,workspaceId,empty=false,code='0001'}={}){
 const {createOperationalEnrollment}=await import('../../src/pwa/browser_workspace_enrollment.mjs');
 enrollment??=createOperationalEnrollment({confirmed:true,confirmedAt:'2026-11-21T12:00:00.000Z',store:{name:'Example Motors (SYNTHETIC TEST ONLY)',code,brand:'',timeZone:'America/Los_Angeles'}});
 const {createEmptyStore}=await import('../../src/pwa/opfs-store.mjs');
 const base=await createEmptyStore({storage:s,crypto:f.webcrypto,label:enrollment.store.name,enrollment,workspaceId});
 await f.install(s,base.identity.storeId);
 const manifest=(await f.plan()).files.find(x=>x.path==='INSTALLATION-MANIFEST.json').bytes;
 const args={storage:s,crypto:f.webcrypto,locks:f.locks,storeId:base.identity.storeId,version:'0.10.17',expectedManifestHash:await f.hash(manifest)};
 const ws=await(await base.store.getDirectoryHandle('System Files')).getDirectoryHandle('Workspace');
 if(!empty){
  await(await import('../../src/pwa/initialize_fresh_browser_workspace.mjs')).initializeFreshBrowserWorkspace(args);
  const report=await(await ws.getDirectoryHandle('data')).getFileHandle('RO-100.json',{create:true});report.bytes=f.bytes(JSON.stringify({ro:100,store:code,gross:code==='0001'?500:0}));
 }
 return {args,ws,base,enrollment};
}
async function inventory(root){let out={};async function walk(d,p=''){for await(const[n,h]of d.entries())if(h.kind==='directory')await walk(h,p+n+'/');else out[p+n]=Buffer.from(await(await h.getFile()).arrayBuffer()).toString('base64');}await walk(root);return out;}
module.exports={fixture,inventory};
