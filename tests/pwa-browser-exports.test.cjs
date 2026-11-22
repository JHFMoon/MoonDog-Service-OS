'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,inventory}=require('./helpers/pwa_enrollment_fixture.cjs'),f=require('./helpers/pwa_install_fixture.cjs');
const api=import('../src/pwa/browser_workspace_exports.mjs');
async function report(store,name,value){const d=await store.ws.getDirectoryHandle('exports'),file=await d.getFileHandle(name,{create:true});file.bytes=f.bytes(value);return file;}
test('saved report downloads remain byte-exact, store-scoped and entirely read-only',async()=>{
 const a=await fixture(),b=await fixture({s:a.args.storage,code:'0002'}),m=await api;
 await report(a,'Supervisor.xlsx','SYNTHETIC A workbook');await report(b,'Supervisor.xlsx','SYNTHETIC B workbook');
 await report(a,'not-a-report.html','SYNTHETIC excluded executable');const beforeA=await inventory(a.base.store),beforeB=await inventory(b.base.store);
 const entries=await m.listBrowserWorkspaceExports(a.args);assert.equal(entries.length,1);assert.equal(entries[0].name,'Supervisor.xlsx');
 const out=await m.readBrowserWorkspaceExport({...a.args,report:entries[0]});assert.equal(new TextDecoder().decode(out.bytes),'SYNTHETIC A workbook');assert.match(out.mime,/spreadsheetml/);
 await assert.rejects(m.readBrowserWorkspaceExport({...b.args,report:entries[0]}),/Wrong-store/);
 assert.deepEqual(await inventory(a.base.store),beforeA);assert.deepEqual(await inventory(b.base.store),beforeB);
});
test('changed bytes, invalid paths, foreign Workspace and oversized reports are refused',async()=>{
 const a=await fixture(),m=await api,file=await report(a,'Report.csv','SYNTHETIC 0001'),entries=await m.listBrowserWorkspaceExports(a.args);
 file.bytes=f.bytes('SYNTHETIC 0002');await assert.rejects(m.readBrowserWorkspaceExport({...a.args,report:entries[0]}),/Report changed/);
 for(const name of ['../settings.json','other/Report.csv','file.html','file.xlsx:bad','bad\n.xlsx'])await assert.rejects(m.readBrowserWorkspaceExport({...a.args,report:{...entries[0],name}}),/invalid saved report/);
 await assert.rejects(m.readBrowserWorkspaceExport({...a.args,report:{...entries[0],workspaceId:f.randomUUID()}}),/another Workspace/);
 const get=file.getFile.bind(file);file.getFile=async()=>({...await get(),size:65*1024*1024,arrayBuffer(){assert.fail('Oversized report must not be read');}});
 await assert.rejects(m.listBrowserWorkspaceExports(a.args),/download size/);
});
test('active dashboard ownership and unverified software prevent saved-report access',async()=>{
 const a=await fixture(),m=await api;await report(a,'Report.pdf','SYNTHETIC report');const before=await inventory(a.base.store);
 await assert.rejects(m.listBrowserWorkspaceExports({...a.args,locks:{request:async(_n,_o,run)=>run(null)}}),/Another MoonDog tab/);
 await assert.rejects(m.listBrowserWorkspaceExports({...a.args,expectedManifestHash:'0'.repeat(64)}),/authority|manifest/i);
 assert.deepEqual(await inventory(a.base.store),before);
});
test('saved reports remain accessible through an authenticated selected Beta without changing original bytes',async()=>{
 const a=await fixture(),m=await api;await report(a,'Supervisor.xlsx','SYNTHETIC selected Beta report');const next=await f.plan(),version='0.10.18-beta.456';next.version=version;
 for(const name of ['jszip.min.js','pdf.min.js','pdf.worker.min.js'])next.files.push({path:'System Files/vendor/'+name,bytes:f.bytes('SYNTHETIC '+name)});
 const manifest=next.files.find(x=>x.path==='INSTALLATION-MANIFEST.json'),value=JSON.parse(new TextDecoder().decode(manifest.bytes));value.version=version;value.files=[];
 for(const entry of next.files)if(entry!==manifest)value.files.push({path:entry.path,size:entry.bytes.length,sha256:await f.hash(entry.bytes)});manifest.bytes=f.bytes(JSON.stringify(value));
 const {stageVerifiedBrowserSoftware}=await import('../src/pwa/browser_software_candidates.mjs'),{activateStagedBrowserSoftware}=await import('../src/pwa/browser_software_selection.mjs');
 const staged=await stageVerifiedBrowserSoftware({...a.args,installedVersion:a.args.version,installedManifestHash:a.args.expectedManifestHash,version,zipHash:await f.hash(f.zip),zipBytes:f.zip,inspectVerifiedZip:async()=>next});
 await activateStagedBrowserSoftware({...a.args,originalVersion:a.args.version,originalManifestHash:a.args.expectedManifestHash,version,zipHash:staged.zipHash,manifestHash:staged.manifestHash});
 const before=await inventory(a.base.store),entries=await m.listBrowserWorkspaceExports(a.args),out=await m.readBrowserWorkspaceExport({...a.args,report:entries[0]});assert.equal(new TextDecoder().decode(out.bytes),'SYNTHETIC selected Beta report');
 await assert.rejects(m.listBrowserWorkspaceExports({...a.args,expectedManifestHash:'0'.repeat(64)}),/software authority/);assert.deepEqual(await inventory(a.base.store),before);
});
test('empty exports are explicit and a disposed page cannot start report access',async()=>{
 const a=await fixture(),m=await api;assert.deepEqual(await m.listBrowserWorkspaceExports(a.args),[]);
 const controller=new AbortController();controller.abort();await assert.rejects(m.listBrowserWorkspaceExports({...a.args,signal:controller.signal}),/session is closed/);
});
