#!/usr/bin/env node
// Synthetic isolated-profile proof. Never uses a person's browser profile.
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
const [base,sha]=process.argv.slice(2);
assert.match(sha||'',/^[a-f0-9]{40}$/);
const url=new URL('web-preview/',base).href;
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
 assert.equal(value.store.name,'SYNTHETIC Alpha Motors');assert.equal(value.store.code,'9001');
 assert.equal(value.snapshot.store.cpGross,500);assert.equal(value.snapshot.store.cpRO,5);
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
 await page.goto(url);await page.locator('#consent').check();
 await page.locator('#installFromWeb').click({timeout:60000});
 await page.locator('#openApp').waitFor({state:'visible',timeout:120000});
 let candidateInitializer=false;
 if(process.env.PWA_CANDIDATE_INITIALIZER==='1'&&process.env.PWA_SAPR==='1'){
  const source=await readFile(new URL('../src/pwa/initialize_fresh_browser_workspace.mjs',import.meta.url),'utf8');
  const absolute=source.replace("'./install_verified_browser_store.mjs'",JSON.stringify(new URL('modules/install_verified_browser_store.mjs',url).href));
  candidateInitializer=await page.evaluate(async code=>{
   const p=JSON.parse(localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1'));
   let d=await navigator.storage.getDirectory();for(const n of ['MoonDog-PWA-v1','stores',p.storeId,'System Files','Workspace','data'])d=await d.getDirectoryHandle(n);
   try{const settings=JSON.parse(await(await(await d.getFileHandle('settings.json')).getFile()).text());if(settings.sourceAdapters?.schemaVersion===1)return false;}
   catch(error){if(error.name!=='NotFoundError')throw error;}
   const blob=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
   try{const api=await import(blob);await api.initializeFreshBrowserWorkspace({storage:navigator.storage,crypto,locks:navigator.locks,storeId:p.storeId,version:p.version,expectedManifestHash:p.manifestHash});}
   finally{URL.revokeObjectURL(blob);}return true;
  },absolute);
 }
 let before;
 const appUrl=new URL(await page.locator('#openApp').getAttribute('href'),url).href;
 await page.goto(appUrl);await page.waitForLoadState('load');
 assert.match(await page.title(),/dashboard|MoonDog|service/i);
 await page.locator('#connectButton').click();
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
  await saveField('#storeName','SYNTHETIC Alpha Motors');
  await saveField('#storeCode','9001');
  await saveField('#storeTimeZone','America/Los_Angeles',true);
  await page.evaluate(async()=>{
   const pointer=JSON.parse(localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1'));
   const root=await navigator.storage.getDirectory();
   const bucket=await root.getDirectoryHandle('MoonDog-PWA-v1');const stores=await bucket.getDirectoryHandle('stores');
   const store=await stores.getDirectoryHandle(pointer.storeId);const sys=await store.getDirectoryHandle('System Files');
   const ws=await sys.getDirectoryHandle('Workspace');const inbox=await ws.getDirectoryHandle('01 - DROP REPORTS HERE',{create:true});
   const metrics=[['Days Completed 8 out of 22'],['Total Gross',500,null,null,null,null,700],['Total Revenue',1000,null,null,null,null,1400],['RO Count',5,null,null,null,null,7],['Hours per RO',2],['ELR',100]];
   const book=XLSX.utils.book_new();
   const benchmark=label=>[label,...Array.from({length:7},()=>[25,30,40,null,null]).flat()];
   XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Service Advisor Performance From 11/01/2026 to 11/19/2026'],...metrics]),'Store');
   XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Synthetic Advisor [101]'],...metrics]),'Advisor');
   XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([[],['Tires','Brakes'],[],[],[],benchmark('9001 - SYNTHETIC Alpha Motors'),benchmark('Synthetic Advisor [101]')]),'Controllables');

   const bytes=XLSX.write(book,{type:'array',bookType:'xlsx'});
   const f=await inbox.getFileHandle('synthetic-sapr.xlsx',{create:true});const writer=await f.createWritable();await writer.write(bytes);await writer.close();
  });
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
  assert.match(await page.locator('#view-performance').innerText(),/Current MTD: \$500/);
  assert.match(await page.locator('#view-performance').innerText(),/Month pace: \$1,375/);
 }
 before=await settledSnapshot(page);
 if(process.env.PWA_SAPR==='1')assertOperational(await readOperational(page));
 await context.close();context=null; // Actual Chromium process termination, same disk profile.
 context=await launch();await context.setOffline(true);page=await context.newPage();
 await page.goto(url);await page.locator('#openApp').waitFor({state:'visible',timeout:30000});
 assert.deepEqual(await snapshot(page),before,'Restart must preserve Workspace and software authority');
 const response=await page.goto(appUrl);assert.equal(response.status(),200);
 assert.match(await page.title(),/dashboard|MoonDog|service/i);
 // Ensure real application HTML, not setup or worker failure page.
 await page.locator('#connectButton').click();
 await page.waitForFunction(()=>!document.body.innerText.includes('Connect Service Operations Dashboard to begin')).catch(async error=>{console.error('CONNECT FAILURE',await page.locator('body').innerText());throw error;});
 await page.waitForFunction(()=>document.querySelector('#folderWatchStatus')?.textContent.startsWith('REPORT INBOX WATCHING'));
 await settledSnapshot(page);
 assert.match(await page.locator('body').innerText(),/Guided Setup|Home|Advisor/i);
 if(process.env.PWA_SAPR==='1'){
  await page.getByRole('button',{name:'Advisor Performance',exact:true}).click();
  assert.match(await page.locator('#view-performance').innerText(),/Current MTD: \$500/);
  assert.match(await page.locator('#view-performance').innerText(),/Month pace: \$1,375/);
  await settledSnapshot(page);assertOperational(await readOperational(page));
  console.log(JSON.stringify({saprRestart:true,cpGross:500,monthPace:1375,guidedSetup:true}));
 }

 if(process.env.PWA_RECOVERY==='1'){
  await settledSnapshot(page);
  await context.setOffline(false);await page.goto(url);await page.locator('#consent').check();
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
  await page.close();page=await context.newPage();await page.goto(url);
  assert.equal(await page.evaluate(()=>localStorage.getItem('moondog-pwa-synthetic-preview-pointer-v1')),null);
  assert.equal(await page.evaluate(async()=>{const root=await navigator.storage.getDirectory();let n=0;for await(const _ of root.entries())n++;return n;}),0);
  assert.equal(await page.locator('#openApp').isHidden(),true);
  await page.locator('#consent').check();await page.locator('details').last().locator('summary').click();
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
  await page.goto(restoredApp);await page.locator('#connectButton').click();
  await page.waitForFunction(()=>!document.body.innerText.includes('Connect Service Operations Dashboard to begin')).catch(async error=>{console.error('CONNECT FAILURE',await page.locator('body').innerText());throw error;});
 await page.waitForFunction(()=>document.querySelector('#folderWatchStatus')?.textContent.startsWith('REPORT INBOX WATCHING'));
 await settledSnapshot(page);
  if(process.env.PWA_SAPR==='1'){
   assertOperational(await readOperational(page));
   await page.getByRole('button',{name:'Advisor Performance',exact:true}).click();
   assert.match(await page.locator('#view-performance').innerText(),/Current MTD: \$500/);
   assert.match(await page.locator('#view-performance').innerText(),/Month pace: \$1,375/);
  }
  console.log(JSON.stringify({storageLossRecovery:true,externalBackup:true,separateReceipt:true,missingBackupRefused:true,tamperedReceiptRefused:true,tamperedBackupRefused:true,wrongStoreReceiptRefused:true,restoredFiles:expectedFiles.length}));
 }
 console.log(JSON.stringify({mainSha:sha,browser:process.env.BROWSER_CHANNEL||'Chromium',candidateInitializer,processRestart:true,offlineDashboard:true,workspaceFiles:before.files.length,workspaceUnchanged:true}));
}catch(error){const p=context?.pages().at(-1);if(p)console.error('Synthetic acceptance failure state:',(await p.locator('body').innerText()).slice(0,10000));throw error;}finally{await context?.close();await rm(profile,{recursive:true,force:true});}
