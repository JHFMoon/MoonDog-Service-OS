const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Home uses one evidence-driven Top 3, including needed reports and direct actions', () => {
  const ui = read('assets/daily-ops.js');
  assert.match(ui, /function attentionTopThree\(/);
  assert.match(ui, /planner\?\.topFive\(allTasks\(\),state\.events,engine,now\(\)\)/);
  assert.match(ui, /planner\?\.plan\(api\.reportRefreshRequests\(today\(\)\)/);
  assert.match(ui, /slice\(0,3\)/);
  assert.match(ui, /Advisor Notified/);
  assert.match(ui, /Not an Issue/);
  assert.match(ui, /go\('home'\);await selectNext\(\)/);
  assert.match(ui, /host\.querySelector\('\.daily-data-needed'\)\?\.remove\(\)/);
});

test('coaching requires a validated sample and uses the configured ELR target', () => {
  const context = vm.createContext({Date, Intl});
  vm.runInContext(read('assets/daily-engine.js'), context);
  const engine = context.MoonDogDailyEngine;
  const metricKey = ['cp', 'Elr'].join('');
  const snapshot = {
    periodEnd: '2026-10-08', importedAt: '2026-10-08T16:00:00Z',
    validation: { saprDaysVerified:true, finalTotalsVerified:true, advisorDetailSheets:true,
      controllables:0, controllableVinDenominator:'' },
    advisors: {'101': {cpRO:16, [metricKey]:193}}
  };
  const standardKey = ['cp', 'Elr'].join('');
  const standards = {[standardKey]:210};
  const selected = engine.coachingTasks(snapshot,[{number:101,name:'Advisor A'}],standards,true,'2026-10-08');
  assert.equal(selected.length, 1);
  assert.equal(selected[0].key,'cpElr');
  assert.equal(selected[0].target,210);
  assert.match(selected[0].next,/discounts, labor pricing, hours sold/);
  assert.equal(engine.coachingTasks({...snapshot,advisors:{'101':{cpRO:2,[metricKey]:193}}},[{number:101,name:'Advisor A'}],standards,true,'2026-10-08').length,0);
  assert.equal(engine.coachingTasks(snapshot,[{number:101,name:'Advisor A'}],standards,false,'2026-10-08').length,0);
});

test('advisor notification waits 3 configured working days; material decline overrides the wait', () => {
  const context = vm.createContext({Date, Intl, __moondogSettingsModel:{settings:{future:{managementSchedule:{days:[2,3,4,5,6]}}}}});
  vm.runInContext(read('assets/daily-engine.js'),context);
  const engine=context.MoonDogDailyEngine;
  const item={type:'coaching',id:'coaching:101:cpElr',key:'cpElr',actual:196,rank:6,fingerprint:'fresh-report'};
  const event={at:'2026-10-08T18:00:00Z',details:{taskId:item.id,action:'completed',actual:198,fingerprint:'old-report'}};
  assert.equal(engine.eligible(item,[event],Date.parse('2026-10-12T18:00:00Z')),false);
  assert.equal(engine.eligible(item,[event],Date.parse('2026-10-14T18:00:00Z')),true);
  assert.equal(engine.eligible({...item,actual:190},[event],Date.parse('2026-10-09T18:00:00Z')),true);
});

test('Visible-only update polling fetches metadata without automatic installation or data upload', () => {
  const update = read('assets/moondog-update-settings.js');
  assert.ok(update.includes('function checkInBackground()'));
  assert.ok(update.includes('AUTOMATIC_RECHECK_MS = 30 * 60 * 1000'));
  assert.ok(update.includes('AUTOMATIC_RETRY_MS = 5 * 60 * 1000'));
  assert.ok(update.includes('document.hidden || !appRoot() || state.busy'));
  assert.ok(update.includes('void check(false)'));
  assert.ok(update.includes('data-update-install'));
  assert.ok(update.includes('data-update-changes'));
  assert.ok(update.includes('data-update-later'));
  assert.ok(update.includes('installButton.click()'));
  assert.ok(update.includes('note.textContent = value.releaseNotes'));
  assert.equal(update.includes('fetch(customer'),false);
});

test('Home RO completion respects the configured store calendar, not a hardcoded timezone',()=>{
  const at=Date.parse('2026-10-13T13:00:00Z'); // Oct 14 in Auckland, Oct 13 in Los Angeles
  const context=vm.createContext({Date,Intl,MoonDogFreshness:{
    DEFAULT_TIME_ZONE:'Pacific/Auckland',
    dateKey:(date,zone)=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day;}
  },__moondogSettingsModel:{settings:{store:{timeZone:'Pacific/Auckland'}}}});
  vm.runInContext(read('assets/daily-engine.js'),context);
  const task={id:'ro:abc',type:'ro',rank:4,fingerprint:'same',record:{management:{reviewDate:'2026-10-14'}}};
  const event={at:'2026-10-12T12:00:00Z',details:{taskId:task.id,action:'completed',fingerprint:'same',rank:4,until:'2026-10-12T12:00:00Z'}};
  assert.equal(context.MoonDogDailyEngine.eligible(task,[event],at),true);
});

