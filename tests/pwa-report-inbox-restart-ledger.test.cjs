'use strict';
// Production Report Inbox scheduler under two synthetic JS process lifetimes.
// This proves durable signature deduplication on reconnection, NOT a complete
// browser process or SAPR XLSX ingestion / published-website acceptance.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const start=app.indexOf('  async function folderWatchScan(');
const end=app.indexOf('  async function importReturnedWorkbook(',start);
assert.ok(start>=0&&end>start,'Production Report Inbox scan source required');
const source=app.slice(start,end);
const signature='Report Inbox/synthetic-sapr.xlsx|3|123';
function connectedSession({savedAutoImport=null,store='SYNTHETIC A'}={}){
 const root={name:store},name='synthetic-sapr.xlsx',relativePath='Report Inbox/'+name;
 const candidate={name,relativePath,signature,location:'inbox',
  file:{lastModified:123,async arrayBuffer(){return new Uint8Array([1,2,3]).buffer;}}};
 const model={root,autoImport:savedAutoImport?structuredClone(savedAutoImport):
  {seen:{},inboxVersion:1,initializedAt:'2026-11-20T15:00:00Z'}};
 const folderWatch={timer:null,busy:false,state:'ON',message:'',lastChecked:'',
  pending:new Map([[relativePath,{signature,confirmations:1,firstSeenAt:'2026-11-20T15:00:00Z'}]])};
 const imports=[],ledgerWrites=[];
 const context=vm.createContext({
  model,folderWatch,Map,Set,Object,Array,Promise,String,Boolean,JSON,Date,Uint8Array,Error,console,
  writeAuthority:{canWrite:true},workspaceConnectionBusy:false,workspaceRecoveryBusy:false,
  postConnectionScanBusy:false,dailyImportBusy:false,appointmentImportBusy:false,
  AUTO_IMPORT_PATH:['data','auto-import.json'],
  window:{scrollX:0,scrollY:0,scrollTo(){}},
  folderWatchEnabled:()=>true,permission:async()=> 'granted',
  watchCandidates:async()=>[candidate],
  candidateNeedsImport:item=>!model.autoImport.seen?.[item.signature],
  transientIntakeError:error=>error?.name==='NotReadableError',
  classifyImportFile:async()=> 'sapr',
  processClassifiedCandidate:async item=>{imports.push(item.name);return {saved:true,deleted:true};},
  sourceLocations:new Map(),now:()=> '2026-11-20T15:01:00Z',
  writeJson:async(_key,value)=>ledgerWrites.push(structuredClone(value)),
  recordDiagnostic(){},status(){},watchStatus(){},renderAll(){},renderSetup(){},renderRecovery(){},
  scanFiles:async()=>{}
 });
 vm.runInContext(source+'\nthis.scanInbox=folderWatchScan;',context);
 return {store,root,model,folderWatch,imports,ledgerWrites,scan:()=>context.scanInbox('connection')};
}
test('SAPR-classified Report Inbox signature survives a simulated JS process restart and is not imported twice',async()=>{
 const first=connectedSession();
 await first.scan();
 assert.deepEqual(first.imports,['synthetic-sapr.xlsx']);
 const entry=first.model.autoImport.seen[signature];
 assert.ok(entry,'Successful first import must durably establish a signature ledger');
 assert.equal(entry.kind,'sapr');
 assert.equal(first.folderWatch.busy,false);
 const saved=structuredClone(first.model.autoImport);
 const restarted=connectedSession({savedAutoImport:saved});
 assert.notEqual(restarted.root,first.root,'New browser script lifetime must not share mutable connection objects');
 await restarted.scan();
 await restarted.scan();
 assert.deepEqual(restarted.imports,[],'Reconnected Report Inbox must not import identical SAPR again');
 assert.deepEqual(restarted.model.autoImport.seen[signature],saved.seen[signature]);
 assert.equal(restarted.folderWatch.busy,false,'The restarted watch slot must release');
});
test('two synthetic stores with colliding Report Inbox filenames maintain independent intake history',async()=>{
 const a=connectedSession({store:'SYNTHETIC A'}),b=connectedSession({store:'SYNTHETIC B'});
 await Promise.all([a.scan(),b.scan()]);
 assert.deepEqual(a.imports,['synthetic-sapr.xlsx']);
 assert.deepEqual(b.imports,['synthetic-sapr.xlsx']);
 assert.notEqual(a.model.autoImport,b.model.autoImport);
 assert.equal(a.model.autoImport.seen[signature].kind,'sapr');
 assert.equal(b.model.autoImport.seen[signature].kind,'sapr');
 const restartedA=connectedSession({savedAutoImport:structuredClone(a.model.autoImport),store:'SYNTHETIC A'});
 await restartedA.scan();
 assert.equal(restartedA.imports.length,0,'A restart must not deduplicate across another store');
 assert.equal(restartedA.folderWatch.busy,false);
});
