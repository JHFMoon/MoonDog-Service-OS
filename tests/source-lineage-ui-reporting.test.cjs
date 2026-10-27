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
  const label=p.lineageLabel({status:'current',loaded:true,reportPeriodVerified:true,
    periodStart:'2026-10-01',periodEnd:'2026-10-26',
    sourceTimestamp:'2026-10-26T22:00:00Z',importTimestamp:'2026-10-27T01:16:00Z'});
  assert.match(label,/^Current · Report period: 2026-10-01 through 2026-10-26/);
  assert.match(label,/Last imported: 2026-10-27 01:16 UTC/);
  assert.doesNotMatch(label,/Last\/period/);
});

test('recent import cannot relabel a stale source as current or invent a valid reporting period',()=>{
  const p=productionSourceLineage();
  const stale=p.lineageLabel({status:'stale',loaded:true,reportPeriodVerified:true,
    periodEnd:'2026-10-05',sourceTimestamp:'2026-10-05T18:00:00Z',
    importTimestamp:'2026-10-27T09:01:00Z'});
  assert.match(stale,/Loaded but stale · Needs updating/);
  assert.match(stale,/Report period: 2026-10-05/);
  assert.match(stale,/Last imported: 2026-10-27 09:01 UTC/);
  const invalid=p.lineageLabel({status:'invalid',loaded:true,
    sourceTimestamp:'not-a-timestamp',periodStart:'',periodEnd:'',reportPeriodVerified:false});
  assert.match(invalid,/Loaded · validation needed/);
  assert.match(invalid,/Report period: Not verified/);
  assert.match(invalid,/Last imported: Not verified/);
});

test('generated, modified, and observation timestamps are not mislabeled as imports',()=>{
  const p=productionSourceLineage();
  const generated=p.lineageLabel({status:'current',loaded:true,reportPeriodVerified:false,
    periodStart:'2026-10-27',periodEnd:'2026-10-27',
    sourceTimestamp:'2026-10-27T12:00:00Z'});
  assert.match(generated,/Report period: Not verified/);
  assert.match(generated,/Last imported: Not verified/);
  const observed=p.lineageLabel({status:'current',loaded:true,reportPeriodVerified:true,
    periodEnd:'2026-10-26',sourceTimestamp:'2026-10-26T22:00:00Z'});
  assert.match(observed,/Report period: 2026-10-26/);
  assert.match(observed,/Last imported: Not verified/);
});

test('missing and unused sources have truthful unknown coverage, not fabricated values or dates',()=>{
  const p=productionSourceLineage();
  const missing=p.lineageLabel({status:'missing',loaded:false,
    periodStart:'2026-10-27',periodEnd:'2026-10-27',reportPeriodVerified:false});
  assert.match(missing,/^Missing · Report period: Not verified · Last imported: Not verified$/);
  const unused=p.lineageLabel({status:'not-used',loaded:false,
    sourceTimestamp:'2026-10-27T12:00:00Z',periodEnd:'2026-10-27',
    reportPeriodVerified:false});
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

function productionCsiReportedPeriod(){
  const start=app.indexOf('  function csiReportedPeriod(');
  const end=app.indexOf('  function sourceFreshness(',start);
  assert.ok(start>0&&end>start,'production CSI coverage helper exists');
  const context=vm.createContext({});
  vm.runInContext(app.slice(start,end)+';this.csiReportedPeriod=csiReportedPeriod;',context);
  return context.csiReportedPeriod;
}

test('CSI lineage uses verified export scope, not the configured scoring-window start',()=>{
  const period=productionCsiReportedPeriod();
  assert.deepEqual(JSON.parse(JSON.stringify(period('2026-10-20','2026-10-26',''))),
    {periodStart:'2026-10-20',periodEnd:'2026-10-26',verified:true});
  assert.deepEqual(JSON.parse(JSON.stringify(period('','2026-10-26',''))),
    {periodStart:'',periodEnd:'2026-10-26',verified:true});
  assert.deepEqual(JSON.parse(JSON.stringify(period('','','2026-10-26'))),
    {periodStart:'2026-10-26',periodEnd:'2026-10-26',verified:true});
  assert.deepEqual(JSON.parse(JSON.stringify(period('','',''))),
    {periodStart:'',periodEnd:'',verified:false});
  const start=app.indexOf('if (key === "csi")');
  const end=app.indexOf('if (key === "nextAppointments")',start);
  const branch=app.slice(start,end);
  assert.match(branch,/periodStart: reportPeriod\.periodStart/);
  assert.match(branch,/periodEnd: reportPeriod\.periodEnd/);
  assert.doesNotMatch(branch,/model\.settings\.csiPeriodStart/,
    'configured scoring window must not be presented as source coverage');
});