test('Two-day ROs without a viable plan receive an actionable review task',()=>{
 const context=vm.createContext({Date,Intl});
 vm.runInContext(read('assets/daily-engine.js'),context);
 const engine=context.MoonDogDailyEngine;
 const two={daysOpen:2,management:{status:'Repair',nextAction:'',reviewDate:''}};
 const review=engine.stuckWork(two,'2026-10-13');
 assert.equal(review.kind,'aged-review');
 assert.match(review.title,/2\+ day RO/);
 assert.equal(review.rank,4);
 const withPlan={...two,management:{owner:'Advisor A',communication:'Updated',nextAction:'Finish repair',reviewDate:'2026-10-14'}};
 assert.equal(engine.stuckWork(withPlan,'2026-10-13'),null);
});
test('Five-day ROs require owner, communication, and next review even if an action is recorded',()=>{
 const context=vm.createContext({Date,Intl});
 vm.runInContext(read('assets/daily-engine.js'),context);
 const engine=context.MoonDogDailyEngine;
 const base={daysOpen:5,management:{status:'Waiting Parts',nextAction:'Check parts ETA',reviewDate:'2026-10-14',owner:'Advisor A',communication:'Updated'}};
 assert.equal(engine.stuckWork(base,'2026-10-13'),null);
 assert.equal(engine.stuckWork({...base,management:{...base.management,owner:''}},'2026-10-13').kind,'missing-plan');
 assert.equal(engine.stuckWork({...base,management:{...base.management,communication:''}},'2026-10-13').kind,'missing-plan');
 assert.equal(engine.stuckWork({...base,management:{...base.management,reviewDate:''}},'2026-10-13').kind,'missing-plan');
});

test('controllable coaching ignores small percentage gaps and requires meaningful volume', () => {
  const context = vm.createContext({Date, Intl});
  vm.runInContext(read('assets/daily-engine.js'), context);
  const engine = context.MoonDogDailyEngine;
  const advisors = [{number:101,name:'Advisor A'}];
  const snapshot = (cpRO,actual,brandAverage,eligibleVins=cpRO) => ({
    periodEnd:'2026-10-17', importedAt:'2026-10-17T17:00:00Z',
    validation:{saprDaysVerified:true,finalTotalsVerified:true,advisorDetailSheets:true,
      controllables:7,controllableVinDenominator:'cp-ro'},
    advisors:{'101':{cpRO,[['cp','Elr'].join('')]:210,[['media','Viewed'].join('')]:90}},
    controllables:{advisors:{'101':{tires:{actual,brandAverage,eligibleVins}}}}
  });
  const configured = { [['cp','Elr'].join('')]:210, [['media','Viewed'].join('')]:85 };
  const coaching = value => engine.coachingTasks(value,advisors,configured,true,'2026-10-17');
  assert.equal(coaching(snapshot(200,3.3,3.4)).length,0,
    'A 0.1 percentage-point miss should never consume a coaching slot.');
  assert.equal(coaching(snapshot(20,0,3.4)).length,0,
    'A large percentage gap based on less than one projected lost opportunity is too noisy.');
  assert.equal(coaching(snapshot(100,74,80)).length,0,
    'A shortfall smaller than 10% of a high benchmark is not material.');
  assert.equal(coaching(snapshot(100,0,3.4,99)).length,0,
    'Invalid eligible-VIN denominator must not generate a coaching alert.');
  const meaningful = coaching(snapshot(100,2.3,3.4));
  assert.equal(meaningful.length,1);
  assert.equal(meaningful[0].key,'tires');
  assert.match(meaningful[0].description,/100 CP ROs/);
  assert.match(meaningful[0].next,/inspection findings/);
  assert.equal(coaching(snapshot(50,0,3.4)).length,1,
    'A zero result on enough CP ROs remains actionable for low-incidence products.');
  assert.equal(coaching(snapshot(100,70,80)).length,1,
    'A clearly substantial high-frequency shortfall must still appear.');
  assert.equal(coaching(snapshot(100,17.1,19)).length,1,
    'A precise decimal boundary remains actionable after scaled comparison.');
  assert.equal(coaching(snapshot(100,17.11,19)).length,0,
    'A near miss above the relative gap boundary must stay suppressed.');
  assert.equal(coaching({...snapshot(100,0,3.4),validation:{...snapshot(100,0,3.4).validation,saprDaysVerified:false}}).length,0,
    'Unverified SAPR data must never generate coaching.');
});


