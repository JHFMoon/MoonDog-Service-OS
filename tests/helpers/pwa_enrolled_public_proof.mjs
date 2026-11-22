// Hosted synthetic acceptance of the explicit dealership browser path.
// No candidate source substitution, real dealership data or personal profile.
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const NAME='Example Motors (SYNTHETIC TEST ONLY)',CODE='9003',GROSS=800,PACE=2200;
const POINTER='moondog-pwa-synthetic-preview-pointer-v1';
async function until(page,predicate,arg,timeout=45000){
 const deadline=Date.now()+timeout;
 for(;;){if(await page.evaluate(predicate,arg))return;if(Date.now()>deadline)throw Error('Enrolled browser durable condition timed out');await page.waitForTimeout(100);}
}
async function rawState(page){return page.evaluate(async key=>{
 const pointer=JSON.parse(localStorage.getItem(key));let store=await navigator.storage.getDirectory();for(const part of ['MoonDog-PWA-v1','stores',pointer.storeId])store=await store.getDirectoryHandle(part);
 const identity=JSON.parse(await(await(await store.getFileHandle('STORE-IDENTITY.json')).getFile()).text());
 const workspace=await(await store.getDirectoryHandle('System Files')).getDirectoryHandle('Workspace'),data=await workspace.getDirectoryHandle('data');
 const performance=JSON.parse(await(await(await data.getFileHandle('advisor-performance.json')).getFile()).text()),settings=JSON.parse(await(await(await data.getFileHandle('settings.json')).getFile()).text());
 const optional=async name=>{try{return JSON.parse(await(await(await data.getFileHandle(name)).getFile()).text());}catch(error){if(error.name==='NotFoundError')return null;throw error;}};
 const current=await optional('current-state.json'),recovery=await optional('recovery.json');
 const files=[];async function walk(dir,prefix=''){for await(const[name,handle]of dir.entries())if(handle.kind==='directory')await walk(handle,prefix+name+'/');else{const bytes=await(await handle.getFile()).arrayBuffer();files.push([prefix+name,Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('')]);}}
 await walk(workspace);let imports=0;const history=await data.getDirectoryHandle('history');for await(const[name,handle]of history.entries())if(handle.kind==='file'&&name.endsWith('.json')&&!name.startsWith('.moondog-txn-')){const event=JSON.parse(await(await handle.getFile()).text());if(event.type==='performance-import')imports++;}
 return {pointer,identity,performance:performance.snapshots['2026-11-19'],settings,files:files.sort(),imports,record:current?.records?.find(row=>row.ro==='900001')||null,report:recovery?.supervisorWorkbook||null};
},POINTER);}
async function state(page){
 // UI navigation can finish before the final history/journal write. Observe
 // quiescent readback; never retry an import/edit or omit a private file.
 const deadline=Date.now()+60000;let prior=null,stable=0;
 while(Date.now()<deadline){
  let current;
  try{current=await rawState(page);}
  catch(error){if(!/NotFoundError|NotReadableError/.test(String(error)))throw error;stable=0;await page.waitForTimeout(500);continue;}
  const complete=!current.files.some(([name])=>name.includes('.moondog-txn-'));
  stable=complete&&JSON.stringify(current)===JSON.stringify(prior)?stable+1:0;
  if(stable>=4)return current;
  prior=current;await page.waitForTimeout(500);
 }
 throw Error('Enrolled Workspace did not reach stable transaction-free readback');
}
function assertStore(value){
 assert.equal(value.identity.enrollment.mode,'operational');assert.equal(value.identity.enrollment.store.name,NAME);assert.equal(value.identity.enrollment.store.code,CODE);
 assert.equal(value.settings.store.name,NAME);assert.equal(value.settings.store.code,CODE);assert.equal(value.performance.store.cpGross,GROSS);assert.equal(value.performance.store.cpRO,5);
 assert.equal(value.performance.saprDaysCompleted,8);assert.equal(value.performance.saprTotalDays,22);assert.equal(value.imports,1);
}
async function fillEnrollment(page){
 await page.selectOption('#workspaceMode','operational');await page.fill('#enrollmentName',NAME);await page.fill('#enrollmentCode',CODE);await page.fill('#enrollmentBrand','');await page.selectOption('#enrollmentTimeZone','America/Los_Angeles');await page.check('#consent');
}
async function installed(page){
 await page.waitForFunction(()=>!document.querySelector('#openApp').hidden||document.querySelector('#result').textContent.includes('Installation was not completed'),null,{timeout:180000});
 const message=await page.locator('#result').innerText();assert.equal(await page.locator('#openApp').isVisible(),true,message);assert.match(await page.locator('#openApp').getAttribute('href'),/-beta\.[0-9]+\/index\.html$/);
}
async function connected(page){await page.waitForFunction(()=>document.querySelector('#folderWatchStatus')?.textContent.startsWith('REPORT INBOX WATCHING'),null,{timeout:120000});}
async function views(page){
 await page.getByRole('button',{name:'Advisor Performance',exact:true}).click();
 await page.waitForFunction(({gross,pace})=>{const text=document.querySelector('#view-performance')?.textContent||'';return text.includes('Current MTD: $'+gross.toLocaleString('en-US'))&&text.includes('Month pace: $'+pace.toLocaleString('en-US'));},{gross:GROSS,pace:PACE},{timeout:30000});
}
async function publicAuthority(context,base,sha){
 const response=await context.request.get(new URL('site-version.json',base).href,{failOnStatusCode:true,headers:{'Cache-Control':'no-cache'}}),meta=await response.json();
 assert.equal(meta.mainSha,sha);assert.notEqual(meta.localCandidateOnly,true,'Local candidate cannot satisfy hosted acceptance');
}
export async function runEnrolledPublicProof({base,sha}={}){
 assert.equal(base,'https://jhfmoon.github.io/MoonDog-Service-OS/');assert.match(sha||'',/^[a-f0-9]{40}$/);
 const profile=await mkdtemp(join(tmpdir(),'moondog-enrolled-public-')),fresh=await mkdtemp(join(tmpdir(),'moondog-enrolled-recovery-')),external=await mkdtemp(join(tmpdir(),'moondog-enrolled-external-'));
 const options={headless:false,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{}),...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})};
 let context,page;const runtimeErrors=[];
 async function launch(path){
  const result=await chromium.launchPersistentContext(path,options);const observe=p=>p.on('pageerror',error=>runtimeErrors.push(error.message));for(const p of result.pages())observe(p);result.on('page',observe);return result;
 }
 const manage=new URL('web-preview/?manage=1',base).href;
 try{
  context=await launch(profile);await publicAuthority(context,base,sha);page=context.pages()[0];await page.goto(manage);
  await page.waitForFunction(()=>!document.querySelector('#installFromWeb').disabled,null,{timeout:120000});await fillEnrollment(page);await page.click('#installFromWeb');await installed(page);await page.click('#openApp');await connected(page);
  console.log(JSON.stringify({enrolledBetaInstalled:true,mainSha:sha,store:CODE}));
  assert.equal(await page.locator('#setupStoreCode').inputValue(),CODE);assert.equal(await page.locator('#setupStoreCode').evaluate(e=>e.readOnly),true);
  let reviews=0,roReviews=0;const dialogErrors=[];page.on('dialog',async dialog=>{
   const message=dialog.message();if(dialog.type()==='confirm'&&/^Review complete RO replacement: synthetic-enrolled-open-ro-[01]\.xlsx\n/.test(message)){roReviews++;await dialog.accept();return;}if(dialog.type()!=='confirm'||!message.startsWith('Review SAPR import: synthetic-enrolled-sapr.xlsx\n')||!message.includes(NAME)||!message.includes(CODE)){dialogErrors.push('Unexpected dealership/source dialog');await dialog.dismiss();return;}
   reviews++;await dialog.accept();
  });
  const workbook=await page.evaluate(({name,code,gross})=>{
   const metrics=[['Days Completed 8 out of 22'],['Total Gross',gross,null,null,null,null,gross+200],['Total Revenue',1000,null,null,null,null,1400],['RO Count',5,null,null,null,null,7],['Hours per RO',2],['ELR',100]],book=XLSX.utils.book_new(),benchmark=label=>[label,...Array.from({length:7},()=>[25,30,40,null,null]).flat()];
   XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Service Advisor Performance From 11/01/2026 to 11/19/2026'],...metrics]),'Store');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Synthetic Advisor [101]'],...metrics]),'Advisor');
   XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([[],['Tires','Brakes'],[],[],[],benchmark(code+' - '+name),benchmark('Synthetic Advisor [101]')]),'Controllables');return Array.from(new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx'})));
  },{name:NAME,code:CODE,gross:GROSS});
  // Use an actual file chooser. Do not seed the Inbox/Workspace through OPFS.
  const chooserReady=page.waitForEvent('filechooser');await page.click('#browserChooseSapr');const chooser=await chooserReady;await chooser.setFiles({name:'synthetic-enrolled-sapr.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(workbook)});
  await until(page,async key=>{const pointer=JSON.parse(localStorage.getItem(key));let d=await navigator.storage.getDirectory();for(const n of ['MoonDog-PWA-v1','stores',pointer.storeId,'System Files','Workspace','data'])d=await d.getDirectoryHandle(n);try{return Boolean(JSON.parse(await(await(await d.getFileHandle('advisor-performance.json')).getFile()).text()).snapshots?.['2026-11-19']);}catch(error){if(error.name==='NotFoundError')return false;throw error;}},POINTER);
  assert.deepEqual(dialogErrors,[]);assert.equal(reviews,1);await page.click('#completeSetup');await page.locator('#view-home.active').waitFor({state:'visible',timeout:30000});await views(page);assertStore(await state(page));
  console.log(JSON.stringify({enrolledActualFileChooserImported:true,sourceReviews:reviews,cpGross:GROSS,pace:PACE}));
  await page.getByRole('button',{name:'Home',exact:true}).click();await page.locator('#view-home.active').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>globalThis.__moondogSettingsModel.performance.snapshots['2026-11-19'].store.cpGross),GROSS);
  await page.getByRole('button',{name:/^Advisor Meeting$/i}).click();await page.locator('#view-meeting.active').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>globalThis.__moondogSapr.latestVerifiedMeetingSnapshot().store.cpGross),GROSS);
  async function importOpenRo(revision){
   await page.getByRole('button',{name:'Tools',exact:true}).click();await page.getByRole('button',{name:'Import or refresh data',exact:true}).click();
   const bytes=await page.evaluate(({name,code,revision})=>{const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['SYNTHETIC source for '+name+' '+code],['RO Number','Advisor','Advisor Number','Customer','Vehicle','Status','Opened','Total'],['900001','Synthetic Advisor','101','SYNTHETIC Customer','SYNTHETIC Vehicle','Working','11/19/2026',100+revision]]),'Open ROs');return Array.from(new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx'})));},{name:NAME,code:CODE,revision});
   const chooserReady=page.waitForEvent('filechooser');await page.locator('#dailyTools').getByRole('button',{name:'Choose a report',exact:true}).click();const chooser=await chooserReady;
   const filename='synthetic-enrolled-open-ro-'+revision+'.xlsx';await chooser.setFiles({name:filename,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)});
   await until(page,async({key,filename})=>{const p=JSON.parse(localStorage.getItem(key));let d=await navigator.storage.getDirectory();for(const n of ['MoonDog-PWA-v1','stores',p.storeId,'System Files','Workspace','data'])d=await d.getDirectoryHandle(n);try{const saved=JSON.parse(await(await(await d.getFileHandle('current-state.json')).getFile()).text());return saved.source?.fileName===filename&&saved.records?.some(row=>row.ro==='900001');}catch(error){if(error.name==='NotFoundError')return false;throw error;}},{key:POINTER,filename});
  }
  await importOpenRo(0);await page.getByRole('button',{name:'Open RO Control',exact:true}).click();await page.locator('#roTable tr[data-id] button[data-id]').first().click();await page.locator('#editDialog').waitFor({state:'visible'});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.selectOption('#editStatus',{label:'Being Repaired'});await page.fill('#editOwner','SYNTHETIC manager '+CODE);await page.fill('#editNextAction','Export verified supervisor workbook');await page.fill('#editReviewDate','2026-11-23');
  assert.equal(await page.inputValue('#editOwner'),'SYNTHETIC manager '+CODE);await page.click('#saveRecordClose');await page.locator('#editDialog').waitFor({state:'hidden'});await importOpenRo(1);assert.equal(roReviews,2);assert.deepEqual(dialogErrors,[]);
  assert.equal((await state(page)).record.management.owner,'SYNTHETIC manager '+CODE);assert.equal((await state(page)).record.management.nextAction,'Export verified supervisor workbook');
  await page.getByRole('button',{name:'Tools',exact:true}).click();await page.getByRole('button',{name:'Change how Service Operations Dashboard works',exact:true}).click();await page.getByRole('button',{name:'Advisors',exact:true}).click();
  await page.locator('input[data-advisor-participation="supervisorWorkbook"][data-advisor-code="101"]').check();
  await until(page,async key=>{const p=JSON.parse(localStorage.getItem(key));let d=await navigator.storage.getDirectory();for(const n of ['MoonDog-PWA-v1','stores',p.storeId,'System Files','Workspace','data'])d=await d.getDirectoryHandle(n);return JSON.parse(await(await(await d.getFileHandle('settings.json')).getFile()).text()).advisors['101'].participation.supervisorWorkbook===true;},POINTER);
  await page.getByRole('button',{name:'Tools',exact:true}).click();await page.getByRole('button',{name:'Import or refresh data',exact:true}).click();await page.getByRole('button',{name:'Supervisor workbook and detailed imports',exact:true}).click();await page.click('#exportButton');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('was generated and verified.'),null,{timeout:60000});const generated=await state(page);assert.equal(generated.report.stale,false);assert.equal(generated.report.eligibleRecordCount,1);
  await page.click('#browserAppSettings');await page.waitForFunction(()=>!document.querySelector('#loadReports').disabled,null,{timeout:30000});const beforeDownload=await state(page);await page.click('#loadReports');
  const downloadReport=page.getByRole('button',{name:'Download '+generated.report.fileName,exact:true});await downloadReport.waitFor({state:'visible',timeout:30000});const reportReady=page.waitForEvent('download');await downloadReport.click();const reportDownload=await reportReady,reportPath=join(external,'synthetic-supervisor.xlsx');await reportDownload.saveAs(reportPath);
  const reportBytes=await readFile(reportPath);assert.equal(createHash('sha256').update(reportBytes).digest('hex'),beforeDownload.files.find(([name])=>name==='exports/'+generated.report.fileName)[1]);assert.deepEqual((await state(page)).files,beforeDownload.files);
  const XLSX=createRequire(import.meta.url)('../../vendor/xlsx.full.min.js'),reportBook=XLSX.read(reportBytes,{type:'buffer'}),cells=reportBook.SheetNames.flatMap(name=>XLSX.utils.sheet_to_json(reportBook.Sheets[name],{header:1}).flat()).map(String);
  assert.ok(cells.includes('900001'));assert.ok(cells.includes('SYNTHETIC manager '+CODE));assert.ok(cells.includes('Export verified supervisor workbook'));
  console.log(JSON.stringify({enrolledHomeMeetingPerformance:true,enrolledOpenRoSourceReviews:roReviews,manualEditsSurviveSourceRefresh:true,supervisorWorkbookGenerated:true,actualReportDownloaded:true,reportBytesMatchPrivateOriginal:true,downloadDoesNotChangeWorkspace:true}));

  await page.click('#openApp');await connected(page);await views(page);
  // Real process shutdown/relaunch retains the selected Beta and import ledger.
  await context.close();context=null;context=await launch(profile);page=context.pages()[0];await page.goto(new URL('web-preview/',base).href);await connected(page);assertStore(await state(page));assert.equal((await state(page)).record.management.owner,'SYNTHETIC manager '+CODE);await views(page);
  console.log(JSON.stringify({enrolledProcessRestart:true,oneDurableImport:true}));
  await page.click('#browserAppSettings');await page.waitForFunction(()=>!document.querySelector('#prepareBackup').disabled,null,{timeout:30000});await page.check('#consent');await page.click('#prepareBackup');await page.locator('#saveBackup').waitFor({state:'visible',timeout:30000});
  const source=await state(page),receipt=await page.inputValue('#backupReceipt');assert.match(receipt,/^[a-f0-9-]{36}:[a-f0-9]{64}$/);
  const downloadReady=page.waitForEvent('download');await page.click('#saveBackup');const download=await downloadReady,backupPath=join(external,'synthetic-enrolled-backup.json'),receiptPath=join(external,'separate-receipt.txt');await download.saveAs(backupPath);await writeFile(receiptPath,receipt);assert.ok((await readFile(backupPath)).length>0);assert.equal(await readFile(receiptPath,'utf8'),receipt);
  const cdp=await context.newCDPSession(page);await cdp.send('Storage.clearDataForOrigin',{origin:new URL(base).origin,storageTypes:'all'});await cdp.detach();
  assert.deepEqual(await page.evaluate(async key=>{const root=await navigator.storage.getDirectory(),entries=[];for await(const[name]of root.entries())entries.push(name);return {entries,pointer:localStorage.getItem(key)};},POINTER),{entries:[],pointer:null});
  console.log(JSON.stringify({enrolledOriginalOriginErased:true,externalBackupAndSeparateReceipt:true}));
  await context.close();context=null;
  // A genuinely fresh profile reinstalls public software before recovery.
  context=await launch(fresh);await publicAuthority(context,base,sha);page=context.pages()[0];await page.goto(manage);await page.waitForFunction(()=>!document.querySelector('#restoreBackup').disabled,null,{timeout:120000});await fillEnrollment(page);await page.locator('#recovery').evaluate(e=>e.open=true);await page.setInputFiles('#backupFile',backupPath);await page.fill('#restoreReceipt',await readFile(receiptPath,'utf8'));await page.click('#restoreBackup');await installed(page);
  const recovered=await state(page);assertStore(recovered);assert.notEqual(recovered.pointer.storeId,source.pointer.storeId);assert.equal(recovered.pointer.workspaceId,source.pointer.workspaceId);assert.deepEqual(recovered.files,source.files);
  console.log(JSON.stringify({enrolledFreshProfileRecovery:true,logicalIdentityPreserved:true,filesByteExact:true}));
  await page.click('#openApp');await connected(page);assertStore(await state(page));await views(page);
  await page.click('#browserAppSettings');await page.waitForFunction(()=>!document.querySelector('#rollbackBeta').disabled,null,{timeout:30000});await page.check('#consent');const before=await state(page);await page.click('#rollbackBeta');await page.waitForFunction(()=>/original Stable .* restored/.test(document.querySelector('#betaStatus').textContent),null,{timeout:60000});
  assert.deepEqual((await state(page)).files,before.files);assertStore(await state(page));
  assert.deepEqual(runtimeErrors,[]);await publicAuthority(context,base,sha);
  console.log(JSON.stringify({enrolledPublicAcceptance:true,mainSha:sha,browser:process.env.BROWSER_CHANNEL||'Chromium',windowsHosted:process.platform==='win32',personalComputerProof:false,explicitDealershipEnrollment:true,actualFileChooser:true,sourceReviews:reviews,advisor:'101',cpGross:GROSS,pace:PACE,guidedSetup:true,realProcessRestart:true,oneDurableImport:true,externalBackupAndSeparateReceipt:true,originalOriginCompletelyErased:true,freshIsolatedProfileRestore:true,logicalIdentityPreserved:true,freshPhysicalIdentity:true,rollbackPreservesEveryWorkspaceByte:true}));
 }catch(error){console.error('Enrolled public acceptance failed:',error);if(page)console.error((await page.locator('body').innerText({timeout:3000}).catch(()=>'<body unavailable>')).slice(0,10000));throw error;}
 finally{await context?.close();await Promise.all([profile,fresh,external].map(path=>rm(path,{recursive:true,force:true,maxRetries:5,retryDelay:100})));}
}
