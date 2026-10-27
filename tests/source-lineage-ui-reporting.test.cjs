const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');

function productionSourceLineage(){
  const start=app.indexOf('  function sourceStatusLabel(evidence)');
  const end=app.indexOf('  function advisorNextWin(',start);
  assert.ok(start>0&&end>start,'production source confidence helpers exist');
  const context=vm.createContext({Date,Intl});
  vm.runInContext(app.slice(start,end)+
    ';this.statusLabel=sourceStatusLabel;this.lineageLabel=sourceLineageLabel;',context);
  return context;
}

test('current sources present report coverage separately from validated import time',()=>{
  const p=productionSourceLineage();
  const label=p.lineageLabel({status:'current',loaded:true,periodStart:'2026-10-01',
    periodEnd:'2026-10-26',sourceTimestamp:'2026-10-27T01:16:00Z'});
  assert.match(label,/^Current · Report period: 2026-10-01 through 2026-10-26/);
  assert.match(label,/Last imported: 2026-10-27 01:16 UTC/);
  assert.doesNotMatch(label,/Last\/period/);
});

test('recent import cannot relabel a stale source as current or invent a valid reporting period',()=>{
  const p=productionSourceLineage();
  const stale=p.lineageLabel({status:'stale',loaded:true,
    periodEnd:'2026-10-05',sourceTimestamp:'2026-10-27T09:01:00Z'});
  assert.match(stale,/Loaded but stale · Needs updating/);
  assert.match(stale,/Report period: 2026-10-05/);
  assert.match(stale,/Last imported: 2026-10-27 09:01 UTC/);
  const invalid=p.lineageLabel({status:'invalid',loaded:true,
    sourceTimestamp:'not-a-timestamp',periodStart:'',periodEnd:''});
  assert.match(invalid,/Loaded · validation needed/);
  assert.match(invalid,/Report period: Not verified/);
  assert.match(invalid,/Last imported: Not verified/);
});

test('missing and unused sources have truthful unknown coverage, not fabricated values or dates',()=>{
  const p=productionSourceLineage();
  const missing=p.lineageLabel({status:'missing',loaded:false});
  assert.match(missing,/^Missing · Report period: Not verified · Last imported: Not verified$/);
  const unused=p.lineageLabel({status:'not-used',loaded:false,
    sourceTimestamp:'2026-10-27',periodEnd:''});
  assert.match(unused,/^Not used/);
  assert.match(unused,/Last imported: Not verified/);
  assert.doesNotMatch(missing,/0\.0%|\$0/);
});

test('Home data health and Performance SAPR/tracker views use the same production lineage contract',()=>{
  assert.match(app,/item\.textContent = \`\$\{need\.label\}: \$\{need\.state\} · \$\{sourceLineageLabel\(evidence\)\}/);
  const start=app.indexOf('function renderPerformanceVerified()');
  const end=app.indexOf('  const TREND_SOURCES=',start);
  assert.ok(start>0&&end>start);
  const fn=app.slice(start,end);
  assert.match(fn,/sourceLineageLabel\(saprHealth\)/);
  assert.match(fn,/sourceLineageLabel\(openRoHealth\)/);
  assert.match(fn,/openRoHealth\.safeForCurrent\?performanceFormat\(trackerOpenCount\(code\), "count"\):"UPDATE PENDING"/,
    'unverified Open RO tracking must not present zero as a verified count');
});
