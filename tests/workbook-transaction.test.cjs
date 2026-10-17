const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const app=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
function extract(start,end){const a=app.indexOf(start),b=app.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return app.slice(a,b);}
const transaction=extract('  async function readWorkbookFile(', '  // A handoff is an independent');
const persistence=extract('  async function persistSupervisorWorkbookIssuance(', '  function newWorkbookIssuanceId(');
const marker=extract('  async function markSupervisorWorkbookStale(', '  async function persistSupervisorWorkbookIssuance(');
function fixture(options={}){
  const prior=new Uint8Array([1,2,3]),fresh=new Uint8Array([4,5,6]);
  const files=new Map(options.empty?[]:[['exports/current.xlsx',prior.slice()]]);
  let durable={supervisorWorkbook:{stale:false,issuanceId:'prior'}},failed=false;
  const model={state:{records:[{id:'synthetic'}]},recovery:structuredClone(durable),settings:{supervisorWorkbook:{filename:'current.xlsx'}}};
  const ctx=vm.createContext({model,Uint8Array,structuredClone,Date,RECOVERY_PATH:['data','recovery.json'],DEFAULTS:{supervisorWorkbook:{}},
    sha256:async bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),
    now:()=>new Date().toISOString(),stamp:()=> 'synthetic',supervisorWorkbookRecords:()=>model.state.records,
    newWorkbookIssuanceId:()=> '123e4567-e89b-42d3-a456-426614174000',workbookBytes:async()=>fresh,
    validateWorkbookBytes:async bytes=>{assert.deepEqual([...bytes],[...fresh]);return{recordCount:1,expectedSheets:['Synthetic']};},
    writeBytes:async(parts,bytes)=>{const name=parts.join('/');if(options.lockPrimary&&name==='exports/current.xlsx')throw Error('synthetic Excel lock');files.set(name,Uint8Array.from(bytes));if(options.corruptPrimary&&!failed&&name==='exports/current.xlsx'){failed=true;files.set(name,new Uint8Array([9]));}},
    readJson:async()=>structuredClone(durable),writeJson:async(_p,value)=>{if(options.failIssuance&&value.supervisorWorkbook.stale===false)throw Error('synthetic issuance failure');durable=structuredClone(value);},
    fileAt:async parts=>({getFile:async()=>{const bytes=files.get(parts.join('/'));if(!bytes)throw Object.assign(Error('missing'),{name:'NotFoundError'});return{arrayBuffer:async()=>bytes.slice().buffer};}}),
    maintenanceIO:{remove:async name=>files.delete(name)},retainDailyReport:async()=>{},addHistory:async()=>{},ui:{lastExport:{}},status(){}
  });vm.runInContext(marker+persistence+transaction,ctx);
  return{ctx,files,prior,fresh,model,durable:()=>durable,setDurable:value=>{durable=value;}};
}
test('successful workbook replacement verifies bytes, backup and durable issuance',async()=>{
  const f=fixture();await f.ctx.generateWorkbookUnlocked(false);assert.deepEqual(f.files.get('exports/current.xlsx'),f.fresh);assert.equal(f.durable().supervisorWorkbook.stale,false);assert.ok([...f.files.keys()].some(p=>p.startsWith('backups/supervisor-')));
});
test('issuance failure restores exact previous bytes and leaves recovery stale',async()=>{
  const f=fixture({failIssuance:true});await assert.rejects(f.ctx.generateWorkbookUnlocked(false),/issuance failure/);assert.deepEqual(f.files.get('exports/current.xlsx'),f.prior);assert.equal(f.durable().supervisorWorkbook.stale,true);assert.ok(f.durable().supervisorWorkbook.pending);
});
test('first issuance failure removes unverified primary workbook',async()=>{
  const f=fixture({empty:true,failIssuance:true});await assert.rejects(f.ctx.generateWorkbookUnlocked(false),/issuance failure/);assert.equal(f.files.has('exports/current.xlsx'),false);assert.equal(f.durable().supervisorWorkbook.stale,true);
});
test('locked primary preserves old bytes and makes only verified revision current',async()=>{
  const f=fixture({lockPrimary:true});await assert.rejects(f.ctx.generateWorkbookUnlocked(false),/Verified recovery workbook/);assert.deepEqual(f.files.get('exports/current.xlsx'),f.prior);const current=f.durable().supervisorWorkbook;assert.match(current.fileName,/-revision.xlsx$/);assert.equal(current.stale,false);assert.deepEqual(f.files.get('exports/'+current.fileName),f.fresh);
});
test('corrupt primary readback restores old bytes before activating verified fallback',async()=>{
  const f=fixture({corruptPrimary:true});await assert.rejects(f.ctx.generateWorkbookUnlocked(false),/Verified recovery workbook/);assert.deepEqual(f.files.get('exports/current.xlsx'),f.prior);assert.match(f.durable().supervisorWorkbook.fileName,/-revision.xlsx$/);
});
test('interrupted replacement restores from durable backup and rejects corrupt backup',async()=>{
  const f=fixture({failIssuance:true});await assert.rejects(f.ctx.generateWorkbookUnlocked(false));
  f.files.set('exports/current.xlsx',f.fresh);await f.ctx.recoverPendingSupervisorWorkbook();assert.deepEqual(f.files.get('exports/current.xlsx'),f.prior);assert.equal(f.durable().supervisorWorkbook.pending,null);
  const g=fixture({failIssuance:true});await assert.rejects(g.ctx.generateWorkbookUnlocked(false));const backup=g.durable().supervisorWorkbook.pending.backupName;g.files.set('backups/'+backup,new Uint8Array([9]));await assert.rejects(g.ctx.recoverPendingSupervisorWorkbook(),/integrity failed/);
});
test('RO review blocks duplicate, replay, stale, changed and unapproved sources',async()=>{
  const code=extract('  async function verifyCompleteRoImport(', '  async function importCdkRepairOrdersDocxUnlocked(');
  const bytes=new Uint8Array([1]),digest=crypto.createHash('sha256').update(bytes).digest('hex');
  let approval=true,actual=bytes;
  const ctx=vm.createContext({text:v=>String(v??''),Date,model:{state:{records:[],source:{}}},sha256:async b=>crypto.createHash('sha256').update(new Uint8Array(b)).digest('hex'),window:{confirm:()=>approval},sourceFileHandle:async()=>({getFile:async()=>({arrayBuffer:async()=>actual})})});vm.runInContext(code,ctx);
  const file={lastModified:Date.now()},rows=[{ro:'synthetic'}];
  assert.equal((await ctx.verifyCompleteRoImport('original.xlsx',file,bytes,rows)).sha256,digest);
  await assert.rejects(ctx.verifyCompleteRoImport('original.xlsx',file,bytes,[...rows,...rows]),/duplicate/);
  ctx.model.state.source={acceptedDigests:[digest]};await assert.rejects(ctx.verifyCompleteRoImport('original.xlsx',file,bytes,rows),/replay/);ctx.model.state.source={};
  await assert.rejects(ctx.verifyCompleteRoImport('original.xlsx',{lastModified:0},bytes,rows),/timestamp/);
  actual=new Uint8Array([2]);await assert.rejects(ctx.verifyCompleteRoImport('original.xlsx',file,bytes,rows),/changed/);actual=bytes;
  approval=false;await assert.rejects(ctx.verifyCompleteRoImport('original.xlsx',file,bytes,rows),/not approved/);
});
