'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const start=app.indexOf('  let supervisorWorkbookOperationTail = Promise.resolve();'),end=app.indexOf('  const dailyPickedSources = new Map();',start),guard=app.slice(start,end);
function wrapper(name){const a=app.indexOf('  async function '+name+'('),b=app.indexOf('\n  }',a);assert.ok(a>0&&b>a);return app.slice(a,b+4);}
const pristine=()=>({updatedAt:null,source:null,records:[],closedRecords:[]});
function harness(local=pristine(),durable=null){
 const model={root:{name:'SYNTHETIC fresh Workspace'},state:structuredClone(local),recovery:{}},calls={imports:0,writes:0};
 const context=vm.createContext({model,Promise,JSON,Error,STATE_PATH:['data','current-state.json'],RECOVERY_PATH:['data','recovery.json'],
  navigator:{locks:{request:async(_name,_options,fn)=>fn()}},readJson:async parts=>parts.at(-1)==='current-state.json'?structuredClone(durable):null,
  writeJson:async()=>{calls.writes++;},importSourceUnlocked:async()=>{calls.imports++;return 'xlsx accepted';},importCdkRepairOrdersDocxUnlocked:async()=>{calls.imports++;return 'docx accepted';}});
 vm.runInContext(guard+wrapper('importSource')+wrapper('importCdkRepairOrdersDocx')+';globalThis.xlsx=importSource;globalThis.docx=importCdkRepairOrdersDocx;globalThis.rawLock=withSupervisorWorkbookLock;',context);
 return {model,calls,context};
}
test('first XLSX and DOCX import enter the real shared guard in a genuinely empty Workspace',async()=>{
 for(const kind of ['xlsx','docx']){const h=harness();assert.equal(await h.context[kind]('synthetic-first-report',false,new Uint8Array()),kind+' accepted');assert.equal(h.calls.imports,1);assert.equal(h.calls.writes,0);assert.deepEqual(h.model.state,pristine());}
 const h=harness();await assert.rejects(h.context.rawLock(async()=>assert.fail('unscoped operation must not initialize missing state')),/Workspace changed/);
});
test('missing established state, retained records and ambiguous empty-state shapes never authorize first import',async()=>{
 for(const state of [
  {...pristine(),updatedAt:'2026-11-21T12:00:00.000Z'}, {...pristine(),source:{fileName:'synthetic-prior.xlsx'}},
  {...pristine(),records:[{ro:'SYNTHETIC-1'}]}, {...pristine(),closedRecords:[{ro:'SYNTHETIC-closed'}]},
  {...pristine(),reviewQueue:[{reason:'SYNTHETIC retained question'}]}, {...pristine(),records:null},
  {...pristine(),closedRecords:null}, {...pristine(),reviewQueue:null}, {...pristine(),source:''}
 ])for(const kind of ['xlsx','docx']){const h=harness(state),before=structuredClone(h.model.state);await assert.rejects(h.context[kind]('synthetic-report'),/Workspace changed/);assert.equal(h.calls.imports,0);assert.equal(h.calls.writes,0);assert.deepEqual(h.model.state,before);}
});
test('first-import opt-in cannot override a different durable source or retained manager state',async()=>{
 const local={...pristine(),updatedAt:'2026-11-21T12:00:00.000Z',source:{sha256:'synthetic-source-A'},records:[{ro:'SYNTHETIC-1',management:{owner:'SYNTHETIC manager A'}}]},durable=structuredClone(local);durable.records[0].management.owner='SYNTHETIC manager B';
 for(const kind of ['xlsx','docx']){const h=harness(local,durable);await assert.rejects(h.context[kind]('synthetic-report'),/Workspace changed/);assert.equal(h.calls.imports,0);assert.deepEqual(h.model.state,local);}
 for(const kind of ['xlsx','docx']){const h=harness(local,local);assert.equal(await h.context[kind]('synthetic-report'),kind+' accepted');}
});
