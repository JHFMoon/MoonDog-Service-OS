const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync(require('node:path').join(__dirname, '../assets/app.js'), 'utf8');
function extract(start, end) { const a=app.indexOf(start), b=app.indexOf(end,a+start.length); assert.ok(a>=0&&b>a,start); return app.slice(a,b); }
const helpers=extract('  function workbookIsHandoff(', '  function workbookDate(');
const issuance=extract('  function workbookIssuanceId(', '  async function markSupervisorWorkbookStale(');
const source=extract('  async function importSourceUnlocked(', '\n\n  const timeMinutes');
const returned=extract('  async function importReturnedWorkbookUnlocked(', '\n\n  async function importSource(');
const id='123e4567-e89b-42d3-a456-426614174000';
function book(headers=['RO'], props={}, q='') { return {SheetNames:['Synthetic'], Sheets:{Synthetic:{headers,Q1:{v:q}}}, Props:props}; }
function fixture(value, recovery={supervisorWorkbook:{stale:false,issuanceId:id}}) {
  const writes=[];
  const context=vm.createContext({
    text:v=>String(v??''), RETURN_ID_HEADER:'__MoonDog RO ID', RETURN_BASELINE_HEADER:'__MoonDog Last Update', RETURN_STATUS_ID_HEADER:'__MoonDog Status ID', RETURN_ISSUANCE_CELL:'Q1', RECOVERY_PATH:['data','recovery.json'],
    XLSX:{read:()=>value, utils:{sheet_to_json:s=>[s.headers||[]]}}, model:{state:{records:[]},recovery},
    readJson:async()=>recovery, status(){}, ui:{sourceSelect:{value:''}},
    sourceFileHandle:async()=>({getFile:async()=>({arrayBuffer:async()=>new ArrayBuffer(1)})}),
    validateReturnedWorkbookFreshness:()=>{throw Error('canonical freshness reached');},
    legacyReport:()=>{throw Error('generic importer reached');},
    markSupervisorWorkbookStale:async()=>writes.push('stale'), backupState:async()=>writes.push('backup'),writeJson:async()=>writes.push('state')
  });
  vm.runInContext(helpers+issuance+source+returned,context);
  return {context,writes};
}
test('damaged returns never enter generic import, including renamed books and stripped headers',async()=>{
  for(const b of [book(['RO','__MoonDog Last Update']),book(['RO'],{},id),book(['RO'],{Keywords:'Service Operations Open RO Round Trip'})]){
    const {context,writes}=fixture(b);
    await assert.rejects(context.importSourceUnlocked('renamed.xlsx'),/Needs Review/);assert.deepEqual(writes,[]);
  }
});
test('outbound snapshots reject after rename or metadata removal',async()=>{
  for(const b of [book(['RO'],{Keywords:'MoonDog Advisor Handoff Snapshot'}),book(['RO'],{},'MoonDog outbound handoff')]){
    const {context,writes}=fixture(b);await assert.rejects(context.importSourceUnlocked('renamed.xlsx'),/outbound only/);assert.deepEqual(writes,[]);
    await assert.rejects(context.importReturnedWorkbookUnlocked('renamed.xlsx'),/outbound only/);
  }
});
test('official renamed return reaches freshness only with current durable issuance',async()=>{
  const b=book(['__MoonDog RO ID','Next action','Commitment date'],{},id);
  await assert.rejects(fixture(b).context.importSourceUnlocked('renamed.xlsx'),/canonical freshness reached/);
  for(const recovery of [null,{supervisorWorkbook:{stale:true,issuanceId:id}},{supervisorWorkbook:{stale:false,issuanceId:'obsolete'}}]){
    const {context,writes}=fixture(b,recovery);await assert.rejects(context.importSourceUnlocked('renamed.xlsx'),/missing|stale|latest verified issuance/);assert.deepEqual(writes,[]);
  }
});
test('legacy return without issuance fails closed and ordinary reports retain generic routing',async()=>{
  await assert.rejects(fixture(book(['__MoonDog RO ID','Next action','Commitment date'])).context.importSourceUnlocked('legacy.xlsx'),/no issuance ID/);
  await assert.rejects(fixture(book()).context.importSourceUnlocked('report.xlsx'),/generic importer reached/);
});
test('automatic classification rejects damaged return and outbound identities before any report parser',async()=>{
  const classify=extract('  async function classifyImportFile(', '  async function moveToLearn(');
  for(const b of [book(['RO'],{},id),book(['RO'],{},'MoonDog outbound handoff')]){
    const {context}=fixture(b);vm.runInContext(classify,context);await assert.rejects(context.classifyImportFile('renamed.xlsx',{},new ArrayBuffer(1)),/Needs Review/);
  }
});
test('unsigned recurring complete RO reports are staged before any state or source access',async()=>{
  const process=extract('  async function processClassifiedCandidate(', '  async function reconcileLearnedFiles(');
  const ctx=vm.createContext({});vm.runInContext(process,ctx);
  for(const kind of ['open-ro','open-ro-docx'])for(const location of ['inbox','learn','root'])await assert.rejects(ctx.processClassifiedCandidate({location},kind,new ArrayBuffer(1)),/Needs Review.*unsigned/);
});
test('Excel sheet names preserve ordinary names and safely distinguish long or invalid labels',()=>{
  const naming=extract('  function workbookSheetName(', '  function handoffAdvisorName(');
  const ctx=vm.createContext({handoffAdvisorName:code=>code==='1'?'Synthetic Advisor':'Very long / synthetic advisor name that exceeds Excel limits'});vm.runInContext(naming,ctx);
  assert.equal(ctx.workbookSheetName('1',['1']),'Synthetic Advisor 1');
  const names=['2','3'].map(code=>ctx.workbookSheetName(code,['2','3']));assert.equal(new Set(names).size,2);for(const name of names){assert.ok(name.length<=31);assert.doesNotMatch(name,/[\\/?*\[\]:]/);}
});
