'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,inventory}=require('./helpers/pwa_enrollment_fixture.cjs');
const f=require('./helpers/pwa_install_fixture.cjs');
function locks(){const held=new Set();return {async request(name,options,run){if(held.has(name))return run(null);held.add(name);try{return await run({});}finally{held.delete(name);}}};}
test('enrolled runtime verifies public binaries, holds an exclusive store lock and exposes only Workspace mutations',async()=>{
 const {args,base,ws}=await fixture(),{openVerifiedOperationalWorkspace}=await import('../src/pwa/connect_operational_workspace.mjs'),exclusive=locks();
 const session=await openVerifiedOperationalWorkspace({...args,locks:exclusive});
 try{
  assert.equal(session.workspaceMode,'operational');assert.equal(session.storeProfile.code,'0001');assert.equal(session.productionReady,false);
  const original=await inventory(base.store),system=await session.handle.getDirectoryHandle('System Files');
  await assert.rejects((await system.getFileHandle('index.html')).createWritable(),/read-only/);
  await assert.rejects(session.handle.removeEntry('STORE-IDENTITY.json'),/Cannot remove/);
  await assert.rejects(openVerifiedOperationalWorkspace({...args,locks:exclusive}),/Another MoonDog tab/);
  const data=await(await system.getDirectoryHandle('Workspace')).getDirectoryHandle('data'),edit=await data.getFileHandle('manual.txt',{create:true}),writer=await edit.createWritable();await writer.write('SYNTHETIC manual edit');await writer.close();
  assert.equal(await(await(await(await ws.getDirectoryHandle('data')).getFileHandle('manual.txt')).getFile()).text(),'SYNTHETIC manual edit');
  const after=await inventory(base.store);delete after['System Files/Workspace/data/manual.txt'];assert.deepEqual(after,original);
 }finally{await session.close();}
 await assert.rejects(session.handle.getDirectoryHandle('System Files'),/session is closed/);
 const next=await openVerifiedOperationalWorkspace({...args,locks:exclusive});await next.close();
});
test('enrollment cannot authorize modified public software or expose any private Workspace route',async()=>{
 const {args,base}=await fixture(),{loadVerifiedPublicAsset}=await import('../src/pwa/serve_browser_app.mjs');
 assert.equal(new TextDecoder().decode((await loadVerifiedPublicAsset({...args,relativePath:'index.html'})).bytes),'Synthetic app');
 await assert.rejects(loadVerifiedPublicAsset({...args,relativePath:'Workspace/data/RO-100.json'}),/Unverified/);
 const app=await(await base.store.getDirectoryHandle('System Files')).getFileHandle('index.html');app.bytes=f.bytes('tampered');
 await assert.rejects(loadVerifiedPublicAsset({...args,relativePath:'index.html'}),/no longer matches/);
});
