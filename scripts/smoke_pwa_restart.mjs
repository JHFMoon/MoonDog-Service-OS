#!/usr/bin/env node
// Synthetic isolated-profile proof. Never uses a person's browser profile.
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const secondary=process.env.PWA_SECOND_STORE==='1';
const STORE_NAME=secondary?'SYNTHETIC Bravo Motors':'SYNTHETIC Alpha Motors';
const STORE_CODE=secondary?'9002':'9001';
const STORE_GROSS=secondary?0:500;
const STORE_PACE=STORE_GROSS/8*22;
const [base,sha]=process.argv.slice(2);
assert.match(sha||'',/^[a-f0-9]{40}$/);
const url=new URL('web-preview/',base).href;
let management=url;
const profile=await mkdtemp(join(tmpdir(),'moondog-synthetic-restart-'));
let context;
let manualRoReady=false;
let nativeManifestId=null;
let nativeStartUrl=null;
const advancedRecovery=process.env.PWA_ADVANCED_RECOVERY==='1';
let saprWorkbookBytes=null;
async function shellProof(page){
 return page.evaluate(()=>new Promise((resolve,reject)=>{
  const channel=new MessageChannel();
  const timeout=setTimeout(()=>{channel.port1.close();reject(Error('Offline shell proof timed out'));},5000);
  channel.port1.onmessage=event=>{clearTimeout(timeout);channel.port1.close();resolve(event.data);};
  navigator.serviceWorker.controller.postMessage({type:'MOONDOG_PREVIEW_SHELL_PROBE'},[channel.port2]);
 }));
}
const runtimeErrors=[];
const launch=async()=>{
 const instance=await chromium.launchPersistentContext(profile,{headless:false,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{}),...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const observe=page=>{
  page.on('pageerror',error=>{runtimeErrors.push(error.message);console.error(JSON.stringify({publicRuntimeError:true,url:page.url(),message:error.message.slice(0,2000)}));});
  page.on('console',message=>{if(message.type()==='error')console.error(JSON.stringify({publicConsoleError:true,url:page.url(),message:message.text().slice(0,2000)}));});
  page.on('requestfailed',request=>{if(request.url().startsWith(new URL('web-preview/store/',base).href))console.error(JSON.stringify({publicAssetFailure:true,url:request.url(),failure:request.failure()}));});
 };
 for(const page of instance.pages())observe(page);instance.on('page',observe);
 return instance;
};
const snapshot=async page=>page.evaluate(async()=>{
 const p=JSON.parse(localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1'));
 const root=await navigator.storage.getDirectory();
 const bucket=await root.getDirectoryHandle('MoonDog-PWA-v1');
 const stores=await bucket.getDirectoryHandle('stores');
 const store=await stores.getDirectoryHandle(p.storeId);
 const system=await store.getDirectoryHandle('System Files');
 const ws=await system.getDirectoryHandle('Workspace');
 const files=[],lifecycle={dailyHistory:{}};
 async function walk(dir,prefix=''){
  for await(const [name,h] of dir.entries()){
   if(h.kind==='directory')await walk(h,prefix+name+'/');
   else {const bytes=await(await h.getFile()).arrayBuffer();const hash=await crypto.subtle.digest('SHA-256',bytes),path=prefix+name;
    files.push([path,Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')]);
    if(path==='MOONDOG_DIAGNOSTICS.md')lifecycle.diagnostics=new TextDecoder().decode(bytes);
    if(path==='data/recovery.json')lifecycle.recovery=JSON.parse(new TextDecoder().decode(bytes));
    if(path==='data/store-revision.json')lifecycle.revision=JSON.parse(new TextDecoder().decode(bytes));
    if(/^data\/history\/daily-/.test(path))lifecycle.dailyHistory[path]=JSON.parse(new TextDecoder().decode(bytes));
   }
  }
 }
 await walk(ws);return {pointer:p,files:files.sort(),lifecycle:{recovery:lifecycle.recovery,revision:lifecycle.revision,diagnostics:lifecycle.diagnostics,dailyHistory:Object.fromEntries(Object.entries(lifecycle.dailyHistory).sort())}};
});
const readOperational=async page=>page.evaluate(async requireManualRo=>{
 const p=JSON.parse(localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1'));
 let d=await navigator.storage.getDirectory();
 for(const n of ['MoonDog-PWA-v1','stores',p.storeId,'System Files','Workspace','data'])d=await d.getDirectoryHandle(n);
 const json=async n=>{try{return JSON.parse(await(await(await d.getFileHandle(n)).getFile()).text());}catch(error){throw Error('Durable '+n+': '+error);}};
 const performance=await json('advisor-performance.json'),settings=await json('settings.json');
 // A clean installation does not create an RO snapshot until its first RO import.
 const state=requireManualRo?await json('current-state.json'):null;
 const history=await d.getDirectoryHandle('history').catch(error=>{throw Error('History directory: '+error);});let imports=0;
 for await(const [name,h] of history.entries())if(h.kind==='file'&&name.endsWith('.json')&&!name.startsWith('.moondog-txn-')){
  let event;try{event=JSON.parse(await(await h.getFile()).text());}catch(error){throw Error('History event '+name+': '+error);}if(event.type==='performance-import')imports++;
 }
 return {store:settings.store,setup:settings.setup,snapshot:performance.snapshots['2026-11-19'],imports,record:state?.records?.find(row=>row.ro==='900001')||null};
},manualRoReady);
function assertOperational(value){
 assert.equal(value.store.name,STORE_NAME);assert.equal(value.store.code,STORE_CODE);
 assert.equal(value.snapshot.store.cpGross,STORE_GROSS);assert.equal(value.snapshot.store.cpRO,5);
 assert.equal(value.snapshot.saprDaysCompleted,8);assert.equal(value.snapshot.saprTotalDays,22);
 assert.ok(value.imports>=1,'Durable import history required');
 if(manualRoReady){
  assert.equal(value.record?.management?.owner,STORE_NAME+' manual owner',
   'Durable synthetic RO owner mismatch; management='+JSON.stringify(value.record?.management));
  assert.equal(value.record?.management?.nextAction,'Preserve synthetic '+STORE_CODE);
 }
}
async function assertPublishedViews(page){
 await page.getByRole('button',{name:'Home',exact:true}).click();
 await page.locator('#view-home.active').waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>globalThis.__moondogSettingsModel?.performance?.snapshots['2026-11-19']?.store?.cpGross),STORE_GROSS,'Home must use the rehydrated canonical SAPR');
 await page.getByRole('button',{name:/^Advisor meeting$/i}).click();
 await page.locator('#view-meeting.active').waitFor({state:'visible'});
 const meeting=await page.evaluate(()=>{const value=globalThis.__moondogSapr?.latestVerifiedMeetingSnapshot();return value?{gross:value.store.cpGross,days:value.saprDaysCompleted,totalDays:value.saprTotalDays}:null;});
 assert.deepEqual(meeting,{gross:STORE_GROSS,days:8,totalDays:22},'Rendered meeting must use the same verified source/days');
 assert.ok((await page.locator('#view-meeting').innerText()).trim().length>50,'Real meeting UI must render');
 await page.getByRole('button',{name:/^Advisor performance$/i}).click();
 // The canonical Home and meeting share a verified SAPR source, but the
 // performance panel renders asynchronously after a navigation. Require the
 // correct real UI text within a strict deadline; never accept merely saved
 // report data or a blank/stale performance panel.
 try{
  await page.waitForFunction(({gross,pace})=>{
   const view=document.querySelector('#view-performance.active');
   return !!view&&view.innerText.includes('Current MTD: $'+gross)&&
    view.innerText.includes('Month pace: $'+pace);
  },{gross:STORE_GROSS.toLocaleString('en-US'),pace:STORE_PACE.toLocaleString('en-US')},{timeout:15000});
 }catch(error){
  const evidence=await page.evaluate(()=>({
   performanceText:(document.querySelector('#view-performance')?.innerText||'').slice(0,800),
   homeGross:globalThis.__moondogSettingsModel?.performance?.snapshots['2026-11-19']?.store?.cpGross??null,
   meetingGross:globalThis.__moondogSapr?.latestVerifiedMeetingSnapshot()?.store?.cpGross??null
  }));
  console.error(JSON.stringify({publishedPerformanceReadinessFailure:true,...evidence}));
  throw error;
 }
 assert.ok((await page.locator('#view-performance').innerText()).includes('Current MTD: $'+STORE_GROSS.toLocaleString('en-US')));
 assert.ok((await page.locator('#view-performance').innerText()).includes('Month pace: $'+STORE_PACE.toLocaleString('en-US')));
 console.log(JSON.stringify({publishedHomeMeetingPerformance:true,cpGross:STORE_GROSS,reportedDays:8,totalDays:22,monthPace:STORE_PACE}));
}
// After app launch, validate normal connection bookkeeping separately from
// immutable data. Software stage/select/rollback still use full byte equality.
function assertLifecyclePreservation(before,after,label){
 assert.deepEqual(after.pointer,before.pointer,label+': original store/software authority');
 const prior=new Map(before.files),current=new Map(after.files);
 const metadata=new Set(['MOONDOG_DIAGNOSTICS.md','data/recovery.json','data/store-revision.json']);
 for(const [path,hash] of prior){
  assert.ok(current.has(path),label+': missing original '+path);
  if(!metadata.has(path))assert.equal(current.get(path),hash,label+': original bytes changed '+path);
 }
 const a=before.lifecycle,b=after.lifecycle;
 assert.equal(b.recovery.status,'Ready',label+': recovery must be healthy');
 assert.ok(Number.isFinite(Date.parse(b.recovery.lastSuccessfulConnectionAt)),label+': valid connection time');
 assert.ok(Date.parse(b.recovery.lastSuccessfulConnectionAt)>=Date.parse(a.recovery.lastSuccessfulConnectionAt),label+': connection time cannot regress');
 const withoutTime=value=>{const copy={...value};delete copy.lastSuccessfulConnectionAt;return copy;};
 assert.deepEqual(withoutTime(b.recovery),withoutTime(a.recovery),label+': recovery authority/backup fields unchanged');
 assert.deepEqual(Object.keys(b.revision).sort(),['revision','schemaVersion']);
 assert.equal(b.revision.schemaVersion,1);assert.ok(Number.isSafeInteger(b.revision.revision)&&b.revision.revision>=a.revision.revision,label+': monotonic durable revision');
 if(a.diagnostics!==undefined){
  assert.match(b.diagnostics,/^# Service Operations Dashboard Diagnostics/);
  for(const line of a.diagnostics.split(/\r?\n/).filter(line=>line.startsWith('- ')))
   assert.ok(b.diagnostics.split(/\r?\n/).includes(line),label+': diagnostic history cannot disappear');
 }
 for(const [path] of current)if(!prior.has(path)){
  assert.match(path,/^data\/history\/daily-[0-9]+-[0-9a-f-]+\.json$/,label+': unexpected new Workspace file');
  const event=b.dailyHistory[path];
  assert.equal(event?.schemaVersion,1);assert.equal(event?.type,'daily-task');
  assert.equal('data/history/'+event.id+'.json',path);
  assert.ok(Number.isFinite(Date.parse(event.at))&&Date.parse(event.at)>=Date.parse(a.recovery.lastSuccessfulConnectionAt));
  assert.equal(typeof event.details?.action,'string');assert.ok(event.details.action.length>0);
 }
}
async function settledSnapshot(page){
 // Snapshot while the application still holds its lock; do not interrupt pending writes by navigating away.
 let prior=null,stableSamples=0;
 for(let attempt=0;attempt<120;attempt++){
  let current;try{current=await snapshot(page);}catch(error){if(!/NotFoundError|NotReadableError/.test(String(error)))throw error;stableSamples=0;await page.waitForTimeout(500);continue;}
  const settled=!current.files.some(([name])=>name.includes('.moondog-txn-'));
  stableSamples=settled&&JSON.stringify(current)===JSON.stringify(prior)?stableSamples+1:0;
  if(stableSamples>=4){return current;}
  prior=current;await page.waitForTimeout(500);
 }
 throw Error('Workspace writes must settle before restart');
}
try{
 context=await launch();let page=await context.newPage();
 const waitMs=Number(process.env.PWA_PUBLICATION_WAIT_MS||0);
 assert.ok(Number.isInteger(waitMs)&&waitMs>=0&&waitMs<=480000);
 const deadline=Date.now()+waitMs;let metadata,attempt=0;
 do{
  await page.goto(new URL('site-version.json?verify='+sha+'-'+attempt++,base).href);
  metadata=JSON.parse(await page.locator('body').innerText());
  if(metadata.mainSha===sha||Date.now()>=deadline)break;
  if(attempt===1)console.log(JSON.stringify({waitingForPublication:sha,observed:metadata.mainSha}));
  await page.waitForTimeout(10000);
 }while(Date.now()<deadline);
 assert.equal(metadata.mainSha,sha,'Published SHA must match requested main');
 if(process.env.PWA_DIAGNOSTIC_SKIP_SHELL==='1')console.log(JSON.stringify({partialDiagnostic:true,skippedKnownV16CacheCase:true,acceptanceIncomplete:true,publishedMain:sha}));
 await page.goto(url);
 const fullJourney=await page.locator('#appSettings').count()>0;
 if(fullJourney)management=new URL('index.html?manage=1',url).href;
 // Enforce full entry at the end as well, so an old published page can still
 // expose a deeper runtime defect during a diagnostic exact-main run.
 let nativePwaInstalled=false;
 if(fullJourney){
  assert.equal(await page.locator('#appSettings').isHidden(),true,'Engineering controls must not appear during normal installation');
  assert.equal(await page.locator('input[type=file]:visible').count(),0,'No ZIP or folder selection in normal setup');
 }
 await page.locator('#consent').check();
 await page.locator('#installFromWeb').click({timeout:60000});
 if(fullJourney)await page.waitForURL(/\/store\/.*\/index\.html$/,{timeout:120000});
 else await page.locator('#openApp').waitFor({state:'visible',timeout:120000});
 const candidateInitializer=false; // Published runtime only: no PR-only code injection.
 let before;
 const appUrl=fullJourney?page.url():new URL(await page.locator('#openApp').getAttribute('href'),url).href;
 {
  // Native installation is verified even on a published-baseline PR run.
  // Use the production-installed offline worker and release the app's lock
  // before launching a separate native app window.
  const control=await context.newPage();
  await page.close();page=control;
  await page.goto(management);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  const browser=await context.newCDPSession(page);
  const manifest=await browser.send('Page.getAppManifest');
  const installability=await browser.send('Page.getInstallabilityErrors');
  console.log(JSON.stringify({nativeInstallability:installability}));
  assert.deepEqual(installability.installabilityErrors,[],'Published PWA must satisfy browser installation checks');
  assert.equal(manifest.errors.length,0,'Native app manifest must be valid');
  const manifestData=JSON.parse(manifest.data);
  assert.match(manifestData.name,/MoonDog/);
  const startUrl=new URL(manifestData.start_url,manifest.url);
  nativeStartUrl=startUrl.href;
  // Manifest id resolves against start_url's ORIGIN, not its directory.
  const nativeId=new URL(manifestData.id,new URL(startUrl.origin+'/')).href;
  nativeManifestId=nativeId;
  if(fullJourney){
   assert.equal(manifestData.name,'MoonDog Service OS');
   assert.equal(nativeId,url,'MoonDog identity must be scoped to its published app');
  }
  // Install the currently loaded, independently checked website manifest.
  // The URL-only CDP path creates a separate background fetch/renderer.
  await browser.send('PWA.install',{manifestId:nativeId});
  await browser.send('PWA.getOsAppState',{manifestId:nativeId});
  await browser.send('PWA.changeAppUserSettings',{manifestId:nativeId,displayMode:'standalone'});
  const opened=context.waitForEvent('page');
  const launched=await browser.send('PWA.launch',{manifestId:nativeId});
  console.log(JSON.stringify({nativeInstalled:true,nativeLaunchTarget:launched.targetId,visiblePages:context.pages().map(p=>p.url())}));
  const installed=await opened;await page.close();page=installed;
  await page.waitForURL(u=>u.href===nativeStartUrl||u.href.startsWith(new URL('store/',url).href),{timeout:60000});
  nativePwaInstalled=true;
 }
 if(fullJourney)await page.waitForURL(/\/store\/.*\/index\.html$/,{timeout:60000});
 else await page.goto(appUrl);await page.waitForLoadState('load');
 assert.equal(await page.evaluate(()=>matchMedia('(display-mode: standalone)').matches),true,'Installed MoonDog must launch as an app');
 assert.match(await page.title(),/dashboard|MoonDog|service/i);
 if(!fullJourney)await page.locator('#connectButton').click();
 await page.waitForFunction(()=>!document.body.innerText.includes('Connect Service Operations Dashboard to begin')).catch(async error=>{console.error('CONNECT FAILURE',await page.locator('body').innerText());throw error;});
 await page.waitForFunction(()=>document.querySelector('#folderWatchStatus')?.textContent.startsWith('REPORT INBOX WATCHING'));
 await settledSnapshot(page);
 if(process.env.PWA_SAPR==='1'){
  await page.getByRole('button',{name:'Open Store settings',exact:true}).click();
  async function saveField(id,value,select=false){
   if(select)await page.locator(id).selectOption(value);else await page.locator(id).fill(value);
   await page.locator(id).dispatchEvent('change');await page.locator('#storeBrand').focus();
   await page.waitForFunction(()=>document.querySelector('#settingsSaveStatus').textContent.startsWith('Saved '));
   assert.equal(await page.locator(id).inputValue(),value,'Store field must survive its durable save');
  }
  await saveField('#storeName',STORE_NAME);
  await saveField('#storeCode',STORE_CODE);
  await saveField('#storeTimeZone','America/Los_Angeles',true);
  await page.evaluate(async({name,code,gross})=>{
   const pointer=JSON.parse(localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1'));
   const root=await navigator.storage.getDirectory();
   const bucket=await root.getDirectoryHandle('MoonDog-PWA-v1');const stores=await bucket.getDirectoryHandle('stores');
   const store=await stores.getDirectoryHandle(pointer.storeId);const sys=await store.getDirectoryHandle('System Files');
   const ws=await sys.getDirectoryHandle('Workspace');const inbox=await ws.getDirectoryHandle('01 - DROP REPORTS HERE',{create:true});
   const metrics=[['Days Completed 8 out of 22'],['Total Gross',gross,null,null,null,null,gross+200],['Total Revenue',1000,null,null,null,null,1400],['RO Count',5,null,null,null,null,7],['Hours per RO',2],['ELR',100]];
   const book=XLSX.utils.book_new();
   const benchmark=label=>[label,...Array.from({length:7},()=>[25,30,40,null,null]).flat()];
   XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Service Advisor Performance From 11/01/2026 to 11/19/2026'],...metrics]),'Store');
   XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Synthetic Advisor [101]'],...metrics]),'Advisor');
   XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([[],['Tires','Brakes'],[],[],[],benchmark(code+' - '+name),benchmark('Synthetic Advisor [101]')]),'Controllables');

   const bytes=XLSX.write(book,{type:'array',bookType:'xlsx'});
   const f=await inbox.getFileHandle('synthetic-sapr.xlsx',{create:true});const writer=await f.createWritable();await writer.write(bytes);await writer.close();
  },{name:STORE_NAME,code:STORE_CODE,gross:STORE_GROSS});
  await page.getByRole('button',{name:'Tools',exact:true}).click();
  await page.getByRole('button',{name:'Import or refresh data',exact:true}).click();
  const sourceBytes=await page.evaluate(async()=>{
   const p=JSON.parse(localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1'));
   let d=await navigator.storage.getDirectory();for(const name of ['MoonDog-PWA-v1','stores',p.storeId,'System Files','Workspace','01 - DROP REPORTS HERE'])d=await d.getDirectoryHandle(name);
   return Array.from(new Uint8Array(await(await(await d.getFileHandle('synthetic-sapr.xlsx')).getFile()).arrayBuffer()));
  });
  saprWorkbookBytes=Buffer.from(sourceBytes);
  await page.locator('#dailyTools input[type=file]').setInputFiles({name:'synthetic-sapr.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:saprWorkbookBytes});
  await page.waitForFunction(()=>document.querySelector('#performancePeriod').textContent.includes('2026'),{},{timeout:30000});
  await settledSnapshot(page);assertOperational(await readOperational(page));
  await page.getByRole('button',{name:'Tools',exact:true}).click();
  await page.getByRole('button',{name:'Import or refresh data',exact:true}).click();
  await page.getByRole('button',{name:/report.*setup/i}).click();
  await page.locator('#completeSetup').click();
  // Completion writes settings/history before the canonical Home transition.
  // Wait for that acknowledgement before issuing another navigation command.
  await page.locator('#view-home.active').waitFor({state:'visible',timeout:30000});
  const completedSetup=await readOperational(page);
  assert.ok(completedSetup.setup?.completedAt);assert.equal(completedSetup.setup.reopened,false);
  await page.getByRole('button',{name:'Advisor Performance',exact:true}).click();
  assert.ok((await page.locator('#view-performance').innerText()).includes('Current MTD: $'+STORE_GROSS.toLocaleString('en-US')));
  assert.ok((await page.locator('#view-performance').innerText()).includes('Month pace: $'+STORE_PACE.toLocaleString('en-US')));
 }
 if(process.env.PWA_SAPR==='1'){
  const review=async dialog=>{
   if(/^Review complete RO replacement: synthetic-open-ro/.test(dialog.message()))await dialog.accept();
   else{await dialog.dismiss();throw Error('Unexpected synthetic import confirmation: '+dialog.message());}
  };
  page.on('dialog',review);
  async function importRo(revision){
   await page.getByRole('button',{name:'Tools',exact:true}).click();
   await page.getByRole('button',{name:'Import or refresh data',exact:true}).click();
   const data=await page.evaluate(({name,code,revision})=>{
    const book=XLSX.utils.book_new();
    const rows=[['SYNTHETIC source for '+name+' '+code],
     ['RO Number','Advisor','Advisor Number','Customer','Vehicle','Status','Opened','Total'],
     ['900001','Synthetic Advisor','101','SYNTHETIC Customer','SYNTHETIC Vehicle','Working','11/19/2026',100+revision]];
    XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Open ROs');
    return Array.from(new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx'})));
   },{name:STORE_NAME,code:STORE_CODE,revision});
   const name='synthetic-open-ro-'+revision+'.xlsx';
   await page.locator('#dailyTools input[type=file]').setInputFiles({name,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(data)});
   await page.waitForFunction(async name=>{
    const p=JSON.parse(localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1'));
    let d=await navigator.storage.getDirectory();for(const n of ['MoonDog-PWA-v1','stores',p.storeId,'System Files','Workspace','data'])d=await d.getDirectoryHandle(n);
    let state;
    try{state=JSON.parse(await(await(await d.getFileHandle('current-state.json')).getFile()).text());}
    catch(error){if(error.name==='NotFoundError')return false;throw error;}
    return state.source?.fileName===name&&state.records?.some(row=>row.ro==='900001');
   },name,{timeout:60000});
   await settledSnapshot(page);
  }
  await importRo(0);
  await page.getByRole('button',{name:'Open RO Control',exact:true}).click();
  // Record the real control events before opening the editor. The initial
  // application autofocus is deferred to a frame; typing before that frame
  // can race focus in Playwright's insertText operation. Do not refill/retry
  // a failed assignment or relax the pre-submit/durable assertions below.
  await page.evaluate(()=>{
   window.__syntheticEditorTrace=[];
   const record=event=>{
    if(!event.target.closest?.('#editDialog'))return;
    window.__syntheticEditorTrace.push({type:event.type,field:event.target.id,
     focus:document.activeElement?.id,value:event.target.value,at:performance.now()});
   };
   window.__syntheticEditorObserver=record;
   for(const type of ['focusin','input','change'])document.addEventListener(type,record,true);
  });
  await page.locator('#roTable tr[data-id] button[data-id]').first().click();
  await page.locator('#editDialog').waitFor({state:'visible'});
  const editorReady=await page.evaluate(()=>new Promise(resolve=>{
   requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({
    open:document.querySelector('#editDialog').open,focus:document.activeElement?.id,
    at:performance.now()
   })));
  }));
  assert.equal(editorReady.open,true,'RO editor must remain open after its initialization frame');
  assert.ok(['editNextAction','editStatus'].includes(editorReady.focus),
   'Canonical editor autofocus must complete before manager input');
  await page.locator('#editStatus').selectOption({label:'Being Repaired'});
  await page.locator('#editOwner').fill(STORE_NAME+' manual owner');
  assert.equal(await page.locator('#editOwner').inputValue(),STORE_NAME+' manual owner',
   'Owner control must receive manager input on the first attempt');
  await page.locator('#editNextAction').fill('Preserve synthetic '+STORE_CODE);
  await page.locator('#editReviewDate').fill('2026-11-23');
  // A successful editor close proves a durable save, not that an earlier
  // async re-render preserved what the manager actually submitted.
  const draft=await page.locator('#editOwner').evaluate(field=>({owner:field.value,explicit:field.dataset.ownerAssignmentExplicit}));
  assert.equal(draft.owner,STORE_NAME+' manual owner',
   'Editor must retain the manager-entered follow-up owner before submit');
  // Published Stable predates the explicit-owner provenance field. Verify it
  // when available, but do not mistake an older verified runtime for lost data.
  if(draft.explicit!==undefined)assert.equal(draft.explicit,'true',
   'Newer runtime must mark the manual owner assignment as explicit');
  console.log(JSON.stringify({editorReadiness:editorReady,editorEvents:await page.evaluate(()=>{
   for(const type of ['focusin','input','change'])document.removeEventListener(type,window.__syntheticEditorObserver,true);
   return window.__syntheticEditorTrace;
  }),manualOwnerRetainedBeforeSubmit:true}));
  await page.locator('#saveRecordClose').click();await page.locator('#editDialog').waitFor({state:'hidden'});
  await settledSnapshot(page);manualRoReady=true;
  assertOperational(await readOperational(page));
  await importRo(1);assertOperational(await readOperational(page));
  page.off('dialog',review);
  await assertPublishedViews(page);
  console.log(JSON.stringify({overlappingRo:'900001',manualOwnerAndActionSaved:true,manualOverridesSurviveSourceRefresh:true}));
 }
 if(fullJourney){
  const preserved=await settledSnapshot(page);
  const otherTab=await context.newPage();await otherTab.goto(appUrl);
  await otherTab.waitForFunction(()=>document.body.innerText.includes('Another MoonDog tab is already using this browser store.'));
  assert.equal(await otherTab.locator('#folderWatchStatus').innerText().then(value=>value.startsWith('REPORT INBOX WATCHING')),false,
   'A second tab must not acquire write authority');
  assert.deepEqual(await snapshot(page),preserved,'Refused second-tab connection must preserve every Workspace byte');
  await otherTab.close();
  console.log(JSON.stringify({multiTabRefused:true,workspaceUnchanged:true}));
 }
 before=await settledSnapshot(page);
 if(process.env.PWA_SAPR==='1')assertOperational(await readOperational(page));
 await context.close();context=null; // Actual Chromium process termination, same disk profile.
 context=await launch();await context.setOffline(true);
 const restartControl=await context.newPage();
 const restartedBrowser=await context.newCDPSession(restartControl);
 await restartedBrowser.send('PWA.getOsAppState',{manifestId:nativeManifestId});
 const reopened=context.waitForEvent('page');
 await restartedBrowser.send('PWA.launch',{manifestId:nativeManifestId});
 page=await reopened;await restartControl.close();
 await page.waitForURL(u=>u.href===nativeStartUrl||u.href.startsWith(new URL('store/',url).href),{timeout:60000});
 if(fullJourney){
  await page.waitForURL(/\/store\/.*\/index\.html$/,{timeout:30000});
 }else{
  await page.locator('#openApp').waitFor({state:'visible',timeout:30000});
  const response=await page.goto(appUrl);assert.equal(response.status(),200);
 }

 assert.match(await page.title(),/dashboard|MoonDog|service/i);
 assert.equal(await page.evaluate(()=>matchMedia('(display-mode: standalone)').matches),true,'Restarted offline app must remain installed and standalone');
 // Ensure real application HTML, not setup or worker failure page.
 if(!fullJourney)await page.locator('#connectButton').click();
 await page.waitForFunction(()=>!document.body.innerText.includes('Connect Service Operations Dashboard to begin')).catch(async error=>{console.error('CONNECT FAILURE',await page.locator('body').innerText());throw error;});
 await page.waitForFunction(()=>document.querySelector('#folderWatchStatus')?.textContent.startsWith('REPORT INBOX WATCHING'));
 await settledSnapshot(page);
 assertLifecyclePreservation(before,await snapshot(page),'Offline process restart');
 assert.match(await page.locator('body').innerText(),/Guided Setup|Home|Advisor/i);
 if(process.env.PWA_SAPR==='1'){
  await page.getByRole('button',{name:'Advisor Performance',exact:true}).click();
  assert.ok((await page.locator('#view-performance').innerText()).includes('Current MTD: $'+STORE_GROSS.toLocaleString('en-US')));
  assert.ok((await page.locator('#view-performance').innerText()).includes('Month pace: $'+STORE_PACE.toLocaleString('en-US')));
  await settledSnapshot(page);assertOperational(await readOperational(page));
  await assertPublishedViews(page);
  console.log(JSON.stringify({saprRestart:true,cpGross:STORE_GROSS,monthPace:STORE_PACE,guidedSetup:true}));
 }

 if(process.env.PWA_RECOVERY==='1'){
  await settledSnapshot(page);
  await context.setOffline(false);await page.goto(management);await page.locator('#consent').check();
  if(advancedRecovery&&process.env.PWA_DIAGNOSTIC_SKIP_SHELL!=='1'){
   // Finish the online startup handshake before evicting anything. Otherwise
   // that same startup may legitimately begin its repair before we go offline.
   await page.locator('#openApp').waitFor({state:'visible',timeout:60000});
   const proof=await shellProof(page),preserved=await snapshot(page);
   assert.equal(proof.complete,true,'Current published shell must prove every public cache entry');
   assert.match(proof.cache,/shell-v(?:1[6-9]|[2-9][0-9])$/);
   const deleted=await page.evaluate(async cache=>{
    return(await caches.open(cache)).delete(new URL('modules/verified_beta_transport.mjs',location.href).href);
   },proof.cache);
   assert.equal(deleted,true,'Evict an actual required public module');
   assert.equal((await shellProof(page)).complete,false,'An evicted shell must lose readiness');
   await context.setOffline(true);await page.reload();
   assert.equal(await page.evaluate(()=>navigator.onLine),false,'Browser must report offline during incomplete-shell refusal');
   console.log(JSON.stringify({offlineEvictionReload:await shellProof(page)}));
   await page.waitForFunction(()=>/could not prepare its offline files/i.test(document.querySelector('#result').textContent),null,{timeout:45000});
   assert.equal(await page.locator('#openApp').isHidden(),true,'Incomplete offline shell must not claim app readiness');
   assert.deepEqual(await snapshot(page),preserved,'Offline cache loss must preserve every Workspace byte');
   await context.setOffline(false);await page.reload();
   await page.locator('#openApp').waitFor({state:'visible',timeout:60000});
   const rebuilt=await shellProof(page);assert.equal(rebuilt.complete,true);
   const urls=await page.evaluate(async name=>(await(await caches.open(name)).keys()).map(r=>r.url),rebuilt.cache);
   assert.ok(urls.every(value=>!value.includes('/store/')&&!value.includes('/Workspace/')&&!/\.(?:xlsx|csv|pdf|json)(?:\?|$)/i.test(value)),
    'Only public code may be rebuilt into the offline cache');
   assert.deepEqual(await snapshot(page),preserved,'Online public-shell repair must preserve all private bytes');
   await page.locator('#consent').check();
   console.log(JSON.stringify({offlineCacheEvictionRefused:true,onlineShellRebuilt:true,workspaceByteExact:true,cache:rebuilt.cache}));
  }
  await page.locator('#prepareBackup').click();await page.locator('#saveBackup').waitFor({state:'visible'});
  const receipt=await page.locator('#backupReceipt').inputValue();
  const receiptPath=join(profile,'external-receipt.txt'),backupPath=join(profile,'external-backup.json');
  await writeFile(receiptPath,receipt);
  const downloadEvent=page.waitForEvent('download');await page.locator('#saveBackup').click();
  await(await downloadEvent).saveAs(backupPath);
  const backup=JSON.parse(await readFile(backupPath,'utf8'));
  const expectedFiles=backup.files.map(f=>[f.path,f.sha256]).sort();
  assert.ok(expectedFiles.length>1,'Recovery must preserve initialized Workspace files');
  const cdp=await context.newCDPSession(page);
  if(advancedRecovery){
   const preserved=await snapshot(page),href=await page.locator('#openApp').getAttribute('href');
   await page.locator('#backupFile').evaluate(el=>{el.closest('details').open=true;});
   await page.locator('#backupFile').setInputFiles(backupPath);await page.locator('#restoreReceipt').fill(receipt);
   await cdp.send('Storage.overrideQuotaForOrigin',{origin:new URL(url).origin,quotaSize:0});
   try{
    await page.locator('#restoreBackup').click();
    await page.waitForFunction(()=>/Preview was not completed/i.test(document.querySelector('#result').textContent),null,{timeout:120000});
    assert.match(await page.locator('#result').innerText(),/quota|storage|space/i,'Quota refusal must be explicit');
    assert.equal(await page.locator('#openApp').getAttribute('href'),href,'Failed recovery must keep the working software pointer');
    assert.deepEqual(await snapshot(page),preserved,'Real browser quota refusal must preserve every original Workspace byte');
   }finally{await cdp.send('Storage.overrideQuotaForOrigin',{origin:new URL(url).origin});}
   console.log(JSON.stringify({browserQuotaRefused:true,originalWorkspaceByteExact:true,workingPointerPreserved:true}));
  }
  await cdp.send('Storage.clearDataForOrigin',{origin:new URL(url).origin,storageTypes:'all'});
  if(advancedRecovery)await cdp.send('Browser.grantPermissions',{origin:new URL(url).origin,permissions:[]});
  await page.close();page=await context.newPage();await page.goto(management);
  assert.equal(await page.evaluate(()=>localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1')),null);
  assert.equal(await page.evaluate(async()=>{const root=await navigator.storage.getDirectory();let n=0;for await(const _ of root.entries())n++;return n;}),0);
  assert.equal(await page.locator('#openApp').isHidden(),true);
  if(advancedRecovery){
   assert.deepEqual(await page.evaluate(async()=>({granted:await navigator.storage.persist(),persistent:await navigator.storage.persisted()})),
    {granted:false,persistent:false},'Denied durable-storage permission must not be represented as a permanent backup');
   console.log(JSON.stringify({persistentStorageDenied:true,externalBackupRequired:true}));
  }
  await page.locator('#consent').check();await page.locator('#backupFile').evaluate(el=>{el.closest('details').open=true;});
  // Missing external file must refuse before creating any replacement store.
  await page.locator('#restoreReceipt').fill(receipt);await page.locator('#restoreBackup').click();
  await page.waitForFunction(()=>document.querySelector('#backupStatus').textContent.includes('provide the backup file'));
  await page.locator('#backupFile').setInputFiles(backupPath);
  const wrongReceipt=receipt.slice(0,-1)+(receipt.endsWith('0')?'1':'0');
  await page.locator('#restoreReceipt').fill(wrongReceipt);await page.locator('#restoreBackup').click();
  await page.waitForFunction(()=>document.querySelector('#backupStatus').textContent.includes('does not match'));
  await page.locator('#restoreReceipt').fill('00000000-0000-4000-8000-000000000000:'+receipt.split(':')[1]);
  await page.locator('#restoreBackup').click();
  await page.waitForFunction(()=>document.querySelector('#backupStatus').textContent.includes('does not match'));
  assert.equal(await page.locator('#openApp').isHidden(),true);
  const tampered=structuredClone(backup);tampered.files[0].sha256='0'.repeat(64);
  const tamperedPath=join(profile,'tampered-backup.json');await writeFile(tamperedPath,JSON.stringify(tampered));
  await page.locator('#backupFile').setInputFiles(tamperedPath);
  await page.locator('#restoreReceipt').fill(receipt);await page.locator('#restoreBackup').click();
  await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('Preview was not completed'));
  assert.equal(await page.locator('#openApp').isHidden(),true);
  await page.locator('#backupFile').setInputFiles(backupPath);
  await page.locator('#restoreReceipt').fill(await readFile(receiptPath,'utf8'));
  await page.locator('#restoreBackup').click();await page.locator('#openApp').waitFor({state:'visible',timeout:120000});
  let restored=await snapshot(page);
  assert.notEqual(restored.pointer.storeId,before.pointer.storeId,'Recovery uses a fresh isolated identity');
  assert.deepEqual(restored.files,expectedFiles,'All externally backed-up Workspace bytes must restore');
  if(advancedRecovery){
   await page.waitForFunction(()=>/persistence.*NOT guaranteed/i.test(document.querySelector('#result').textContent));
   await(await context.newCDPSession(page)).send('Browser.resetPermissions');
   assert.match(backup.workspaceId,/^[0-9a-f-]{36}$/);
   assert.equal(restored.pointer.workspaceId,backup.workspaceId,'Logical Workspace identity must survive complete origin loss');
   const firstPhysicalId=restored.pointer.storeId;
   await page.locator('#backupFile').setInputFiles(backupPath);await page.locator('#restoreReceipt').fill(receipt);
   await page.locator('#restoreBackup').click();
   await page.waitForFunction(id=>JSON.parse(localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1')).storeId!==id,firstPhysicalId,{timeout:120000});
   restored=await snapshot(page);
   assert.equal(restored.pointer.workspaceId,backup.workspaceId,'An older matching receipt must still identify the same recovered Workspace');
   assert.deepEqual(restored.files,expectedFiles,'Repeated verified recovery must preserve every imported/manual byte');
   console.log(JSON.stringify({logicalWorkspaceIdentityPreserved:true,matchingOriginalReceiptReusable:true,freshPhysicalIdentity:true}));
  }
  const restoredApp=new URL(await page.locator('#openApp').getAttribute('href'),url).href;
  await page.goto(restoredApp);if(!fullJourney)await page.locator('#connectButton').click();
  await page.waitForFunction(()=>!document.body.innerText.includes('Connect Service Operations Dashboard to begin')).catch(async error=>{console.error('CONNECT FAILURE',await page.locator('body').innerText());throw error;});
 await page.waitForFunction(()=>document.querySelector('#folderWatchStatus')?.textContent.startsWith('REPORT INBOX WATCHING'));
 await settledSnapshot(page);
  if(process.env.PWA_SAPR==='1'){
   assertOperational(await readOperational(page));
   await page.getByRole('button',{name:'Advisor Performance',exact:true}).click();
   assert.ok((await page.locator('#view-performance').innerText()).includes('Current MTD: $'+STORE_GROSS.toLocaleString('en-US')));
   assert.ok((await page.locator('#view-performance').innerText()).includes('Month pace: $'+STORE_PACE.toLocaleString('en-US')));
  }
  await assertPublishedViews(page);
  console.log(JSON.stringify({storageLossRecovery:true,externalBackup:true,separateReceipt:true,missingBackupRefused:true,tamperedReceiptRefused:true,tamperedBackupRefused:true,wrongStoreReceiptRefused:true,restoredFiles:expectedFiles.length}));
 }
 if(process.env.PWA_BETA==='1'){
  // Test public Beta update and rollback in the same isolated SYNTHETIC origin.
  await context.setOffline(false);
  const beforeBeta=await settledSnapshot(page);
  if(process.env.PWA_SAPR==='1')assertOperational(await readOperational(page));
  await page.goto(management);await page.locator('#consent').check();
  await page.locator('#checkBeta').click();
  await page.waitForFunction(()=>{
   const value=document.querySelector('#betaStatus')?.textContent||'';
   return !document.querySelector('#installBeta')?.disabled||/refused/i.test(value);
  },null,{timeout:120000});
  assert.equal(await page.locator('#installBeta').isEnabled(),true,
   'Pinned official Beta must be authenticated before update is offered.');
  if(advancedRecovery){
   // Fault only public package delivery; exercise the unchanged published
   // Install button and verifier, never substitute candidate application code.
   const packageRoute=/^https:\/\/raw\.githubusercontent\.com\/JHFMoon\/MoonDog-Service-OS\/[a-f0-9]{40}\/updates\/packages\/moondog-[^/]+\.json$/;
   const originalHref=await page.locator('#openApp').getAttribute('href');
   for(const fault of ['download','checksum']){
    let intercepted=0;
    const handler=async route=>{intercepted++;await route.fulfill({status:fault==='download'?503:200,
     contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{}'});};
    await context.route(packageRoute,handler);
    try{
     await page.locator('#installBeta').click();
     await page.waitForFunction(()=>/Beta installation was refused or incomplete/.test(document.querySelector('#betaStatus').textContent),null,{timeout:120000});
     assert.ok(intercepted>0,'Fault must affect an actual pinned public package request');
     if(fault==='checksum')assert.match(await page.locator('#betaStatus').innerText(),/SHA-256 mismatch/);
     assert.equal(await page.locator('#openApp').getAttribute('href'),originalHref,'Refused update must retain original software authority');
     assert.deepEqual(await snapshot(page),beforeBeta,'Refused update must preserve every original Workspace byte');
    }finally{await context.unroute(packageRoute,handler);}
   }
   console.log(JSON.stringify({failedUpdateDownloadRefused:true,corruptUpdateChecksumRefused:true,originalSoftwareSelected:true,workspaceByteExact:true}));
  }
  if(fullJourney){
   // A genuine public-module stage writes the verified package first. Model
   // an interruption before activation, then use the ordinary Install UI to
   // complete its authenticated missing-file subset without overwriting it.
   const originalHref=await page.locator('#openApp').getAttribute('href');
   const interrupted=await page.evaluate(async()=>{
    const p=JSON.parse(localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1'));
    const {stageVerifiedBetaBrowserSoftware}=await import('./modules/browser_software_candidates.mjs');
    const staged=await stageVerifiedBetaBrowserSoftware({storage:navigator.storage,crypto,locks:navigator.locks,
     storeId:p.storeId,installedVersion:p.version,installedManifestHash:p.manifestHash,fetchImpl:fetch});
    let d=await navigator.storage.getDirectory();
    for(const name of ['MoonDog-PWA-v1','software-candidates-v2',p.storeId,staged.version+'-'+staged.zipHash])d=await d.getDirectoryHandle(name);
    const marker=await d.getFileHandle('STAGING-INCOMPLETE.json',{create:true});const writer=await marker.createWritable();
    await writer.write('INCOMPLETE');await writer.close();
    const assets=await d.getDirectoryHandle('System Files').then(folder=>folder.getDirectoryHandle('assets'));
    await assets.removeEntry('app.js');
    return {version:staged.version,zipHash:staged.zipHash};
   });
   assert.deepEqual(await snapshot(page),beforeBeta,'Interrupted software staging must not alter the Workspace');
   if(advancedRecovery){
    await context.close();context=null;context=await launch();page=await context.newPage();
    await page.goto(management);await page.locator('#openApp').waitFor({state:'visible',timeout:60000});
    assert.equal(await page.locator('#openApp').getAttribute('href'),originalHref,'Restart during staging must retain the verified original selection');
    assert.deepEqual(await snapshot(page),beforeBeta,'Restart during staging must preserve every Workspace byte');
    await page.evaluate(async staged=>{
     const p=JSON.parse(localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1'));
     let d=await navigator.storage.getDirectory();
     for(const name of ['MoonDog-PWA-v1','software-candidates-v2',p.storeId,staged.version+'-'+staged.zipHash])d=await d.getDirectoryHandle(name);
     if(await(await(await d.getFileHandle('STAGING-INCOMPLETE.json')).getFile()).text()!=='INCOMPLETE')throw Error('Interrupted staging marker must survive real process restart');
     const assets=await d.getDirectoryHandle('System Files').then(folder=>folder.getDirectoryHandle('assets'));
     try{await assets.getFileHandle('app.js');throw Error('Interrupted runtime must remain incomplete until explicit retry');}
     catch(error){if(error.name!=='NotFoundError')throw error;}
    },interrupted);
    await page.locator('#consent').check();await page.locator('#checkBeta').click();
    await page.waitForFunction(()=>!document.querySelector('#installBeta').disabled,null,{timeout:120000});
    console.log(JSON.stringify({interruptedUpdateProcessRestart:true,incompleteCandidateRetained:true,originalSoftwareSelected:true,workspaceByteExact:true}));
   }
  }
  await page.locator('#installBeta').click();
  await page.waitForFunction(()=>{
   const value=document.querySelector('#betaStatus')?.textContent||'';
   return /selected\.|refused|incomplete/i.test(value);
  },null,{timeout:120000});
  assert.match(await page.locator('#betaStatus').innerText(),/Beta .* selected\./);
  assert.deepEqual(await snapshot(page),beforeBeta,'Software staging/selection must not change any Workspace byte');
  const betaUrl=new URL(await page.locator('#openApp').getAttribute('href'),url).href;
  assert.match(betaUrl,/\/0\.10\.18-beta\.\d+\/index\.html$/);
  assert.equal(await page.locator('#rollbackBeta').isEnabled(),true);
  await page.goto(betaUrl);if(!fullJourney)await page.locator('#connectButton').click();
  await page.waitForFunction(()=>!document.body.innerText.includes('Connect Service Operations Dashboard to begin'));
  await page.waitForFunction(()=>document.querySelector('#folderWatchStatus')?.textContent.startsWith('REPORT INBOX WATCHING'));
  assertLifecyclePreservation(beforeBeta,await settledSnapshot(page),'Beta app launch');
  if(process.env.PWA_SAPR==='1'){assertOperational(await readOperational(page));await assertPublishedViews(page);}
  if(advancedRecovery){
   assert.ok(saprWorkbookBytes,'Actual SAPR workbook required for scheduled intake proof');
   await settledSnapshot(page);await context.close();context=null;
   context=await launch();await context.setOffline(true);page=await context.newPage();
   await page.goto(new URL('icon.svg',url).href);
   assert.equal(await page.evaluate(async()=>
    (await navigator.locks.query()).held.some(lock=>lock.name?.startsWith('moondog-pwa-operational-'))),false,
    'Deliver queued fixture only while no application owns a Workspace');
   const scheduledName='synthetic-scheduled-sapr.xlsx';
   const signature=await page.evaluate(async({name,bytes})=>{
    const p=JSON.parse(localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1'));
    let d=await navigator.storage.getDirectory();
    for(const n of ['MoonDog-PWA-v1','stores',p.storeId,'System Files','Workspace','01 - DROP REPORTS HERE'])d=await d.getDirectoryHandle(n);
    const h=await d.getFileHandle(name,{create:true}),w=await h.createWritable();await w.write(new Uint8Array(bytes));await w.close();
    const f=await h.getFile();return '01 - DROP REPORTS HERE/'+name+'|'+f.size+'|'+f.lastModified;
   },{name:scheduledName,bytes:Array.from(saprWorkbookBytes)});
   const inboxState=async target=>target.evaluate(async signature=>{
    const p=JSON.parse(localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1'));
    let d=await navigator.storage.getDirectory();for(const n of ['MoonDog-PWA-v1','stores',p.storeId,'System Files','Workspace','data'])d=await d.getDirectoryHandle(n);
    const ledger=JSON.parse(await(await(await d.getFileHandle('auto-import.json')).getFile()).text());return ledger.seen?.[signature]||null;
   },signature);
   assert.equal(await inboxState(page),null,'New queued source must not have been processed before shutdown');
   const queued=await snapshot(page),originalImports=(await readOperational(page)).imports;
   const relaunchBeta=async verifyClosed=>{
    await context.close();context=null;
    if(verifyClosed)await new Promise(resolve=>setTimeout(resolve,17000));
    context=await launch();await context.setOffline(true);
    const control=await context.newPage();
    // A cached inert SVG establishes the origin without executing the app.
    // Read durable state before any dashboard or scheduler is launched.
    await control.goto(new URL('icon.svg',url).href);
    if(verifyClosed){
     assert.deepEqual(await snapshot(control),queued,'Browser-closed interval must not execute imports or mutate Workspace bytes');
     assert.equal(await inboxState(control),null);
    }
    const native=await context.newCDPSession(control),opened=context.waitForEvent('page');
    await native.send('PWA.launch',{manifestId:nativeManifestId});page=await opened;await control.close();
    await page.waitForURL(betaUrl,{timeout:60000});await page.bringToFront();
    assert.equal(await page.evaluate(()=>matchMedia('(display-mode: standalone)').matches),true);
    await page.waitForFunction(()=>document.querySelector('#folderWatchStatus')?.textContent.startsWith('REPORT INBOX WATCHING'));
   };
   await relaunchBeta(true);
   await page.waitForFunction(async signature=>{
    const p=JSON.parse(localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1'));
    let d=await navigator.storage.getDirectory();for(const n of ['MoonDog-PWA-v1','stores',p.storeId,'System Files','Workspace','data'])d=await d.getDirectoryHandle(n);
    const value=JSON.parse(await(await(await d.getFileHandle('auto-import.json')).getFile()).text());
    return value.seen?.[signature]?.manualImportRequired===true;
   },signature,{polling:1000,timeout:60000});
   assert.equal((await readOperational(page)).imports,originalImports,'Unsigned SAPR cannot gain import authority from a watcher poll');
   assertOperational(await readOperational(page));
   await context.setOffline(false);
   await page.getByRole('button',{name:'Tools',exact:true}).click();
   await page.getByRole('button',{name:'Import or refresh data',exact:true}).click();
   await page.locator('#dailyTools input[type=file]').setInputFiles({name:scheduledName,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:saprWorkbookBytes});
   await page.waitForFunction(async signature=>{
    const p=JSON.parse(localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1'));
    let d=await navigator.storage.getDirectory();for(const n of ['MoonDog-PWA-v1','stores',p.storeId,'System Files','Workspace','data'])d=await d.getDirectoryHandle(n);
    const value=JSON.parse(await(await(await d.getFileHandle('auto-import.json')).getFile()).text());
    return value.seen?.[signature]?.manualImportRequired===false;
   },signature,{polling:1000,timeout:60000});
   await settledSnapshot(page);
   const accepted=await inboxState(page);assert.equal(accepted.sourceStoreConfidence,'configured-destination-only');
   const acceptedImports=(await readOperational(page)).imports;
   assert.equal(acceptedImports,originalImports+1,'Only explicit review may create the one durable SAPR import');
   await relaunchBeta(false);
   await page.waitForTimeout(32000); // Two real 15-second scheduler intervals.
   assert.equal((await readOperational(page)).imports,acceptedImports,'Restarted polling must not replay the reviewed SAPR');
   assert.deepEqual(await inboxState(page),accepted,'Durable source authority must survive browser restart unchanged');
   assertOperational(await readOperational(page));await assertPublishedViews(page);
   await context.setOffline(false);
   console.log(JSON.stringify({scheduledSaprAfterRestart:true,browserClosedNoExecution:true,unsignedSourceHeld:true,explicitSourceReviewRequired:true,exactSourceLedgerPreserved:true,duplicateImportPrevented:true,cpGross:STORE_GROSS}));
  }
  const beforeRollback=await settledSnapshot(page);
  await page.goto(management);await page.locator('#consent').check();
  await page.waitForFunction(async()=>{
   const state=await navigator.locks.query();
   return !state.held.some(item=>item.name?.startsWith('moondog-pwa-operational-'));
  },null,{timeout:15000});
  await page.locator('#rollbackBeta').click();
  await page.waitForFunction(()=>/restored|refused/i.test(document.querySelector('#betaStatus')?.textContent||''),null,{timeout:30000});
  assert.match(await page.locator('#betaStatus').innerText(),/original Stable .* restored/);
  assert.deepEqual(await snapshot(page),beforeRollback,'Software rollback must not change any Workspace byte');
  const stableUrl=new URL(await page.locator('#openApp').getAttribute('href'),url).href;
  assert.notEqual(stableUrl,betaUrl,'Rollback must restore original version-bound URL');
  await page.goto(stableUrl);if(!fullJourney)await page.locator('#connectButton').click();
  await page.waitForFunction(()=>!document.body.innerText.includes('Connect Service Operations Dashboard to begin'));
  await page.waitForFunction(()=>document.querySelector('#folderWatchStatus')?.textContent.startsWith('REPORT INBOX WATCHING'));
  assertLifecyclePreservation(beforeRollback,await settledSnapshot(page),'Original app after rollback');
  if(process.env.PWA_SAPR==='1'){assertOperational(await readOperational(page));await assertPublishedViews(page);}
  if(fullJourney){
   const preserved=await settledSnapshot(page);
   await page.goto(management);
   await page.waitForFunction(async()=>!(await navigator.locks.query()).held.some(lock=>lock.name?.startsWith('moondog-pwa-operational-')));
   // Simulate an interrupted selector commit in this disposable profile only.
   // Exercise the published refusal and explicit recovery UI, not a helper mock.
   await page.evaluate(async()=>{
    const p=JSON.parse(localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1'));
    let d=await navigator.storage.getDirectory();
    for(const name of ['MoonDog-PWA-v1','software-selections',p.storeId])d=await d.getDirectoryHandle(name,{create:true});
    const f=await d.getFileHandle('ACTIVE.json',{create:true});const writer=await f.createWritable();
    await writer.write('{');await writer.close();
   });
   await page.reload();
   await page.waitForFunction(()=>!document.querySelector('#recoverOriginal').disabled);
   assert.equal(await page.locator('#openApp').isHidden(),true,'Damaged software authority must not silently open a generation');
   await page.locator('#consent').check();
   await page.locator('#recoverOriginal').evaluate(el=>{el.closest('details').open=true;});
   await page.locator('#recoverOriginal').click();
   await page.waitForFunction(()=>/original Stable .* recovered/.test(document.querySelector('#betaStatus').textContent));
   assert.deepEqual(await snapshot(page),preserved,'Interrupted selection recovery must preserve all Workspace bytes');
   console.log(JSON.stringify({interruptedSelectionRefused:true,explicitOriginalRecovery:true,workspaceUnchanged:true}));
  }
  console.log(JSON.stringify({betaUiVerified:true,pinnedBetaSelected:true,betaDashboardLaunched:true,
   rollbackVerified:true,interruptedCandidateCompleted:fullJourney,softwareOperationsPreserveEveryWorkspaceByte:true,operationalDataAndHistoryPreserved:true,storeIdentityUnchanged:true}));
 }
 assert.deepEqual(runtimeErrors,[],'Published application must not have unhandled runtime errors');
 if(process.env.PROOF_MODE==='exact-main')assert.equal(fullJourney,true,'Published website must use the application entry, not the developer harness');
 console.log(JSON.stringify({mainSha:sha,browser:process.env.BROWSER_CHANNEL||'Chromium',candidateInitializer,fullJourney,syntheticStore:STORE_CODE,overlappingAdvisor:'101',nativePwaInstalled,nativeOfflineRelaunch:true,automaticWorkspaceConnection:fullJourney,processRestart:true,offlineDashboard:true,workspaceFiles:before.files.length,operationalDataAndHistoryPreserved:true,lifecycleBookkeepingVerified:true}));
}catch(error){const p=context?.pages().at(-1);if(p){console.error('Synthetic acceptance failure state:',(await p.locator('body').innerText()).slice(0,10000));console.error('Synthetic editor event trace:',JSON.stringify(await p.evaluate(()=>({focus:document.activeElement?.id,events:window.__syntheticEditorTrace||[]}))));}throw error;}finally{await context?.close();await rm(profile,{recursive:true,force:true});}

// A SECOND clean browser profile runs the same production setup/import/restart
// journey with the same advisor ID and different dealership identity/totals.
// No fixture bytes or initialized Workspace are copied between installations.
if(!secondary&&process.env.PWA_SAPR==='1'){
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),base,sha],{
   env:{...process.env,PWA_SECOND_STORE:'1',PWA_BETA:'0',PWA_RECOVERY:'0'},stdio:'inherit'});
  child.on('error',reject);
  child.on('exit',code=>code===0?resolve():reject(Error('Second independent synthetic store acceptance failed: '+code)));
 });
 console.log(JSON.stringify({twoIndependentStores:true,cleanProfiles:true,overlappingAdvisorIdentifiers:true,distinctStoreTotals:true}));
}
