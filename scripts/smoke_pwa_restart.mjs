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
const STORE_GROSS=secondary?700:500;
const STORE_PACE=STORE_GROSS/8*22;
const [base,sha]=process.argv.slice(2);
assert.match(sha||'',/^[a-f0-9]{40}$/);
const url=new URL('web-preview/',base).href;
let management=url;
const profile=await mkdtemp(join(tmpdir(),'moondog-synthetic-restart-'));
let context;
const launch=()=>chromium.launchPersistentContext(profile,{headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{}),...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const snapshot=async page=>page.evaluate(async()=>{
 const p=JSON.parse(localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1'));
 const root=await navigator.storage.getDirectory();
 const bucket=await root.getDirectoryHandle('MoonDog-PWA-v1');
 const stores=await bucket.getDirectoryHandle('stores');
 const store=await stores.getDirectoryHandle(p.storeId);
 const system=await store.getDirectoryHandle('System Files');
 const ws=await system.getDirectoryHandle('Workspace');
 const files=[];
 async function walk(dir,prefix=''){
  for await(const [name,h] of dir.entries()){
   if(h.kind==='directory')await walk(h,prefix+name+'/');
   else {const bytes=await(await h.getFile()).arrayBuffer();const hash=await crypto.subtle.digest('SHA-256',bytes);
    files.push([prefix+name,Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')]);}
  }
 }
 await walk(ws);return {pointer:p,files:files.sort()};
});
const readOperational=async page=>page.evaluate(async()=>{
 const p=JSON.parse(localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1'));
 let d=await navigator.storage.getDirectory();
 for(const n of ['MoonDog-PWA-v1','stores',p.storeId,'System Files','Workspace','data'])d=await d.getDirectoryHandle(n);
 const json=async n=>{try{return JSON.parse(await(await(await d.getFileHandle(n)).getFile()).text());}catch(error){throw Error('Durable '+n+': '+error);}};
 const performance=await json('advisor-performance.json'),settings=await json('settings.json');
 const history=await d.getDirectoryHandle('history').catch(error=>{throw Error('History directory: '+error);});let imports=0;
 for await(const [name,h] of history.entries())if(h.kind==='file'&&name.endsWith('.json')&&!name.startsWith('.moondog-txn-')){
  let event;try{event=JSON.parse(await(await h.getFile()).text());}catch(error){throw Error('History event '+name+': '+error);}if(event.type==='performance-import')imports++;
 }
 return {store:settings.store,snapshot:performance.snapshots['2026-11-19'],imports};
});
function assertOperational(value){
 assert.equal(value.store.name,STORE_NAME);assert.equal(value.store.code,STORE_CODE);
 assert.equal(value.snapshot.store.cpGross,STORE_GROSS);assert.equal(value.snapshot.store.cpRO,5);
 assert.equal(value.snapshot.saprDaysCompleted,8);assert.equal(value.snapshot.saprTotalDays,22);
 assert.ok(value.imports>=1,'Durable import history required');
}
async function settledSnapshot(page){
 // Snapshot while the application still holds its lock; do not interrupt pending writes by navigating away.
 let prior=null,stableSamples=0;
 for(let attempt=0;attempt<120;attempt++){
  let current;try{current=await snapshot(page);}catch(error){if(!String(error).includes('NotFoundError'))throw error;stableSamples=0;await page.waitForTimeout(500);continue;}
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
 await page.goto(url);
 const fullJourney=await page.locator('#appSettings').count()>0;
 if(fullJourney)management=new URL('index.html?manage=1',url).href;
 if(process.env.PROOF_MODE==='exact-main')assert.equal(fullJourney,true,'Published website must use the application entry, not the developer harness');
 let nativePwaInstalled=false;
 if(fullJourney){
  assert.equal(await page.locator('#appSettings').isHidden(),true,'Engineering controls must not appear during normal installation');
  assert.equal(await page.locator('input[type=file]:visible').count(),0,'No ZIP or folder selection in normal setup');
 }
 {
  // Native installation is verified even on a published-baseline PR run.
  // This proves the browser driver before the new entry UI is published.
  const browser=await context.newCDPSession(page);
  const manifest=await browser.send('Page.getAppManifest');
  assert.equal(manifest.errors.length,0,'Native app manifest must be valid');
  assert.match(JSON.parse(manifest.data).name,/MoonDog/);
  if(fullJourney)assert.equal(JSON.parse(manifest.data).name,'MoonDog Service OS');
  await browser.send('PWA.install',{manifestId:url,installUrlOrBundleUrl:url});
  await browser.send('PWA.getOsAppState',{manifestId:url});
  await browser.send('PWA.changeAppUserSettings',{manifestId:url,displayMode:'standalone'});
  const opened=context.waitForEvent('page');
  await browser.send('PWA.launch',{manifestId:url});
  const installed=await opened;await page.close();page=installed;
  await page.waitForLoadState('domcontentloaded');
  assert.equal(await page.evaluate(()=>matchMedia('(display-mode: standalone)').matches),true,'Installed MoonDog must launch as an app');
  nativePwaInstalled=true;
 }
 await page.locator('#consent').check();
 await page.locator('#installFromWeb').click({timeout:60000});
 if(fullJourney)await page.waitForURL(/\/store\/.*\/index\.html$/,{timeout:120000});
 else await page.locator('#openApp').waitFor({state:'visible',timeout:120000});
 const candidateInitializer=false; // Published runtime only: no PR-only code injection.
 let before;
 const appUrl=fullJourney?page.url():new URL(await page.locator('#openApp').getAttribute('href'),url).href;
 if(!fullJourney)await page.goto(appUrl);await page.waitForLoadState('load');
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
  await page.locator('#dailyTools input[type=file]').setInputFiles({name:'synthetic-sapr.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(sourceBytes)});
  await page.waitForFunction(()=>document.querySelector('#performancePeriod').textContent.includes('2026'),{},{timeout:30000});
  await settledSnapshot(page);assertOperational(await readOperational(page));
  await page.getByRole('button',{name:'Tools',exact:true}).click();
  await page.getByRole('button',{name:'Import or refresh data',exact:true}).click();
  await page.getByRole('button',{name:/report.*setup/i}).click();
  await page.locator('#completeSetup').click();
  await page.getByRole('button',{name:'Advisor Performance',exact:true}).click();
  assert.ok((await page.locator('#view-performance').innerText()).includes('Current MTD: $'+STORE_GROSS.toLocaleString('en-US')));
  assert.ok((await page.locator('#view-performance').innerText()).includes('Month pace: $'+STORE_PACE.toLocaleString('en-US')));
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
 context=await launch();await context.setOffline(true);page=await context.newPage();
 if(fullJourney){
  await page.goto(url);await page.waitForURL(/\/store\/.*\/index\.html$/,{timeout:30000});
 }else{await page.goto(management);await page.locator('#openApp').waitFor({state:'visible',timeout:30000});}
 assert.deepEqual(await snapshot(page),before,'Restart must preserve Workspace and software authority');
 const response=await page.goto(appUrl);assert.equal(response.status(),200);
 assert.match(await page.title(),/dashboard|MoonDog|service/i);
 // Ensure real application HTML, not setup or worker failure page.
 if(!fullJourney)await page.locator('#connectButton').click();
 await page.waitForFunction(()=>!document.body.innerText.includes('Connect Service Operations Dashboard to begin')).catch(async error=>{console.error('CONNECT FAILURE',await page.locator('body').innerText());throw error;});
 await page.waitForFunction(()=>document.querySelector('#folderWatchStatus')?.textContent.startsWith('REPORT INBOX WATCHING'));
 await settledSnapshot(page);
 assert.match(await page.locator('body').innerText(),/Guided Setup|Home|Advisor/i);
 if(process.env.PWA_SAPR==='1'){
  await page.getByRole('button',{name:'Advisor Performance',exact:true}).click();
  assert.ok((await page.locator('#view-performance').innerText()).includes('Current MTD: $'+STORE_GROSS.toLocaleString('en-US')));
  assert.ok((await page.locator('#view-performance').innerText()).includes('Month pace: $'+STORE_PACE.toLocaleString('en-US')));
  await settledSnapshot(page);assertOperational(await readOperational(page));
  console.log(JSON.stringify({saprRestart:true,cpGross:STORE_GROSS,monthPace:STORE_PACE,guidedSetup:true}));
 }

 if(process.env.PWA_RECOVERY==='1'){
  await settledSnapshot(page);
  await context.setOffline(false);await page.goto(management);await page.locator('#consent').check();
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
  await cdp.send('Storage.clearDataForOrigin',{origin:new URL(url).origin,storageTypes:'all'});
  await page.close();page=await context.newPage();await page.goto(management);
  assert.equal(await page.evaluate(()=>localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1')),null);
  assert.equal(await page.evaluate(async()=>{const root=await navigator.storage.getDirectory();let n=0;for await(const _ of root.entries())n++;return n;}),0);
  assert.equal(await page.locator('#openApp').isHidden(),true);
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
  const restored=await snapshot(page);
  assert.notEqual(restored.pointer.storeId,before.pointer.storeId,'Recovery uses a fresh isolated identity');
  assert.deepEqual(restored.files,expectedFiles,'All externally backed-up Workspace bytes must restore');
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
  if(fullJourney){
   // A genuine public-module stage writes the verified package first. Model
   // an interruption before activation, then use the ordinary Install UI to
   // complete its authenticated missing-file subset without overwriting it.
   await page.evaluate(async()=>{
    const p=JSON.parse(localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1'));
    const {stageVerifiedBetaBrowserSoftware}=await import('./modules/browser_software_candidates.mjs');
    const staged=await stageVerifiedBetaBrowserSoftware({storage:navigator.storage,crypto,locks:navigator.locks,
     storeId:p.storeId,installedVersion:p.version,installedManifestHash:p.manifestHash,fetchImpl:fetch});
    let d=await navigator.storage.getDirectory();
    for(const name of ['MoonDog-PWA-v1','software-candidates',p.storeId,staged.version+'-'+staged.zipHash])d=await d.getDirectoryHandle(name);
    const marker=await d.getFileHandle('STAGING-INCOMPLETE.json',{create:true});const writer=await marker.createWritable();
    await writer.write('INCOMPLETE');await writer.close();
    const assets=await d.getDirectoryHandle('System Files').then(folder=>folder.getDirectoryHandle('assets'));
    await assets.removeEntry('app.js');
   });
   assert.deepEqual(await snapshot(page),beforeBeta,'Interrupted software staging must not alter the Workspace');
  }
  await page.locator('#installBeta').click();
  await page.waitForFunction(()=>{
   const value=document.querySelector('#betaStatus')?.textContent||'';
   return /selected\.|refused|incomplete/i.test(value);
  },null,{timeout:120000});
  assert.match(await page.locator('#betaStatus').innerText(),/Beta .* selected\./);
  const betaUrl=new URL(await page.locator('#openApp').getAttribute('href'),url).href;
  assert.match(betaUrl,/\/0\.10\.18-beta\.\d+\/index\.html$/);
  assert.equal(await page.locator('#rollbackBeta').isEnabled(),true);
  await page.goto(betaUrl);if(!fullJourney)await page.locator('#connectButton').click();
  await page.waitForFunction(()=>!document.body.innerText.includes('Connect Service Operations Dashboard to begin'));
  await page.waitForFunction(()=>document.querySelector('#folderWatchStatus')?.textContent.startsWith('REPORT INBOX WATCHING'));
  assert.deepEqual(await settledSnapshot(page),beforeBeta,
   'Beta launch must preserve every original Workspace byte and store identity');
  if(process.env.PWA_SAPR==='1')assertOperational(await readOperational(page));
  await page.goto(management);await page.locator('#consent').check();
  await page.waitForFunction(async()=>{
   const state=await navigator.locks.query();
   return !state.held.some(item=>item.name?.startsWith('moondog-pwa-operational-'));
  },null,{timeout:15000});
  await page.locator('#rollbackBeta').click();
  await page.waitForFunction(()=>/restored|refused/i.test(document.querySelector('#betaStatus')?.textContent||''),null,{timeout:30000});
  assert.match(await page.locator('#betaStatus').innerText(),/original Stable .* restored/);
  const stableUrl=new URL(await page.locator('#openApp').getAttribute('href'),url).href;
  assert.notEqual(stableUrl,betaUrl,'Rollback must restore original version-bound URL');
  await page.goto(stableUrl);if(!fullJourney)await page.locator('#connectButton').click();
  await page.waitForFunction(()=>!document.body.innerText.includes('Connect Service Operations Dashboard to begin'));
  await page.waitForFunction(()=>document.querySelector('#folderWatchStatus')?.textContent.startsWith('REPORT INBOX WATCHING'));
  assert.deepEqual(await settledSnapshot(page),beforeBeta,
   'Rollback must preserve all Workspace file bytes and original store identity');
  if(process.env.PWA_SAPR==='1')assertOperational(await readOperational(page));
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
   rollbackVerified:true,interruptedCandidateCompleted:fullJourney,originalWorkspaceUnchanged:true,storeIdentityUnchanged:true}));
 }
 console.log(JSON.stringify({mainSha:sha,browser:process.env.BROWSER_CHANNEL||'Chromium',candidateInitializer,fullJourney,syntheticStore:STORE_CODE,overlappingAdvisor:'101',nativePwaInstalled,automaticWorkspaceConnection:fullJourney,processRestart:true,offlineDashboard:true,workspaceFiles:before.files.length,workspaceUnchanged:true}));
}catch(error){const p=context?.pages().at(-1);if(p)console.error('Synthetic acceptance failure state:',(await p.locator('body').innerText()).slice(0,10000));throw error;}finally{await context?.close();await rm(profile,{recursive:true,force:true});}

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
