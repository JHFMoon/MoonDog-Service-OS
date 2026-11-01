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
  assert.match(fn,/openRoHealth\.safeForCurrent&&openRoHealth\.reportPeriodVerified\?performanceFormat\(trackerOpenCount\(code\), "count"\):"UPDATE PENDING"/,
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


test("production source-lineage UI labels preserve every authority state for all catalogued families",()=>{
  const p=productionSourceLineage();
  const families=Object.keys(require("../assets/freshness.js").SOURCE_DEFINITIONS);
  assert.equal(families.length,14,"every catalogued source family is covered");

  const cases=[
    ["missing",{status:"missing",loaded:false},"Missing · Report period: Not verified · Last imported: Not verified"],
    ["stale",{status:"stale",loaded:true,reportPeriodVerified:true,periodStart:"2026-10-01",periodEnd:"2026-10-06",importTimestamp:"2026-10-07T15:00:00.000Z"},"Loaded but stale · Needs updating · Report period: 2026-10-01 through 2026-10-06 · Last imported: 2026-10-07 15:00 UTC"],
    ["unsupported",{status:"invalid",loaded:true,reason:"Unsupported synthetic report layout"},"Loaded · validation needed · Report period: Not verified · Last imported: Not verified"],
    ["conflict",{status:"invalid",loaded:true,reason:"Conflicting duplicate synthetic source period"},"Conflict · Review required · Report period: Not verified · Last imported: Not verified"],
    ["invalid-period",{status:"invalid",loaded:true,reason:"Report period is malformed"},"Invalid period · Review required · Report period: Not verified · Last imported: Not verified"],
    ["unavailable",{status:"temporarily-unavailable",loaded:true,reason:"Synthetic read was busy"},"Temporarily unavailable · Report period: Not verified · Last imported: Not verified"],
    ["not-used",{status:"not-used",loaded:false},"Not used · Report period: Not verified · Last imported: Not verified"],
    ["current-zero",{status:"current",loaded:true,reportPeriodVerified:true,periodStart:"2026-10-01",periodEnd:"2026-10-06",importTimestamp:"2026-10-07T15:00:00.000Z",verifiedValue:0},"Current · Report period: 2026-10-01 through 2026-10-06 · Last imported: 2026-10-07 15:00 UTC"]
  ];

  for(const family of families){
    for(const [label,evidence,expected] of cases){
      assert.equal(p.lineageLabel({...evidence,key:family}),expected,family+" "+label);
    }
  }
});


test('undated Open RO import is not labelled as a verified CURRENT report',()=>{
  const p=productionSourceLineage();
  const undated={key:'openRo',status:'current',loaded:true,reportPeriodVerified:false,
    importTimestamp:'2026-10-26T12:00:00Z'};
  const label=p.lineageLabel(undated);
  assert.match(label,/^Recently imported · Report period not verified · Report period: Not verified/);
  assert.match(label,/Last imported: 2026-10-26 12:00 UTC/);
  assert.notEqual(p.statusLabel(undated),'Current');
  const verified={...undated,reportPeriodVerified:true,periodStart:'2026-10-26',periodEnd:'2026-10-26'};
  assert.match(p.lineageLabel(verified),/^Current · Report period: 2026-10-26/);
});

test('Performance tracker refuses an undated Open RO as a verified zero',()=>{
  const start=app.indexOf('function renderPerformanceVerified()');
  const end=app.indexOf('  const TREND_SOURCES=',start);
  assert.ok(start>=0&&end>start,'production Performance renderer exists');
  const cells=[];
  const row={querySelector:selector=>selector==='td:first-child small'?{textContent:'SYN-A'}:null,
    append:cell=>cells.push(cell)};
  const ui={performanceAdvisor:{value:'store'},performanceSource:{textContent:''},
    performanceAdvisorNote:{textContent:''},
    performanceKpis:{querySelectorAll:()=>[]},
    performanceAdvisorTable:{querySelectorAll:()=>[row]}};
  const model={performance:{snapshots:{'2026-10-26':{
    advisors:{'SYN-A':{}},periodStart:'2026-10-01',periodEnd:'2026-10-26',
    sourceFile:'synthetic-sapr.xlsx'}}},state:{source:{fileName:'synthetic-open-ro.xlsx'}}};
  let health={key:'openRo',status:'current',safeForCurrent:true,
    reportPeriodVerified:false,importTimestamp:'2026-10-26T12:00:00Z'};
  let calculations=0;
  const ctx=vm.createContext({model,ui,sourceFreshness:key=>key==='openRo'?health:{key:'sapr',status:'current'},
    sourceLineageLabel:e=>e.key==='openRo'?'Open RO · period unknown':'SAPR · verified',
    renderPerformanceBase:()=>{},renderPerformanceExecutive:()=>{},
    renderCurrentMonthTrend:()=>{},renderControllables:()=>{},
    document:{createElement:()=>({className:'',textContent:''})},
    trackerOpenCount:()=>{calculations++;return 0;},
    performanceFormat:value=>String(value)});
  vm.runInContext(app.slice(start,end)+';this.renderPerformanceVerified=renderPerformanceVerified;',ctx);
  ctx.renderPerformanceVerified();
  assert.equal(cells.at(-1).textContent,'UPDATE PENDING');
  assert.equal(calculations,0,'unknown report period cannot produce a current count');
  health={...health,reportPeriodVerified:true};
  ctx.renderPerformanceVerified();
  assert.equal(cells.at(-1).textContent,'0','verified source must preserve a real zero');
  assert.equal(calculations,1);
  health={...health,safeForCurrent:false};
  ctx.renderPerformanceVerified();
  assert.equal(cells.at(-1).textContent,'UPDATE PENDING');
  assert.equal(calculations,1);
});


test('production Performance advisor table treats imported identity as text, never markup or a split delimiter',()=>{
  const start=app.indexOf('  function renderPerformance() {');
  const end=app.indexOf('  const renderPerformanceBase = renderPerformance;',start);
  assert.ok(start>0&&end>start,'production Performance renderer is available');
  let tableHtmlAssignments=0;
  function node(tag){
    return {tag,children:[],className:'',textContent:'',
      append(...items){this.children.push(...items);},
      replaceChildren(...items){this.children=items;},
      set innerHTML(value){if(tag==='td')tableHtmlAssignments++;this.html=value;},
      get innerHTML(){return this.html||'';}};
  }
  const advisorName='<img src=x onerror="synthetic-injection">|Alice';
  const advisorCode='A&B';
  const source={date:'2026-10-31',periodStart:'2026-10-01',periodEnd:'2026-10-31',
    sourceFile:'synthetic-sapr.xlsx',store:{name:'Store',totalGross:120},
    advisors:{'A&B':{code:advisorCode,name:advisorName,totalGross:120,totalRO:2}}};
  const table=node('table'), select={value:'store',children:[],
    replaceChildren(...values){this.children=values;},add(item){this.children.push(item);}};
  const ui={performanceAdvisor:select,performanceSource:node('div'),performancePeriod:node('div'),
    performanceKpis:node('div'),performanceTrendTitle:node('div'),performanceTrendNote:node('div'),
    performanceTrendCount:node('div'),performanceChanges:node('div'),
    performanceAdvisorNote:node('div'),performanceAdvisorTable:table,
    performanceMetric:{value:'totalGross'}};
  const context=vm.createContext({
    model:{performance:{snapshots:{'2026-10-31':source}}},ui,
    document:{createElement:node},Option:function(label,value){return {label,value};},
    advisorShownInSection:()=>true,performanceEntity:(snapshot,selection)=>
      selection==='store'?snapshot.store:snapshot.advisors[selection],
    performanceDelta:()=>null,performanceFormat:value=>String(value??'—'),
    performanceMetricMeta:{totalGross:['Total gross','money']},
    renderPerformanceChart:()=>{}
  });
  vm.runInContext(app.slice(start,end)+';this.render=renderPerformance;',context);
  context.render();
  assert.equal(table.children.length,1);
  const first=table.children[0].children[0];
  assert.equal(first.tag,'td');
  assert.deepEqual(first.children.map(item=>item.tag),['strong','small']);
  assert.equal(first.children[0].textContent,advisorName,'literal HTML-looking text is retained');
  assert.equal(first.children[1].textContent,advisorCode,'code is not interpreted as markup');
  assert.equal(tableHtmlAssignments,0,'no imported advisor identity enters table HTML');
  assert.equal(table.children[0].children[1].textContent,'120',
    'existing numeric Performance KPI cell remains unchanged');
});
