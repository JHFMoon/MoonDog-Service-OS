(function(root){'use strict';
const DAY=86400000,canonical=['current-state','settings','appointments','advisor-performance','assign-next','auto-import','operational-metrics','meeting-cycle','recovery'].map(n=>'data/'+n+'.json');
const RETENTION=Object.freeze({automaticDays:30,automaticMax:50,fullDays:90,fullMax:3,fullRefreshDays:30,restoreSafetyDays:30,restoreSafetyMax:2,deploymentDays:90,deploymentMax:3,systemUpdateDays:30,systemUpdateMax:3,supportDays:30,supportMax:2,revisionDays:30,revisionMax:3,importDays:90});
const encode=s=>new TextEncoder().encode(s),decode=b=>new TextDecoder().decode(b),equal=(a,b)=>a?.length===b?.length&&a.every((v,i)=>v===b[i]);
const json=b=>JSON.parse(decode(b).replace(/^\uFEFF/,''));
const stable=v=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(stable(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])):v);
const locks=new WeakMap();
async function safeWrite(io,path,bytes,options={}){
 let map=locks.get(io);if(!map)locks.set(io,map=new Map());const priorJob=map.get(path)||Promise.resolve();
 const job=priorJob.catch(()=>{}).then(async()=>{
  bytes=new Uint8Array(bytes);if(path.endsWith('.json')&&options.validateJson!==false)json(bytes);
  let old=null;try{old=await io.read(path)}catch(e){if(e.name!=='NotFoundError')throw e;}
  const tmp=path.slice(0,path.lastIndexOf('/')+1)+'.moondog-txn-'+crypto.randomUUID()+'.json';
  let prepared=false,touched=false,token=await io.beginMutation?.();
  const txn={format:'moondog-write-v1',target:path,at:new Date().toISOString(),before:old?Array.from(old):null,after:Array.from(bytes),revisionBefore:Number.isSafeInteger(token?.expected)?token.expected:null};
  try{
   await io.rawWrite(tmp,encode(JSON.stringify(txn)),token);if(!equal(await io.read(tmp),encode(JSON.stringify(txn))))throw Error('Temporary write verification failed');prepared=true;
   let current=null;try{current=await io.read(path)}catch(e){if(e.name!=='NotFoundError')throw e;}
   if((old===null)!==(current===null)||(old&&!equal(old,current)))throw Error('File changed during write');
   touched=true;await io.rawWrite(path,bytes,token);if(!equal(await io.read(path),bytes))throw Error('Durable read-back mismatch');
   await io.completeMutation?.(token);token=null;
   if(io.cleanupJournal)try{await io.cleanupJournal(tmp)}catch(_){}else await io.remove(tmp);
   return true;
  }catch(error){
   let recovered=!touched;
   if(touched)try{if(old){await io.rawWrite(path,old,token,true);recovered=equal(await io.read(path),old);}else{await io.remove(path,token,true);recovered=true;}}catch(_){}
   if(recovered)try{await io.remove(tmp,token,true)}catch(_){}
   io.cancelMutation?.(token);token=null;
   // A failed rollback retains the verified journal; it is never garbage-collected as clutter.
   io.failure?.({kind:'DURABLE WRITE FAILED',recovered,prepared});throw error;
  }
 });map.set(path,job);try{return await job}finally{if(map.get(path)===job)map.delete(path);}
}
function family(path){const n=path.split('/').at(-1);if(/^MoonDog Full Backup - .*\.zip$/i.test(n))return 'manager-full';if(/^MoonDog Restore Safety - .*\.zip$/i.test(n))return 'restore-safety';if(!/^\d{4}-\d{2}-\d{2}/.test(n)||!n.endsWith('.json'))return null;const label=n.replace(/^\d{4}-\d{2}-\d{2}(?:T[\d:-]+Z)?-/,'').replace(/\.json$/,'');if(/^Updated-RO-\d+$/i.test(label))return 'ro-update';if(/^(before-|appointments-before-|advisor-performance-before-|meeting-cycle-)/.test(label))return label.replace(/\d{4}-\d{2}-\d{2}/g,'date');return null;}
function policy(files,ctx){
 const remove=[],keep=new Set(ctx.references||[]),day=ctx.day,age=f=>Math.max(0,Math.floor((Date.parse(day+'T12:00:00Z')-Date.parse((f.day||f.path.match(/\d{4}-\d{2}-\d{2}/)?.[0]||new Date(f.modified).toISOString().slice(0,10))+'T12:00:00Z'))/DAY));
 const pinned=f=>keep.has(f.path)||[...keep].some(p=>p.startsWith(f.path+'/')||f.path.startsWith(p+'/'))||f.unresolved;
 const safe=f=>f.valid&&!pinned(f)&&ctx.currentValid&&!ctx.restoreBusy;
 const add=f=>{if(safe(f)&&!remove.some(x=>x.path===f.path))remove.push(f);};
 const automatic=files.filter(f=>f.area==='automatic'&&f.valid).sort((a,b)=>b.modified-a.modified||b.path.localeCompare(a.path));
 const automaticCap=new Set(automatic.slice(0,RETENTION.automaticMax).map(f=>f.path)),newest=new Map();
 for(const f of automatic){const k=f.family+':'+(f.day||f.path.slice(8,18));if(!newest.has(k))newest.set(k,f);}
 for(const f of automatic){const a=age(f),k=f.family+':'+(f.day||f.path.slice(8,18));if(a>RETENTION.automaticDays||!automaticCap.has(f.path)||(a>7&&newest.get(k)!==f))add(f);}
 const specs={'manager-full':[RETENTION.fullMax,RETENTION.fullDays],'restore-safety':[RETENTION.restoreSafetyMax,RETENTION.restoreSafetyDays],deployment:[RETENTION.deploymentMax,RETENTION.deploymentDays],'system-update':[RETENTION.systemUpdateMax,RETENTION.systemUpdateDays],support:[RETENTION.supportMax,RETENTION.supportDays],revision:[RETENTION.revisionMax,RETENTION.revisionDays]};
 for(const [area,[maxCount,maxDays]] of Object.entries(specs)){
  const all=files.filter(f=>f.area===area&&f.valid&&!f.unresolved).sort((a,b)=>b.modified-a.modified||b.path.localeCompare(a.path));
  all.forEach((f,index)=>{if(index>=maxCount||age(f)>maxDays)add(f);});
 }
 for(const f of files.filter(f=>f.area==='import'))if(age(f)>RETENTION.importDays&&f.importProven)add(f);
 return remove;
}
function semanticSame(a,b){return stable(a)===stable(b);}
function superseded(a,b){if(!a||!b||!(Date.parse(a.updatedAt)<Date.parse(b.updatedAt)))return false;const aa={...a},bb={...b};delete aa.updatedAt;delete bb.updatedAt;return semanticSame(aa,bb);}