test('RO writer fallback is clearly marked unconfirmed until follow-up ownership is assigned',()=>{
  const ops=read('assets/daily-ops.js');
  const start=ops.indexOf('  function roForm(task,host){');
  const end=ops.indexOf('\n  function ',start+20);
  assert.ok(start>=0&&end>start,'production Open RO editor exists');
  const element=tag=>({tag,children:[],dataset:{},append(...nodes){this.children.push(...nodes);},add(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=[...nodes];},addEventListener(){},closest(){return this._field||this;},querySelector(selector){if(selector==='textarea')return this._textarea||(this._textarea=element('textarea'));return element('span');}});
  const context=vm.createContext({
    model:{state:{records:[{id:'synthetic-case-alpha',ro:'Synthetic case alpha',customer:'Synthetic Customer',
      advisor:'Synthetic Writer',management:{}}]}},
    state:{editing:false,pending:false},
    api:{cdkIndicator:()=>null,statuses:()=>['Repair'],status:()=>'',clarification:()=>false,
      statusDetail:()=>'',statusDetails:()=>[],communication:['','Updated']},
    element,
    document:{createElement:tag=>element(tag)},
    Option:class{constructor(label,value){this.label=label;this.value=value;}},
    compactField(form,label,name,value,control){
      const field=element('div');field.className='daily-field';field.name=name;
      control.name=name;control.value=value;control._field=field;field.children.push(control);form.append(field);
      return field;
    },
    esc:value=>String(value??''),
    today:()=> '2026-10-24',
    button:()=>element('button'),
    action:()=>{},
    selectNext:async()=>{},
    engine:{roTask:()=>null},
    compactTask:value=>value,
    log:async()=>{},
    now:()=>Date.parse('2026-10-24T12:00:00Z'),
    $:()=>({hidden:true}),
    FormData:class{constructor(){return{entries:()=>[]};}},
    Object,JSON,Date
  });
  vm.runInContext(ops.slice(start,end)+"\nthis.testRoForm=roForm;",context);
  const host={insertAdjacentHTML(){},append(node){this.form=node;}};
  context.testRoForm({recordId:'synthetic-case-alpha',hard:true},host);
  const form=host.form;
  const ownerField=form.children.find(child=>child.name==='owner');
  assert.ok(ownerField,'follow-up owner field is rendered');
  const owner=ownerField.children[0];
  assert.equal(owner.value,'Synthetic Writer','RO writer may be prefilled for convenience');
  assert.match(ownerField.children[1]?.textContent||'',/not a confirmed follow-up assignment/i);
  assert.match(ownerField.children[1]?.textContent||'',/verify ownership/i);

  context.model.state.records[0].management={owner:'Synthetic Assigned Owner',ownerAssignmentSource:'manager-confirmed'};
  const assignedHost={insertAdjacentHTML(){},append(node){this.form=node;}};
  context.testRoForm({recordId:'synthetic-case-alpha',hard:true},assignedHost);
  const assigned=assignedHost.form.children.find(child=>child.name==='owner');
  assert.equal(assigned.children[0].value,'Synthetic Assigned Owner');
  assert.equal(assigned.children.length,1,'confirmed manager assignment does not show the unconfirmed fallback warning');
});

