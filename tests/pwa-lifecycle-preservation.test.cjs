'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../scripts/smoke_pwa_restart.mjs'),'utf8');
const start=source.indexOf('function assertLifecyclePreservation('),end=source.indexOf('async function settledSnapshot(',start);
assert.ok(start>0&&end>start);
const verify=vm.runInNewContext(source.slice(start,end)+';assertLifecyclePreservation',{assert});
const copy=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const at='2026-11-20T10:00:00.000Z';
 const before={pointer:{storeId:'SYNTHETIC-A',manifestHash:'a'.repeat(64),version:'0.10.17'},
  files:['data/current-state.json','data/settings.json','imports/synthetic-source.xlsx','data/history/prior.json','data/recovery.json','data/store-revision.json','MOONDOG_DIAGNOSTICS.md'].map(name=>[name,'a'.repeat(64)]),
  lifecycle:{recovery:{schemaVersion:1,lastSuccessfulConnectionAt:at,status:'Ready',lastBackup:null,lastRestore:null},
   revision:{schemaVersion:1,revision:10},diagnostics:'# Service Operations Dashboard Diagnostics\n- '+at+' | DURABLE WRITE | synthetic saved\n',dailyHistory:{}}};
 const after=copy(before);
 after.lifecycle.recovery.lastSuccessfulConnectionAt='2026-11-20T10:05:00.000Z';after.lifecycle.revision.revision=12;
 after.lifecycle.diagnostics+='- 2026-11-20T10:05:00.000Z | DURABLE WRITE | connection saved\n';
 for(const entry of after.files)if(['data/recovery.json','data/store-revision.json','MOONDOG_DIAGNOSTICS.md'].includes(entry[0]))entry[1]='b'.repeat(64);
 const id='daily-1795169100000-11111111-1111-4111-8111-111111111111',name='data/history/'+id+'.json';
 after.files.push([name,'c'.repeat(64)]);after.lifecycle.dailyHistory[name]={schemaVersion:1,id,at:'2026-11-20T10:05:00.000Z',type:'daily-task',details:{action:'opened'}};
 return {before,after};
}
test('native launch may advance only validated connection bookkeeping and append a daily event',()=>{
 const {before,after}=fixture();verify(before,after,'synthetic launch');
});
test('changed reports, manual records, settings and existing history still fail preservation',()=>{
 for(const name of ['data/current-state.json','data/settings.json','imports/synthetic-source.xlsx','data/history/prior.json']){
  const {before,after}=fixture();after.files.find(entry=>entry[0]===name)[1]='d'.repeat(64);
  assert.throws(()=>verify(before,after,'synthetic launch'),/original bytes changed/);
 }
 const {before,after}=fixture();after.files=after.files.filter(entry=>entry[0]!=='data/history/prior.json');
 assert.throws(()=>verify(before,after,'synthetic launch'),/missing original/);
});
test('regressed authority, recovery loss, erased diagnostics and forged new artifacts are refused',()=>{
 const cases=[
  state=>{state.pointer.storeId='SYNTHETIC-B';},
  state=>{state.lifecycle.revision.revision=9;},
  state=>{state.lifecycle.recovery.lastSuccessfulConnectionAt='2026-11-19T10:00:00.000Z';},
  state=>{state.lifecycle.recovery.lastRestore={unexpected:true};},
  state=>{state.lifecycle.diagnostics='# Service Operations Dashboard Diagnostics\n';},
  state=>{state.files.push(['data/unapproved.json','e'.repeat(64)]);},
  state=>{Object.values(state.lifecycle.dailyHistory)[0].type='source-import';},
  state=>{Object.values(state.lifecycle.dailyHistory)[0].id='wrong-history-identity';}
 ];
 for(const mutate of cases){const {before,after}=fixture();mutate(after);assert.throws(()=>verify(before,after,'synthetic launch'));}
});

test('published Beta performance readiness requires visible correct gross and pace within a fixed deadline',()=>{
 const key='await page.waitForFunction(({gross,pace})=>{';
 const begin=source.indexOf(key),end=source.indexOf('},{gross:STORE_GROSS.toLocaleString',begin);
 assert.ok(begin>0&&end>begin,'Production browser proof must require a bounded rendered performance panel');
 const block=source.slice(begin+key.length,end);
 let active=true,rendered='';
 const predicate=vm.runInNewContext('({gross,pace})=>{'+block+'}',{
  document:{querySelector(query){assert.equal(query,'#view-performance.active');return active?{innerText:rendered}:null;}}
 });
 const expected={gross:'500',pace:'1,375'};
 assert.equal(predicate(expected),false,'Initial unrendered panel must not count as verified');
 rendered='No report loaded';assert.equal(predicate(expected),false,'An unhydrated panel must fail');
 rendered='Current MTD: $500';assert.equal(predicate(expected),false,'Gross alone is not enough');
 rendered+=' Month pace: $1,375';assert.equal(predicate(expected),true,'Correct gross and pace prove settled display');
 assert.equal(predicate({gross:'0',pace:'0'}),false,'Do not reinterpret unknown or another store as zero');
 rendered='Current MTD: $0 Month pace: $0';
 assert.equal(predicate({gross:'0',pace:'0'}),true,'Explicit verified zero must remain valid');
 active=false;assert.equal(predicate({gross:'0',pace:'0'}),false,'Hidden view is never ready');
 assert.match(source.slice(begin,end+120),/timeout:15000/,'The render readiness wait must be bounded');
 assert.match(source,/publishedPerformanceReadinessFailure:true/,'Timeouts must record safe public UI diagnostics');
});