// Only known migrations with validated saved target state can enter ordinary retention.
function migrationResolved(family,backup,current){
 if(!backup||typeof backup!=='object'||Array.isArray(backup))return false;
 const assign=current['data/assign-next.json'],settings=current['data/settings.json'],performance=current['data/advisor-performance.json'];
 if(family==='before-open-ro-assign-ledger-migration'){
  const snapshot=assign?.currentOpenRo;
  return !!backup.days&&typeof backup.days==='object'&&assign?.schemaVersion===3&&!!assign.days&&typeof assign.days==='object'&&!Object.hasOwn(assign,'workloadSources')&&Object.values(assign.days).every(d=>d&&typeof d.advisors==='object'&&typeof d.openedToday==='object')&&(snapshot===null||snapshot?.sourceType==='open-ro'&&Array.isArray(snapshot.records)&&snapshot.validation?.canonicalRecords===snapshot.records.length&&new Set(snapshot.records.map(r=>r.ro)).size===snapshot.records.length&&snapshot.records.every(r=>/^\d+$/.test(r.ro)&&/^\d+$/.test(r.advisorCode)&&typeof r.isOpen==='boolean'&&typeof r.openedDate==='string'));
 }
 if(family==='before-productization-phase3-settings-migration')return !!backup.schemaVersion&&settings?.schemaVersion===4&&!!settings.store&&!!settings.advisors&&Array.isArray(settings.openRo?.managementStatuses)&&settings.openRo.managementStatuses.every(s=>s.id&&s.name)&&!!settings.supervisorWorkbook&&!!settings.setup;
 if(family==='before-sapr-cp-ro-vin-denominator-migration'){
  if(!backup.snapshots||!performance?.snapshots)return false;
  return Object.values(performance.snapshots).every(s=>{if(s.validation?.controllableVinDenominator!=='cp-ro')return false;const scopes=[[s.store,s.controllables?.store],...Object.entries(s.advisors||{}).map(([c,e])=>[e,s.controllables?.advisors?.[c]])];return scopes.every(([e,metrics])=>!metrics||Object.values(metrics).every(v=>Number.isFinite(e?.cpRO)&&v.eligibleVins===e.cpRO&&Number.isFinite(v.soldVins)&&v.soldVins===Math.max(0,Math.min(e.cpRO,Math.round(v.actual/100*e.cpRO)))));});
 }
 return false;
}
function retiredRecoveryDirectory(path){return /^backups\/(?:deployment-20\d{6}(?:-|$)|20\d{2}-\d{2}-\d{2}-before-[\w-]*(?:deployment|fix|coverage|availability)$)/.test(path);}

