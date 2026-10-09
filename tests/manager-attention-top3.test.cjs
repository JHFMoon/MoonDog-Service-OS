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

test('No automatic installation or data upload; the schedule only requests metadata after noon', () => {
  const update = read('assets/moondog-update-settings.js');
  assert.match(update,/function checkAfterNoon\(/);
  assert.match(update,/current\.getHours\(\) < 12/);
  assert.match(update,/state\.lastAutomatic === stamp/);
  assert.match(update,/void check\(false\)/);
  assert.match(update,/data-update-install/);
  assert.match(update,/data-update-changes/);
  assert.match(update,/data-update-later/);
  assert.match(update,/installButton\.click\(\)/);
  assert.match(update,/note\.textContent = value\.releaseNotes/);
  assert.doesNotMatch(update,/fetch\([^)]*customer/i);
});
