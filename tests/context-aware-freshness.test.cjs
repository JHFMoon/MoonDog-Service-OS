const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../assets/freshness.js');
const today = '2026-10-07';
test('SAPR covering October 1–6 is current on October 7', () => {
  assert.equal(F.evaluateSource({key:'sapr',exists:true,today,periodStart:'2026-10-01',periodEnd:'2026-10-06'}).status,'current');
});
test('SAPR ending October 5 is stale on October 7', () => {
  assert.equal(F.evaluateSource({key:'sapr',exists:true,today,periodEnd:'2026-10-05'}).status,'stale');
});
test('verified CSI report observed yesterday with no responses remains current', () => {
  const source = F.evaluateSource({key:'csi',exists:true,today,sourceDate:'2026-10-06',observationVerified:true,periodStart:'2026-10-01',periodEnd:'2026-10-06',responseCount:0});
  assert.equal(source.status,'current');
  assert.equal(F.evaluateReportNeed({key:'csi',today,evidence:source,missingDates:['2026-10-05','2026-10-06']}).state,'CURRENT');
});
test('CSI response event date alone does not establish currentness', () => {
  assert.equal(F.evaluateSource({key:'csi',exists:true,today,sourceDate:'2026-10-03',responseDate:'2026-10-06',periodEnd:'2026-10-06'}).status,'stale');
});
test('verified CSI cumulative scope may prove freshness without new responses', () => {
  assert.equal(F.evaluateSource({key:'csi',exists:true,today,scopeVerified:true,scopeEnd:'2026-10-06',responseCount:0}).status,'current');
});
test('CSI source missing is not current', () => {
  assert.equal(F.evaluateSource({key:'csi',exists:false,today}).status,'missing');
});

test('verified old CSI scope stays stale even when imported today', () => {
  const source = F.evaluateSource({key:'csi',exists:true,today,scopeVerified:true,scopeEnd:'2026-10-03',sourceTimestamp:'2026-10-07T15:00:00Z'});
  assert.equal(source.status,'stale');
});
test('local import timestamp alone cannot establish CSI currentness', () => {
  const source = F.evaluateSource({key:'csi',exists:true,today,sourceTimestamp:'2026-10-07T15:00:00Z'});
  assert.equal(source.status,'stale');
});
test('validated report observation can establish CSI currentness without scope', () => {
  const source = F.evaluateSource({key:'csi',exists:true,today,observationVerified:true,sourceDate:'2026-10-06'});
  assert.equal(source.status,'current');
});

test('Gregorian date keys reject impossible dates without silently rolling into a new month', () => {
  for (const date of ['2026-02-30','2026-04-31','2025-02-29','2026-00-15','2026-13-01','2026-01-00','2026-01-32','2026-1-01']) {
    assert.equal(F.validDateKey(date), false, date);
  }
  for (const date of ['2024-02-29','2000-02-29','2026-02-28','2026-04-30','2026-12-31']) {
    assert.equal(F.validDateKey(date), true, date);
  }
  assert.equal(F.validDateKey('1900-02-29'), false);
  assert.equal(F.addDays('2026-02-30', 1), '');
  assert.equal(F.previousOperatingDay('2026-04-31'), '');
  assert.deepEqual(F.operatingDays('2026-02-30', '2026-03-02'), []);
  assert.equal(F.addDays('2024-02-28', 1), '2024-02-29');
});

test('prior-operating-day freshness requires the report period to include that day', () => {
  const today = '2026-10-20'; // Tuesday; the preceding completed operating day is Monday.
  for (const key of ['sapr', 'nextAppointments']) {
    const complete = F.evaluateSource({key, exists:true, today,
      periodStart:'2026-10-01', periodEnd:'2026-10-20'});
    assert.equal(complete.status, 'current', key + ' valid cumulative period');

    const lateStart = F.evaluateSource({key, exists:true, today,
      periodStart:'2026-10-20', periodEnd:'2026-10-20'});
    assert.equal(lateStart.status, 'stale', key + ' cannot represent Monday from a Tuesday-only report');
    assert.match(lateStart.reason, /does not establish coverage/);
    assert.equal(lateStart.safeForCurrent, false);

    const invalidStart = F.evaluateSource({key, exists:true, today,
      periodStart:'2026-02-30', periodEnd:'2026-10-20'});
    assert.equal(invalidStart.status, 'stale', key + ' invalid start date');

    const unknownStart = F.evaluateSource({key, exists:true, today,
      periodEnd:'2026-10-19'});
    assert.equal(unknownStart.status, 'current',
      key + ' legacy reports without a stated start retain prior handling');
  }
});

test('Monday freshness never treats a Sunday-only period as covering Saturday', () => {
  const today = '2026-10-19'; // Monday; Sunday is not an operating day.
  const sundayOnly = F.evaluateSource({key:'sapr', exists:true, today,
    periodStart:'2026-10-18', periodEnd:'2026-10-19'});
  assert.equal(sundayOnly.expectedPeriod, '2026-10-17');
  assert.equal(sundayOnly.status, 'stale');
  const includesSaturday = F.evaluateSource({key:'sapr', exists:true, today,
    periodStart:'2026-10-17', periodEnd:'2026-10-19'});
  assert.equal(includesSaturday.status, 'current');
});