function create(io,api){
 let running=null,lastLight=0,deepDate='',timer=null,retryDeep=false;const metadata=()=>api.recovery().housekeeping||{};
 function schedule(reason){clearTimeout(timer);timer=setTimeout(()=>run({reason}).catch(()=>{}),1500);}
 async function run(options={}){
  if(running)return running;const at=api.now?.()||Date.now(),day=api.day();const prior=metadata();
  const deep=!options.repairOnly&&(retryDeep||(deepDate||prior.lastDeepHousekeepingDate)!==day);
  if(!options.force&&!deep&&at-(lastLight||Date.parse(prior.lastLightHousekeepingAt)||0)<300000)return {throttled:true};
  if(api.busy?.())return {busy:true};
  running=(async()=>{
   const result={at:new Date(at).toISOString(),deep,filesRemoved:0,bytesReclaimed:0,issues:deep?[]:(prior.issues||[]).filter(i=>/^(backups|Files To Learn|imports|exports|support)/.test(i.path)),events:[],removed:[]};
   const issue=(path,reason)=>{if(!result.issues.some(i=>i.path===path))result.issues.push({path,reason});};
   const refs=api.references();const referenced=p=>refs.some(r=>r===p||p.endsWith('/'+r)||r.startsWith(p+'/')||p.startsWith(r+'/'));
   async function inspect(p){const st=await io.stat(p),b=await io.read(p);return {path:p,size:b.length,modified:st.modified,hash:await io.hash(b),bytes:b};}
   async function remove(f,reason){
    if(api.busy?.()||canonical.includes(f.path)||referenced(f.path)||api.references().some(p=>f.path===p||f.path.endsWith('/'+p)||f.path.startsWith(p+'/'))||f.path===api.currentWorkbook())return false;
    try{if(at-f.modified<60000){issue(f.path,'File is still changing');return false;}const current=await inspect(f.path);if(current.size!==f.size||current.modified!==f.modified||current.hash!==f.hash){issue(f.path,'File changed; kept');return false;}
     // Persist bounded removal evidence before deletion; no operational event contents are invented.
     result.events.push({path:f.path,at:result.at,size:f.size,modified:new Date(f.modified).toISOString(),hash:f.hash,reason});await api.checkpoint([...(prior.events||[]),...result.events].slice(-60));
     const final=await inspect(f.path);if(final.hash!==f.hash||final.modified!==f.modified){issue(f.path,'File changed before removal; kept');return false;}await io.remove(f.path);if(await io.exists(f.path))throw Error('Removal unverified');result.filesRemoved++;result.bytesReclaimed+=f.size;result.removed.push({path:f.path,size:f.size,reason});return true;
    }catch(e){issue(f.path,'Storage unavailable; kept or retry required');return false;}
   }
   try{
    await api.ensureFolders();
    const roots=await io.list('data',false),allBackups=await io.list('backups',deep),backups=allBackups.filter(p=>!p.startsWith('backups/system-updates/')),systemUpdateFiles=allBackups.filter(p=>p.startsWith('backups/system-updates/')),history=await io.list('data/history',false);
    // Invalid empty history/pre-change files are not events or recovery points.
    for(const p of [...history,...backups].filter(p=>p.endsWith('.json'))){try{const f=await inspect(p);try{json(f.bytes)}catch(_){if(!f.size&&(/data\/history\/(?:\d{4}-|daily-)/.test(p)||family(p)))await remove(f,'INVALID ZERO BYTE ARTIFACT REMOVED');else issue(p,'Invalid JSON requires review');}}catch(_){issue(p,'Could not inspect file');}}
    for(const p of (options.repairOnly?[]:[...roots,...history,...backups,...await io.list("exports",false),...await io.list("",false)]).filter(p=>p.endsWith('.json')&&!canonical.includes(p))){
     if(p.split('/').at(-1).startsWith('.moondog-txn-')){try{const f=await inspect(p),t=json(f.bytes),b=await io.read(t.target);let completed=t.format==='moondog-write-v1'&&t.before&&equal(b,new Uint8Array(t.before));if(t.format==='moondog-write-v1'&&equal(b,new Uint8Array(t.after))){if(Number.isSafeInteger(t.revisionBefore)){const revision=json(await io.read('data/store-revision.json'));completed=revision.revision===t.revisionBefore+1;}else completed=true;}if(completed)await remove(f,'COMPLETED WRITE JOURNAL REMOVED');else issue(p,'Interrupted durable write journal requires review');}catch(_){issue(p,'Interrupted durable write journal requires review');}continue;}
     const target=canonical.find(c=>p.startsWith(c.slice(0,-5)+'-'));if(!target)continue;
     try{const f=await inspect(p),b=await io.read(target);if(equal(f.bytes,b)||semanticSame(json(f.bytes),json(b))||superseded(json(f.bytes),json(b)))await remove(f,'CONFLICT COPY REMOVED');else issue(p,'Conflict copy contains unique or uncertain state');}catch(_){issue(p,'Conflict copy could not be compared');}
    }
    for(const p of (await io.list('',false)).filter(p=>/^MOONDOG_DIAGNOSTICS-.+\.md$/.test(p))){const f=await inspect(p);if(equal(f.bytes,await io.read('MOONDOG_DIAGNOSTICS.md')))await remove(f,'DUPLICATE DIAGNOSTICS REMOVED');else issue(p,'Unique diagnostic copy retained');}
    // Only this completed, positively identified one-off inventory is disposable.
    if(await io.exists('TEMP - MOONDOG COMPLETE FILE INVENTORY.csv')){const f=await inspect('TEMP - MOONDOG COMPLETE FILE INVENTORY.csv');if(api.inventoryComplete&&/path/i.test(decode(f.bytes).split(/\r?\n/)[0]))await remove(f,'COMPLETED INVENTORY REMOVED');}
    if(deep){
     let currentValid=false;try{await api.validateCurrent();currentValid=true;}catch(_){issue('data','Current durable validation failed; retention blocked');}
     const full=[],classified=[],deployment=new Map(),systemUpdates=new Map();
     for(const p of backups){try{const f=await inspect(p),fam=family(p);if(p.endsWith('.zip')){try{const v=await api.validateBackup(f.bytes),entry={...f,valid:true,createdAt:Date.parse(v.manifest.createdAt),family:fam};full.push(entry);if(fam==='restore-safety'||fam==='manager-full')classified.push({...entry,area:fam});}catch(_){issue(p,'Backup validation failed; kept');}continue;}
       if(p.slice(8).includes('/')){const dir='backups/'+p.slice(8).split('/')[0];if(/deployment|before-.*(?:fix|coverage|availability)/.test(dir)){if(!deployment.has(dir))deployment.set(dir,[]);deployment.get(dir).push(f);}continue;}
       if(fam){let v;try{v=json(f.bytes)}catch(_){continue;}classified.push({...f,valid:!!v&&typeof v==='object',family:fam,area:'automatic',day:p.slice(8,18),unresolved:/migration/i.test(fam)&&!(await api.migrationResolved?.(fam,v))});}
      }catch(_){issue(p,'Backup inspection unavailable');}}
     for(const [p,items] of deployment){let valid=true;for(const f of items){if(!/\.(js|css|html|json|md|txt)$/i.test(f.path)||!f.size){valid=false;break;}if(f.path.endsWith('.json'))try{json(f.bytes)}catch(_){valid=false;}}
      if(valid)classified.push({path:p,area:'deployment',valid:true,modified:Math.max(...items.map(f=>f.modified)),day:new Date(Math.max(...items.map(f=>f.modified))).toISOString().slice(0,10),items});else issue(p,'Recovery directory cannot be verified; kept');}
     for(const p of systemUpdateFiles){try{const f=await inspect(p),parts=p.split('/'),dir=parts.slice(0,3).join('/');if(parts.length<4)continue;if(!systemUpdates.has(dir))systemUpdates.set(dir,[]);systemUpdates.get(dir).push(f);}catch(_){issue(p,'Update rollback file could not be inspected');}}
     for(const [p,items] of systemUpdates){
      const journal=items.find(f=>f.path===p+'/journal.json');let record=null;try{record=journal?json(journal.bytes):null;}catch(_){}
      const status=record?.status,valid=Array.isArray(record?.inventory)&&['verified','restored','prepared','applying'].includes(status);
      if(!valid){issue(p,'Update rollback backup is invalid or incomplete; kept for review');continue;}
      const unresolved=['prepared','applying'].includes(status),modified=Math.max(...items.map(f=>f.modified));
      if(unresolved)issue(p,'Interrupted update recovery is still active; resolve it before this safety artifact can expire.');
      classified.push({path:p,area:'system-update',valid:true,unresolved,modified,day:new Date(modified).toISOString().slice(0,10),items});
     }
     const newestFull=full.filter(f=>f.family==='manager-full').sort((a,b)=>b.createdAt-a.createdAt)[0];
     if(currentValid&&(!newestFull||at-newestFull.createdAt>RETENTION.fullRefreshDays*DAY)){
      try{const created=await api.createRetentionBackup?.();if(created?.path){const fresh=await inspect(created.path),validated=await api.validateBackup(fresh.bytes),entry={...fresh,valid:true,createdAt:Date.parse(validated.manifest.createdAt),family:'manager-full',area:'manager-full'};full.push(entry);classified.push(entry);}}
      catch(_){issue('backups','Automatic rolling full backup could not be created; stale recovery points are held only until a fresh verified backup can replace them.');}
     }
     for(const p of await io.list('support',true)){if(!/^support\/MoonDog Support (?:Package|Recovery Copy) - .+\.zip$/.test(p))continue;const f=await inspect(p);classified.push({...f,area:'support',valid:await api.validateSupport(f.bytes)});}
     let workbookValid=false;try{workbookValid=await api.validateWorkbook(await io.read(api.currentWorkbook()));}catch(_){}
     for(const p of await io.list('exports',false)){if(/-revision\.xlsx$/.test(p)){const f=await inspect(p);classified.push({...f,area:'revision',valid:await api.validateWorkbook(f.bytes)});}}
     for(const p of await io.list('imports',false)){const f=await inspect(p);classified.push({...f,area:'import',valid:true,importProven:await api.importEvidence?.(p,f.bytes)===true});}
     const candidates=policy(classified,{now:at,day,references:refs,currentValid,restoreBusy:api.busy?.(),currentWorkbookValid:workbookValid,fullBackups:full});
     async function removeEmptyTree(p){if(!io.directoryEntries||!io.removeEmpty)return;let entries;try{entries=await io.directoryEntries(p);}catch(_){return;}for(const e of entries)if(e.kind==='directory')await removeEmptyTree(p+'/'+e.name);try{await io.removeEmpty(p);}catch(_){}}
     for(const f of candidates){if(f.items){let unchanged=true;for(const i of f.items){const c=await inspect(i.path);if(c.hash!==i.hash||c.modified!==i.modified)unchanged=false;}if(!unchanged){issue(f.path,'Recovery directory changed; kept');continue;}for(const i of f.items)await remove(i,f.area==='system-update'?'SYSTEM UPDATE ROLLBACK PRUNED':'DEPLOYMENT RECOVERY PRUNED');await removeEmptyTree(f.path);}else await remove(f,'RETENTION PRUNED');}

     // Directory entries (including empty child directories) must be absent twice.
     for(const p of await io.listDirectories?.('backups')||[]){
      if(!retiredRecoveryDirectory(p)||referenced(p)||api.busy?.())continue;
      try{async function emptyTree(q){const entries=await io.directoryEntries(q);if(entries.some(e=>e.kind!=='directory'))return null;let paths=[q];for(const e of entries){const child=await emptyTree(q+'/'+e.name);if(!child)return null;paths.push(...child);}return paths.sort();}const first=await emptyTree(p);if(!first||first.some(referenced))continue;const fingerprint=await io.hash(encode(stable(first)));result.events.push({path:p,at:result.at,size:0,hash:fingerprint,reason:'EMPTY RETIRED RECOVERY DIRECTORY REMOVED'});await api.checkpoint([...(prior.events||[]),...result.events].slice(-60));
       if(api.busy?.()||referenced(p)||api.references().some(r=>r===p||r.startsWith(p+'/')||p.endsWith('/'+r)))continue;
       const final=await emptyTree(p);if(!final||stable(first)!==stable(final)||final.some(q=>api.references().some(r=>r===q||r.startsWith(q+'/')||q.endsWith('/'+r))))continue;for(const q of final.sort((a,b)=>b.length-a.length)){await io.removeEmpty(q);}
       if((await io.listDirectories('backups')).includes(p)){issue(p,'Empty recovery directory could not be removed');continue;}
       result.directoriesRemoved||=[];result.directoriesRemoved.push(p);
      }catch(_){issue(p,'Recovery directory unavailable; kept');}
     }
     for(const p of await io.list('Files To Learn',false)){try{const f=await inspect(p);const kind=await api.classifyLearn(f);if(kind==='disposable')await remove(f,'FILES TO LEARN NON-INPUT REMOVED');else if(kind==='supported'){if(at-f.modified<60000){issue(p,'Report still changing; kept');continue;}await api.importLearn(f);const current=await inspect(p);if(current.hash===f.hash)await remove(f,'FILES TO LEARN IMPORT VERIFIED');}else issue(p,'Unrecognized learning material retained');}catch(_){issue(p,'Learning material retained after validation failure');}}
     deepDate=day;retryDeep=false;
    }
    lastLight=at;await api.finish({...prior,lastLightHousekeepingAt:result.at,...(deep?{lastDeepHousekeepingDate:day,lastDeepHousekeepingAt:result.at,lastRetentionValidationAt:result.at}:{}),lastHousekeepingStatus:result.issues.length?'Needs attention':'All clear',filesRemoved:(prior.filesRemoved||0)+result.filesRemoved,bytesReclaimed:(prior.bytesReclaimed||0)+result.bytesReclaimed,unresolvedMaintenanceCount:result.issues.length,issues:result.issues.slice(0,50),events:[...(prior.events||[]),...result.events].slice(-60),...(result.removed.some(f=>f.path.startsWith('backups/'))?{lastBackupPruneAt:result.at}:{})});
    await api.diagnostic('HOUSEKEEPING COMPLETE',result.filesRemoved+' files removed; '+result.issues.length+' items retained for review');
   }catch(e){result.failed=true;if(deep)deepDate='';try{await api.finish({...prior,lastHousekeepingStatus:'Retry needed',unresolvedMaintenanceCount:1,issues:[{path:'maintenance',reason:'Storage unavailable; automatic retry pending'}]});}catch(_){}await api.diagnostic('HOUSEKEEPING FAILED','Storage inspection incomplete; retry later').catch(()=>{});}
   api.changed?.();return result;
  })();try{return await running}finally{running=null;}
 }
 return {run,schedule,backupReady(){if(metadata().issues?.some(i=>i.reason==='Retention waits for a validated full recovery backup')){retryDeep=true;schedule('validated backup');}},get running(){return !!running}};
}
const knownNonReportHashes=new Set(["0a3cc9952b9620efd2a437c75c2f16f1f1304d8d85dc55043068a65686784e59","21020c28c76cf7ccf6f1447591dfff92b749bac8a14d18ecb5c0fbee7e78d787","bafc10c2e8e38ea80574b919ac4cbef64f5636f22922107c769b0e3bcbeb390e","6c795a4a6b506787265f73753cf33e780a9ca2d8b0817586362b01b08b31f233","3399e6b3467d562dd9c20ba6aced4b636688113129529d4476d99b6a713b10ff","b85a6613184d33df9487fdd0b6a2687dd999aec8a429d8a4d9bc2ce85f0d5ccf","75bc1ce7f4b2421f84ff37e664c4f25c8eb6149cbcfe616500230fcb9d32a2e6"]);
root.MoonDogMaintenance={knownNonReportHash:h=>knownNonReportHashes.has(String(h).toLowerCase()),safeWrite,policy,family,semanticSame,superseded,migrationResolved,retiredRecoveryDirectory,create,canonical,retention:RETENTION};if(typeof module!=='undefined')module.exports=root.MoonDogMaintenance;
})(globalThis);
