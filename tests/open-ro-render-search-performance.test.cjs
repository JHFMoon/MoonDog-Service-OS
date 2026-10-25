"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {performance}=require('node:perf_hooks');

const app=fs.readFileSync(path.join(__dirname,'..','assets','app.js'),'utf8');
function source(name){
  const start=app.indexOf('  function '+name+'(');
  const end=app.indexOf('\n  function ',start+11);
  assert.ok(start>=0&&end>start,'production helper exists: '+name);
  return app.slice(start,end);
}
const production=[
  source('advisorShownInSection'),source('openRoRecordVisible'),source('openRoVisibleRecords'),
  source('managementStatusDefinitions'),source('statusById'),source('canonicalReviewStatus'),
  source('currentCdkReviewStatus'),source('statusForRecord'),source('normalizeCommunication'),
  source('semanticFieldIssue'),source('clarificationFor'),source('isClosedManagement'),
  source('reviewedCanonicalStatus'),source('statusDetailsFor'),source('normalizedStatusDetail'),
  source('reviewStatusDetail'),source('validManagerReviewDate'),source('adminCloseoutValidDate'),
  source('adminCloseoutDaysLate'),source('adminCloseoutRevisionDay'),source('adminCloseoutState'),
  source('sortOpenRoRows'),source('renderTable')
].join('\n');


class SyntheticElement{
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.className='';this.hidden=false;this.disabled=false;this.textContent='';}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
}
function makeRecords(count){
  return Array.from({length:count},(_,i)=>({
    id:'synthetic-record-'+i,ro:String(10000+i),advisor:'Synthetic Advisor '+(i%13),
    customer:'Synthetic Customer '+(i%29),vehicle:'Synthetic Vehicle '+(i%17),
    sourceStatus:'Synthetic Repair '+(i%5),daysOpen:i%19,
    cdkOperational:{status:'Being Repaired',stale:false},
    management:{status:i%11===0?'Closed':'Being Repaired',nextAction:i%4===0?'':'Synthetic review',
      reviewDate:i%3===0?'2026-10-24':'2026-10-27',communication:'Updated',
      clarification:i===1?{reason:'Synthetic review'}:undefined,
      adminCloseout:i===2?{blocker:'Synthetic warranty follow-up',physicalWorkStatus:'verified',taskDate:'2026-10-23',expectedCloseDate:'2026-10-23',revisions:[]}:undefined}
  }));
}
function harness(records){
  const ui={
    searchInput:{value:''},advisorFilter:{value:''},sourceStatusFilter:{value:''},
    managementStatusFilter:{value:''},attentionFilter:{value:''},openRoSort:{value:'priority'},
    exactRoFilterNotice:{hidden:true,textContent:''},clarificationBanner:new SyntheticElement('div'),
    recordCount:{textContent:''},openFirstRecord:{disabled:false},roTable:new SyntheticElement('tbody')
  };
  const context={
    ui,model:{settings:{advisors:Object.fromEntries(Array.from({length:13},(_,i)=>[`synthetic-${i}`,{number:`synthetic-${i}`,name:'Synthetic Advisor '+i,participation:{openRo:true}}]))},state:{records,reviewQueue:[]}},
    FRESH_MANAGEMENT_STATUSES:['Awaiting Assignment','Work in Progress','Parts Estimate','Pending Authorization','Awaiting Technician Attention','Being Repaired','Ready for Review'],
    COMMUNICATION_STATUSES:['','Updated','Attempted / no response','Needs update','Not needed'],
    REVIEW_STATUS_DETAILS:{},statusRecord:(name,index)=>({id:'status-'+String(name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),name,enabled:true,order:index}),
    document:{createElement:tag=>new SyntheticElement(tag),createDocumentFragment:()=>new SyntheticElement('fragment')},
    ensureOpenRoRetrievalUi(){},norm:value=>String(value??'').trim().toLowerCase().replace(/\s+/g,' '),
    text:value=>value==null?'':String(value),localDateKey:()=> '2026-10-25',
    renderRecentlyReviewed(){}
  };
  vm.runInNewContext(production+'\nthis.renderOpenRos=renderTable;this.visibleRecords=openRoVisibleRecords;',context);
  return {context,ui,render:context.renderOpenRos};
}
function visibleRows(ui){
  const fragment=ui.roTable.children[0];
  return fragment?.children||[];
}
function percentile(values,p){
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.ceil(p*sorted.length)-1)];
}

test('production Open RO search and table render stay complete and lossless for large synthetic data',()=>{
  const rows=makeRecords(2100),before=JSON.stringify(rows),{ui,render}=harness(rows);
  ui.searchInput.value='synthetic customer 17';
  render();
  const expected=rows.filter(row=>row.customer.toLowerCase().includes('synthetic customer 17')).length;
  assert.equal(visibleRows(ui).length,expected);
  assert.match(ui.recordCount.textContent,/Showing \d+ of 2100 records/);
  assert.equal(JSON.stringify(rows),before,'render and search cannot mutate authoritative source records');
  const times=[];
  for(let i=0;i<12;i++){
    ui.searchInput.value=['synthetic customer 17','synthetic advisor 4','synthetic repair 2'][i%3];
    const start=performance.now();render();times.push(performance.now()-start);
    assert.ok(visibleRows(ui).length>0,'each representative search renders matching synthetic rows');
  }
  const p50=percentile(times,.50),p95=percentile(times,.95);
  console.log('Open RO synthetic VM search+filter+DOM p50='+p50.toFixed(3)+'ms p95='+p95.toFixed(3)+'ms (2,100 records; not browser/device timing)');
  assert.ok(p50>=0&&p95<1500,'synthetic large-table path remains bounded under 1.5 seconds');
  assert.equal(JSON.stringify(rows),before,'repeated table builds preserve all source values and order');
});

test('production Open RO visibility respects configured advisor participation',()=>{
  const rows=makeRecords(26),{context}=harness(rows);
  context.model.settings.advisors['synthetic-2'].participation.openRo=false;
  const visible=context.visibleRecords();
  assert.ok(visible.length<rows.length);
  assert.ok(visible.every(row=>row.advisor!=='Synthetic Advisor 2'));
  context.model.settings.advisors['synthetic-2'].participation.openRo=true;
  assert.equal(context.visibleRecords().length,rows.length);
});

test('production priority preparation promotes clarification and verified overdue closeout',()=>{
  const rows=makeRecords(12),{ui,render}=harness(rows);
  ui.searchInput.value='';
  render();
  const ids=visibleRows(ui).map(row=>row.dataset.id);
  assert.equal(ids[0],'synthetic-record-1','clarification is prioritized by the shipped helper');
  assert.equal(ids[1],'synthetic-record-2','verified overdue closeout is prioritized by the shipped helper');
});

test('exact RO search still finds the record outside active filters and labels the bypass',()=>{
  const rows=makeRecords(80),{ui,render}=harness(rows);
  ui.advisorFilter.value='No matching synthetic advisor';
  ui.searchInput.value=rows[13].ro;
  render();
  assert.equal(visibleRows(ui).length,1);
  assert.equal(visibleRows(ui)[0].dataset.id,rows[13].id);
  assert.equal(ui.exactRoFilterNotice.hidden,false);
  assert.equal(ui.exactRoFilterNotice.textContent,'Found outside current filters');
  assert.equal(ui.recordCount.textContent,'Showing 1 of 80 records');
});
