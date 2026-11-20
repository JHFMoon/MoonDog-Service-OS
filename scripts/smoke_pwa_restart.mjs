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
try{
 context=await launch();let page=await context.newPage();
 await page.goto(new URL('site-version.json',base).href);
 const metadata=JSON.parse(await page.locator('body').innerText());
 assert.equal(metadata.mainSha,sha,'Published SHA must match requested main');
 await page.goto(url);await page.locator('#consent').check();
 await page.locator('#installFromWeb').click({timeout:60000});
 await page.locator('#openApp').waitFor({state:'visible',timeout:120000});
 let before;
 const appUrl=new URL(await page.locator('#openApp').getAttribute('href'),url).href;
 await page.goto(appUrl);await page.waitForLoadState('load');
 assert.match(await page.title(),/dashboard|MoonDog|service/i);
 await page.getByRole('button',{name:'Connect working folder',exact:true}).click();
 await page.waitForFunction(()=>!document.body.innerText.includes('Connect Service Operations Dashboard to begin'));
 await page.goto(url);
 // Snapshot only after application writes have settled and its tab is closed.
 let prior=null;
 for(let attempt=0;attempt<40;attempt++){
  const current=await snapshot(page);
  if(JSON.stringify(current)===JSON.stringify(prior)){before=current;break;}
  prior=current;await page.waitForTimeout(500);
 }
 assert.ok(before,'Workspace writes must settle before restart');
 await context.close();context=null; // Actual Chromium process termination, same disk profile.
 context=await launch();await context.setOffline(true);page=await context.newPage();
 await page.goto(url);await page.locator('#openApp').waitFor({state:'visible',timeout:30000});
 assert.deepEqual(await snapshot(page),before,'Restart must preserve Workspace and software authority');
 const response=await page.goto(appUrl);assert.equal(response.status(),200);
 assert.match(await page.title(),/dashboard|MoonDog|service/i);
 // Ensure real application HTML, not setup or worker failure page.
 await page.getByRole('button',{name:'Connect working folder',exact:true}).click();
 await page.waitForFunction(()=>!document.body.innerText.includes('Connect Service Operations Dashboard to begin'));
 assert.match(await page.locator('body').innerText(),/Guided Setup|Home|Advisor/i);
 if(process.env.PWA_RECOVERY==='1'){
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
  await page.goto(restoredApp);await page.getByRole('button',{name:'Connect working folder',exact:true}).click();
  await page.waitForFunction(()=>!document.body.innerText.includes('Connect Service Operations Dashboard to begin'));
  console.log(JSON.stringify({storageLossRecovery:true,externalBackup:true,separateReceipt:true,missingBackupRefused:true,tamperedReceiptRefused:true,tamperedBackupRefused:true,wrongStoreReceiptRefused:true,restoredFiles:expectedFiles.length}));
 }
 console.log(JSON.stringify({mainSha:sha,browser:process.env.BROWSER_CHANNEL||'Chromium',processRestart:true,offlineDashboard:true,workspaceFiles:before.files.length,workspaceUnchanged:true}));
}finally{await context?.close();await rm(profile,{recursive:true,force:true});}
