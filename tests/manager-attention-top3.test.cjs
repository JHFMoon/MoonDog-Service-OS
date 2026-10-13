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
