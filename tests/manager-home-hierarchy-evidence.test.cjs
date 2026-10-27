const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../assets/daily-ops.js'),'utf8');

function harness(){
  const start=app.indexOf('  function verifiedGrossPaceDirection(){');
  const end=app.indexOf('  function skippedAdvisorsToday(){',start);
  assert.ok(start>=0&&end>start,'production manager evidence helpers are available');
  const synthetic={
    performance:{snapshots:{
      early:{periodStart:'2026-10-01',periodEnd:'2026-10-19',saprDaysCompleted:15,
        store:{cpGross:60000},validation:{saprDaysVerified:true,finalTotalsVerified:true}},
      current:{periodStart:'2026-10-01',periodEnd:'2026-10-26',saprDaysCompleted:20,
        store:{cpGross:100000},validation:{saprDaysVerified:true,finalTotalsVerified:true}}
    }}
  };
  const state={events:[]},navigation=[],currentTasks=[];
  let health={safeForCurrent:true,periodEnd:'2026-10-26'};
  const element=tag=>({tag,children:[],attributes:{},className:'',textContent:'',
    setAttribute(name,value){this.attributes[name]=value;},
    append(...items){this.children.push(...items);}
  });
  const context=vm.createContext({Date,Intl,model:synthetic,state,
    today:()=> '2026-10-26',now:()=>Date.parse('2026-10-26T18:00:00Z'),
    document:{createElement:element},
    button:(label,click)=>({tag:'button',label,click}),go:view=>navigation.push(view),
    allTasks:()=>currentTasks,
    __moondogFreshness:{sourceFreshness:()=>health}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/daily-engine.js'),'utf8'),context);
  vm.runInContext('this.engine=MoonDogDailyEngine;',context);
  vm.runInContext(app.slice(start,end)+';this.pace=verifiedGrossPaceDirection;'+
    'this.deferred=managerDeferredCount;this.renderEvidence=renderManagerEvidence;',context);
  return {context,state,synthetic,navigation,currentTasks,setHealth:value=>{health=value;},element};
}

test('Home improvement is derived only from comparable, validated, current SAPR periods',()=>{
  const h=harness();
  assert.match(h.context.pace(),/improved: \$4,000 to \$5,000/);
  h.setHealth({safeForCurrent:false,periodEnd:'2026-10-26'});
  assert.match(h.context.pace(),/not verified.*missing or stale/i);
  h.setHealth({safeForCurrent:true,periodEnd:'2026-10-26'});
  h.synthetic.performance.snapshots.early.periodStart='2026-09-01';
  assert.match(h.context.pace(),/not verified.*another comparable/i);
  h.synthetic.performance.snapshots.early.periodStart='2026-10-01';
  h.synthetic.performance.snapshots.current.store.cpGross=65000;
  assert.match(h.context.pace(),/No verified improvement/);
  h.synthetic.performance.snapshots.current.validation.finalTotalsVerified=false;
  assert.match(h.context.pace(),/not verified/i);
});

test('manager-deferral count matches live eligibility and invalidates changed source or escalation',()=>{
  const h=harness();
  const task=(id,rank=5,fingerprint='initial')=>({
    id,type:'ro',rank,fingerprint,record:{management:{}}
  });
  const held=task('SYN-1');
  const stale=task('SYN-2',5,'changed-source');
  const urgent=task('SYN-3',2,'original');
  h.currentTasks.push(held,stale,urgent);
  h.state.events=[
    {at:'2026-10-26T17:00:00Z',details:{taskId:'SYN-1',action:'deferred',until:'2026-10-27T12:00:00Z',rank:5,fingerprint:'initial'}},
    {at:'2026-10-26T17:00:00Z',details:{taskId:'SYN-2',action:'deferred',until:'2026-10-27T12:00:00Z',rank:5,fingerprint:'original'}},
    {at:'2026-10-26T17:00:00Z',details:{taskId:'SYN-3',action:'deferred',until:'2026-10-27T12:00:00Z',rank:5,fingerprint:'original'}},
    {at:'2026-10-26T17:00:00Z',details:{taskId:'SYN-4',action:'deferred',until:'2026-10-27T12:00:00Z',rank:5,fingerprint:'removed'}}
  ];
  assert.equal(h.context.deferred(),1,
    'only the same live task with unchanged source/rank remains manager-deferred');
  held.fingerprint='fresh-source';
  assert.equal(h.context.deferred(),0,'fresh source evidence cancels Can wait classification');
  held.fingerprint='initial';
  assert.equal(h.context.deferred(),1);
  h.state.events.push({at:'2026-10-26T18:00:00Z',details:{taskId:'SYN-1',action:'completed'}});
  assert.equal(h.context.deferred(),0,'the latest manager action invalidates an earlier deferral');
});

test('Improving and Can wait are separate named and actionable summaries, not unsupported claims',()=>{
  const h=harness();
  h.setHealth({safeForCurrent:false});
  const host=h.element('main');
  h.context.renderEvidence(host);
  assert.equal(host.children.length,1);
  const section=host.children[0];
  assert.equal(section.attributes['aria-label'],'Manager improvement and deferred work');
  const [improving,deferred]=section.children;
  assert.equal(improving.children[0].textContent,'Improving');
  assert.match(improving.children[1].textContent,/not verified/i);
  assert.equal(deferred.children[0].textContent,'Can wait');
  assert.match(deferred.children[1].textContent,/Unreviewed work is not automatically safe/i);
  improving.children[2].click();
  deferred.children[2].click();
  assert.deepEqual(h.navigation,['performance','open-ro']);
});

test('Home keeps Action now and At risk visible when no immediate task exists',()=>{
  const start=app.indexOf('  function renderHome(prioritizedTop=null){');
  const end=app.indexOf('  // #58-03:',start);
  assert.ok(start>=0&&end>start,'production Home renderer exists');
  const source=app.slice(start,end);
  assert.match(source,/Action now · Manager attention/);
  assert.match(source,/if\(!task\)\{\s*const empty=document\.createElement\('section'\)/);
  assert.match(source,/No confirmed immediate priority selected/);
  assert.doesNotMatch(source,/if\(!task\)\{host\.replaceChildren\(\);return;\}/);
  assert.match(source,/renderManagerEvidence\(host\)/);
  assert.match(source,/host\.append\(pulse\)/);
  assert.match(app,/AT RISK/);
  assert.match(app,/No flagged RO risks in the loaded source/);
  assert.match(app,/if\(category==='recovery'\)/,'destructive/recovery tools remain separate from everyday settings');
});
