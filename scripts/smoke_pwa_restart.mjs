#!/usr/bin/env node
// Synthetic isolated-profile proof. Never uses a person's browser profile.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
const [base,sha]=process.argv.slice(2);
assert.match(sha||'',/^[a-f0-9]{40}$/);
const url=new URL('web-preview/',base).href;
const profile=await mkdtemp(join(tmpdir(),'moondog-synthetic-restart-'));
let context;
const launch=()=>chromium.launchPersistentContext(profile,{headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
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
 console.log(JSON.stringify({mainSha:sha,browser:'Chromium',processRestart:true,offlineDashboard:true,workspaceFiles:before.files.length,workspaceUnchanged:true}));
}finally{await context?.close();await rm(profile,{recursive:true,force:true});}
