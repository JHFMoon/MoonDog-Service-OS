'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const f=require('./helpers/pwa_install_fixture.cjs');
const api=import('../src/pwa/synthetic_external_backup.mjs');
const {fixture,inventory}=require('./helpers/pwa_enrollment_fixture.cjs');
const inspect=(backup,args)=>(api.then(a=>a.inspectBrowserExternalBackup({backup,crypto:f.webcrypto,expectedStoreId:backup.storeId,version:args.version,expectedManifestHash:args.expectedManifestHash})));
test('enrolled stores export independently with overlapping RO identifiers and authenticated local profiles',async()=>{
 const a=await fixture(),b=await fixture({s:a.args.storage,code:'0002'}),m=await api;
 const one=await m.createBrowserExternalBackup(a.args),two=await m.createBrowserExternalBackup(b.args);
 assert.equal(one.format,'moondog-enrolled-workspace-export');assert.notEqual(one.storeId,two.storeId);assert.notEqual(one.sha256,two.sha256);
 assert.equal((await inspect(one,a.args)).enrollment.store.code,'0001');assert.equal((await inspect(two,b.args)).enrollment.store.code,'0002');
 await assert.rejects(m.createSyntheticExternalBackup(a.args),/SYNTHETIC|Synthetic backup refuses operational/);
 await assert.rejects(m.inspectSyntheticExternalBackup({backup:one,crypto:f.webcrypto,expectedStoreId:one.storeId,version:a.args.version,expectedManifestHash:a.args.expectedManifestHash}),/untrusted|incomplete/);
 const before=await inventory(a.ws),settings=await(await a.ws.getDirectoryHandle('data')).getFileHandle('settings.json');
 const changed=JSON.parse(await(await settings.getFile()).text());changed.store.code='0002';settings.bytes=f.bytes(JSON.stringify(changed));
 await assert.rejects(m.createBrowserExternalBackup(a.args),/Wrong-store configuration/);
 assert.equal((await inventory(a.ws))['data/RO-100.json'],before['data/RO-100.json']);
});
test('external receipt restores enrolled bytes into a fresh physical store with original logical identity',async()=>{
 const original=await fixture(),m=await api,backup=await m.createBrowserExternalBackup(original.args),before=await inventory(original.ws);
 const replacement=await fixture({enrollment:original.enrollment,workspaceId:backup.workspaceId,empty:true});
 await m.restoreBrowserExternalBackup({...replacement.args,backup,sourceStoreId:backup.storeId,checksum:backup.sha256});
 assert.notEqual(replacement.base.identity.storeId,original.base.identity.storeId);assert.equal(replacement.base.identity.workspaceId,original.base.identity.workspaceId);
 assert.deepEqual(await inventory(replacement.ws),before);assert.deepEqual(await inventory(original.ws),before);
 const repeated=await m.createBrowserExternalBackup(replacement.args);assert.equal(repeated.workspaceId,backup.workspaceId);assert.equal((await inspect(repeated,replacement.args)).mode,'operational');
});
test('wrong enrollment, wrong logical Workspace and tampered receipt refuse before any replacement bytes change',async()=>{
 const original=await fixture(),m=await api,backup=await m.createBrowserExternalBackup(original.args);
 for(const options of [{code:'0002',workspaceId:backup.workspaceId},{enrollment:original.enrollment}]){
  const next=await fixture({...options,empty:true}),before=await inventory(next.base.store);
  await assert.rejects(m.restoreBrowserExternalBackup({...next.args,backup,sourceStoreId:backup.storeId,checksum:backup.sha256}),/Wrong-store/);
  assert.deepEqual(await inventory(next.base.store),before);
 }
 const next=await fixture({enrollment:original.enrollment,workspaceId:backup.workspaceId,empty:true}),before=await inventory(next.base.store);
 await assert.rejects(m.restoreBrowserExternalBackup({...next.args,backup,sourceStoreId:backup.storeId,checksum:'0'.repeat(64)}),/receipt/);
 const changed=structuredClone(backup);changed.enrollment.store.code='0002';await assert.rejects(inspect(changed,original.args),/checksum/);
 assert.deepEqual(await inventory(next.base.store),before);
});
test('restore snapshots the authenticated external bytes before waiting for its exclusive store lock',async()=>{
 const original=await fixture(),m=await api,backup=await m.createBrowserExternalBackup(original.args),next=await fixture({enrollment:original.enrollment,workspaceId:backup.workspaceId,empty:true});
 const before=await inventory(original.ws),locks={request:async(_n,_o,run)=>{backup.files.find(f=>f.path==='data/RO-100.json').base64='AAAA';return run({});}};
 await m.restoreBrowserExternalBackup({...next.args,locks,backup,sourceStoreId:backup.storeId,checksum:backup.sha256});
 assert.deepEqual(await inventory(next.ws),before);
});
test('enrolled backups support report sizes beyond the synthetic limit while enforcing an upper bound before reading',async()=>{
 const original=await fixture(),m=await api,data=await original.ws.getDirectoryHandle('data');
 const report=await data.getFileHandle('synthetic-large.xlsx',{create:true});report.bytes=new Uint8Array(9*1024*1024).fill(42);
 const backup=await m.createBrowserExternalBackup(original.args);assert.equal((await inspect(backup,original.args)).bytes>9*1024*1024,true);
 const get=report.getFile.bind(report);report.getFile=async()=>({...await get(),size:65*1024*1024,arrayBuffer(){throw Error('oversized bytes must not be read');}});
 await assert.rejects(m.createBrowserExternalBackup(original.args),/too large/);
});
test('interrupted enrolled restore retains its durable hold and never becomes launchable',async()=>{
 const original=await fixture(),m=await api,backup=await m.createBrowserExternalBackup(original.args),next=await fixture({enrollment:original.enrollment,workspaceId:backup.workspaceId,empty:true});
 const data=await next.ws.getDirectoryHandle('data'),get=data.getFileHandle.bind(data);
 data.getFileHandle=async(name,options)=>{
  const file=await get(name,options);
  if(name==='RO-100.json')file.createWritable=async()=>({write:async()=>{},close:async()=>{throw Error('synthetic interrupted restore');},abort:async()=>{}});
  return file;
 };
 await assert.rejects(m.restoreBrowserExternalBackup({...next.args,backup,sourceStoreId:backup.storeId,checksum:backup.sha256}),/synthetic interrupted restore/);
 assert.match(await(await(await next.base.store.getFileHandle('MOONDOG-PWA-INSTALL-INCOMPLETE.json')).getFile()).text(),/incomplete/);
 const {inspectVerifiedBrowserInstallation}=await import('../src/pwa/install_verified_browser_store.mjs');
 await assert.rejects(inspectVerifiedBrowserInstallation(next.args),/remains incomplete/);
 assert.deepEqual(await inventory(original.ws),Object.fromEntries(backup.files.map(file=>[file.path,file.base64])));
});