test('VIR point-in-time provenance stays current without falsely inventing interval coverage', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname,'..','assets','app.js'), 'utf8');
  const start = app.indexOf('if (key === "vir") { const item = options.item || latestVirObservation();');
  const end = app.indexOf('if (key === "menu")', start);
  assert.ok(start > 0 && end > start, 'production VIR evidence adapter exists');
  const adapter = app.slice(start,end);
  assert.match(adapter,/periodEnd: virObservationDate\(item\)/);
  assert.doesNotMatch(adapter,/periodStart:/,
    'point-in-time VIR observations cannot claim coverage of an interval');

  const today = '2026-10-20';
  for (const observation of ['2026-10-19','2026-10-20']) {
    assert.equal(F.evaluateSource({key:'vir',exists:true,today,
      periodEnd:observation}).status,'current', observation);
  }
  assert.equal(F.evaluateSource({key:'vir',exists:true,today,
    periodEnd:'2026-10-18'}).status,'stale',
    'an old VIR observation cannot be made current by a missing period start');
});

test('invalid month keys never normalize into neighboring months or years', () => {
  for (const month of ['2026-00','2026-13','0000-12','0099-01','2026-1','2026-14']) {
    assert.equal(F.lastDayOfMonth(month), '', month + ' last day');
    assert.equal(F.previousMonth(month), '', month + ' previous month');
    assert.equal(F.finalOperatingDay(month), '', month + ' operating month end');
  }
  for (const date of ['0000-12-31','0099-01-01']) {
    assert.equal(F.validDateKey(date), false, date);
    assert.equal(F.addDays(date, 1), '', date + ' arithmetic');
  }
  assert.equal(F.lastDayOfMonth('2024-02'), '2024-02-29');
  assert.equal(F.lastDayOfMonth('2026-02'), '2026-02-28');
  assert.equal(F.previousMonth('2026-01'), '2025-12');
  assert.equal(F.previousMonth('2026-01-15'), '2025-12');
  assert.equal(F.finalOperatingDay('2026-02'), '2026-02-28');
});

test('history maintenance uses newest valid report day regardless of import enumeration order', () => {
  const presentDates=['2026-10-19','2026-10-17','2026-10-18','2026-02-30','2026-10-21'];
  for(const key of ['sapr','nextAppointments','vir','sor']){
    const plan=F.trendMaintenance({key,today:'2026-10-20',coverage:{presentDates}});
    assert.equal(plan.last,'2026-10-19',key+' must choose newest valid, nonfuture date');
    assert.equal(plan.next,'2026-10-20',key+' next operating day');
  }
  assert.deepEqual(presentDates,['2026-10-19','2026-10-17','2026-10-18','2026-02-30','2026-10-21'],
    'read-only freshness calculation must not change the canonical source order');
  assert.equal(F.trendMaintenance({key:'sapr',today:'2026-10-20',coverage:{presentDates:['invalid']}}).last,'');
  assert.equal(F.trendMaintenance({key:'sapr',today:'2026-10-20',coverage:{lastPoint:'2026-10-17',presentDates}}).last,'2026-10-17',
    'an explicitly verified lastPoint retains existing source precedence');
});

test('Menu weekly report history picks latest release without assuming import sort', () => {
  const releases=['2026-10-19','2026-10-05','2026-10-12','2026-10-26','2026-13-01'];
  const plan=F.trendMaintenance({key:'menu',today:'2026-10-20',coverage:{presentReleases:releases}});
  assert.equal(plan.last,'2026-10-19');
  assert.equal(plan.status,'Current through 2026-10-19');
  assert.equal(plan.next,'2026-10-26');
  assert.deepEqual(releases,['2026-10-19','2026-10-05','2026-10-12','2026-10-26','2026-13-01']);
  assert.equal(F.trendMaintenance({key:'menu',today:'2026-10-20',coverage:{presentReleases:['invalid']}}).last,'');
});

test('SOR financial-month confidence never prints Invalid Date from an impossible month', () => {
  const base={kind:'optional',status:'Current through 2026-10-18',last:'2026-10-18',next:'2026-10-19'};
  for(const financialMonth of ['2026-00','2026-13','0099-12','2026-1','invalid','']){
    const label=F.trendMaintenanceSummary('sor',{...base,financialMonth});
    assert.match(label,/Financial month: not established/,financialMonth||'(empty)');
    assert.doesNotMatch(label,/Invalid Date/,financialMonth||'(empty)');
  }
  const valid=F.trendMaintenanceSummary('sor',{...base,financialMonth:'2026-02'});
  assert.doesNotMatch(valid,/not established|Invalid Date/);
  assert.match(valid,/Current observation: 2026-10-18/);
});
