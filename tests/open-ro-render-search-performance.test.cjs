"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {performance}=require('node:perf_hooks');

const app=fs.readFileSync(path.join(__dirname,'..','assets','app.js'),'utf8');
const renderStart=app.indexOf('  function renderTable()');
const renderEnd=app.indexOf('\n  function ',renderStart+16);
const sortStart=app.indexOf('  function sortOpenRoRows(');
assert.ok(renderStart>=0&&renderEnd>renderStart,'production Open RO renderer exists');
assert.ok(sortStart>=0&&sortStart<renderStart,'production Open RO sorter exists');
const sorter=app.slice(sortStart,renderStart);
const renderer=app.slice(renderStart,renderEnd);

class SyntheticElement{
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.className='';this.hidden=false;this.disabled=false;this.textContent='';}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
}
function makeRecords(count){
  return Array.from({length:count},(_,i)=>({
    id:'synthetic-ro-'+i,ro:String(10000+i),advisor:'Synthetic Advisor '+(i%13),
    customer:'Synthetic Customer '+(i%29),vehicle:'Synthetic Vehicle '+(i%17),
    sourceStatus:'Synthetic Repair '+(i%5),daysOpen:i%19,
    cdkOperational:{status:'Synthetic Operational',stale:false},
    management:{status:i%11===0?'Closed':'Being Repaired',nextAction:i%4===0?'':'Synthetic review',
      reviewDate:i%3===0?'2026-10-24':'2026-10-27',communication:'Updated'}
  }));
}
function harness(records){
  const ui={
    searchInput:{value:''},advisorFilter:{value:''},sourceStatusFilter:{value:''},
    managementStatusFilter:{value:''},attentionFilter:{value:''},openRoSort:{value:'ro'},
    exactRoFilterNotice:{hidden:true,textContent:''},clarificationBanner:new SyntheticElement('div'),
    recordCount:{textContent:''},openFirstRecord:{disabled:false},roTable:new SyntheticElement('tbody')
  };
  const context={
    ui,model:{state:{reviewQueue:[]}},
    document:{createElement:tag=>new SyntheticElement(tag),createDocumentFragment:()=>new SyntheticElement('fragment')},
    ensureOpenRoRetrievalUi(){},
    norm:value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase(),
    localDateKey:()=> '2026-10-25',
    openRoVisibleRecords:()=>records,
    statusForRecord:record=>record.management?.status||'',
    reviewStatusDetail:()=>'',validManagerReviewDate:()=>false,
    clarificationFor:record=>Boolean(record.management?.clarification),
    isClosedManagement:management=>management?.status==='Closed',
    adminCloseoutState:()=>({active:false,overdue:false,needsCommitment:false,dueToday:false}),
    renderRecentlyReviewed(){}
  };
  vm.runInNewContext(sorter+'\n'+renderer+'\nthis.renderOpenRos=renderTable;',context);
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
  const rows=makeRecords(1500),before=JSON.stringify(rows),{ui,render}=harness(rows);
  ui.searchInput.value='synthetic customer 17';
  render();
  const expected=rows.filter(row=>row.customer.toLowerCase().includes('synthetic customer 17')).length;
  assert.equal(visibleRows(ui).length,expected);
  assert.match(ui.recordCount.textContent,/Showing \d+ of 1500 records/);
  assert.equal(JSON.stringify(rows),before,'render and search cannot mutate authoritative source records');
  const times=[];
  for(let i=0;i<12;i++){
    ui.searchInput.value=['synthetic customer 17','synthetic advisor 4','synthetic repair 2'][i%3];
    const start=performance.now();render();times.push(performance.now()-start);
    assert.ok(visibleRows(ui).length>0,'each representative search renders matching synthetic rows');
  }
  const p50=percentile(times,.50),p95=percentile(times,.95);
  console.log('Open RO synthetic VM search+filter+DOM p50='+p50.toFixed(3)+'ms p95='+p95.toFixed(3)+'ms (1,500 records; not browser/device timing)');
  assert.ok(p50>=0&&p95<1500,'synthetic large-table path remains bounded under 1.5 seconds');
  assert.equal(JSON.stringify(rows),before,'repeated table builds preserve all source values and order');
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