test('Home secondary priorities show ownership, due date, blocker, next step, and source confidence without inference',()=>{
  const ops=read('assets/daily-ops.js');
  const start=ops.indexOf('  function attentionSecondaryDetail(');
  const renderStart=ops.indexOf('  function renderOtherPriorities(',start);
  const renderEnd=ops.indexOf('  function renderHome(',renderStart);
  assert.ok(start>=0&&renderStart>start&&renderEnd>renderStart,'production Home priority summary exists');
  const source=ops.slice(start,renderEnd);
  const node=()=>({children:[],textContent:'',className:'',dataset:{},append(...items){this.children.push(...items);},setAttribute(){}});
  const app=read('assets/app.js');
  const defaultStart=app.indexOf('  function defaultManagementFor(');
  const defaultEnd=app.indexOf('  function pruneClosedRecords(',defaultStart);
  assert.ok(defaultStart>=0&&defaultEnd>defaultStart,'production Open RO source-owner default exists');
  const appContext=vm.createContext({});
  vm.runInContext(app.slice(defaultStart,defaultEnd),appContext);
  const importedManagement=appContext.defaultManagementFor({advisor:'Synthetic Writer'});
  assert.equal(importedManagement.owner,'Synthetic Writer');
  assert.equal(importedManagement.ownerAssignmentSource,'source-writer');

  const record={
    id:'synthetic-ro-context',ro:'SYN-CONTEXT-1',
    management:{owner:'Synthetic Follow-up Owner',ownerAssignmentSource:'manager-confirmed',reviewDate:'2026-10-27',status:'Waiting Parts',
      statusDetail:'Other',statusDetailOther:'Synthetic part ETA',nextAction:'Recheck synthetic part ETA'},
    cdkOperational:{status:'Awaiting Technician Attention',stale:false}
  };
  const model={state:{records:[record],source:{fileName:'synthetic-open-ro.xlsx',reportDate:'2026-10-26'}}};
  const context=vm.createContext({
    model,state:{events:[]},
    api:{
      status:value=>value.management.status,
      statusDetailLabel:value=>value.management.statusDetail==='Other'?value.management.statusDetailOther:value.management.statusDetail,
      cdkIndicator:value=>value.cdkOperational.stale?{text:'Not confirmed by latest import'}:null,
      recordRefresh:async()=>{}
    },
    attentionTopThree:()=>[{id:'primary'}, {id:'secondary',type:'ro',recordId:record.id,record}],
    document:{createElement:node},
    button:(label)=>{const value=node();value.textContent=label;return value;},
    action:fn=>fn(),openAttention:()=>{},engine:{deferUntil:()=>''},log:async()=>{},selectNext:async()=>{}
  });
  vm.runInContext(source+';this.renderOtherPriorities=renderOtherPriorities;',context);
  const host=node();
  context.renderOtherPriorities({id:'primary'},host);
  const section=host.children[0],row=section.children[1],detail=row.children[0].children[1];
  assert.match(detail.textContent,/Follow-up owner: Synthetic Follow-up Owner/);
  assert.match(detail.textContent,/Follow-up date: 2026-10-27/);
  assert.match(detail.textContent,/Status \/ blocker: Waiting Parts — Synthetic part ETA/);
  assert.match(detail.textContent,/Next step: Recheck synthetic part ETA/);
  assert.match(detail.textContent,/synthetic-open-ro\.xlsx · 2026-10-26/);
  assert.match(detail.textContent,/Current source confirms Awaiting Technician Attention/);

  record.management={owner:'Synthetic Writer',ownerAssignmentSource:'source-writer',status:'',statusDetail:'',nextAction:'',reviewDate:''};
  record.advisor='Synthetic Writer';
  record.cdkOperational={status:'Being Repaired',stale:true};
  context.api.status=()=> '';
  context.api.cdkIndicator=()=>({text:'Not confirmed by latest import'});
  const staleHost=node();
  context.renderOtherPriorities({id:'primary'},staleHost);
  const staleText=staleHost.children[0].children[1].children[0].children[1].textContent;
  assert.match(staleText,/Follow-up owner: Not confirmed/);
  assert.match(staleText,/Follow-up date: Not set/);
  assert.match(staleText,/Status \/ blocker: Not confirmed/);
  assert.match(staleText,/Next step: Confirm next action/);
  assert.match(staleText,/Not confirmed by latest import/);
  assert.doesNotMatch(staleText,/Follow-up owner: Synthetic Writer/,'a source writer must not be presented as a confirmed manager assignment');
});

test('manager attention keeps parts, approval, dispatch, diagnosis, customer-update, and promise cases actionable',()=>{
  const context=vm.createContext({Date,Intl});
  vm.runInContext(read('assets/daily-engine.js'),context);
  const engine=context.MoonDogDailyEngine;
  const api={closed:()=>false,priority:()=>5,status:record=>record.management.status||''};
  const cases=[
    [{status:'Being Repaired',statusDetail:'Parts ETA pending'},'Waiting on parts','Follow up on parts'],
    [{status:'Pending Authorization'},'Awaiting approval','Follow up on approval'],
    [{status:'Awaiting Dispatch'},'Dispatch inspection','Check dispatch'],
    [{status:'Needs Diagnosis'},'Complete diagnosis','Follow up on diagnosis'],
    [{status:'Being Repaired',communication:'Needs update'},'Contact customer','Update this customer'],
    [{status:'Being Repaired'},'Call customer — promised today','Follow up on this commitment']
  ];
  for(const [management,nextAction,title] of cases){
    const task=engine.roTask({id:'synthetic-'+title,ro:'SYN-60',daysOpen:1,
      sourceStatus:'',management:{...management,nextAction}},api,'2026-10-26',Date.parse('2026-10-26T12:00:00Z'));
    assert.ok(task,'the source-specific/promise task is retained: '+title);
    assert.equal(task.title,title);
  }
});
