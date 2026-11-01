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
    assert.equal(invalidStart.status, 'invalid', key + ' malformed coverage date must be explicitly invalid');
    assert.equal(invalidStart.safeForCurrent, false);

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

test('Menu weekly freshness requires the canonical Monday release date', () => {
  const today = '2026-10-20'; // Tuesday; the represented current release is Monday.
  const current = F.evaluateSource({key:'menu',exists:true,today,releaseWeek:'2026-10-19'});
  assert.equal(current.status,'current');

  for (const releaseWeek of ['2026-10-20','2026-10-18','2026-10-26','2026-02-30']) {
    const source = F.evaluateSource({key:'menu',exists:true,today,releaseWeek});
    assert.equal(source.status,'stale',releaseWeek);
    assert.equal(source.safeForCurrent,false,releaseWeek);
    assert.equal(source.expectedPeriod,'2026-10-19',releaseWeek);
  }

  const unsupportedPeriodEnd = F.evaluateSource({key:'menu',exists:true,today,periodEnd:'2026-10-20'});
  assert.equal(unsupportedPeriodEnd.status,'stale','a Tuesday period end cannot stand in for a Monday release');
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

test('SOR financial month and local import time cannot substitute for a source observation date', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const app = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.js'), 'utf8');
  function extract(start, end, label) {
    const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
    assert.ok(a >= 0 && b > a, 'Missing production ' + label);
    return app.slice(a, b);
  }
  const dateAdapter = extract('  function dailyEvidenceDate(', '  function dailySourceCoverage(', 'SOR observation-date adapter');
  const freshnessAdapter = extract('  function sourceFreshness(', '  function metricDependencyEvidence(', 'source freshness adapter');
  const today = '2026-10-20';
  function evaluate(item) {
    const context = vm.createContext({
      model: { operationalMetrics: { sor: { snapshots: { [item.period]: item } } } },
      freshness: F,
      localDateKey: () => today,
      sourceExpectation: () => 'recommended',
      businessTimeZone: () => 'UTC',
      latestOperationalSnapshot: () => item,
      lastDayOfMonth: F.lastDayOfMonth,
      validCoverageDate: value => F.validDateKey(value) ? value : '',
      coverageTimestamp: value => {
        const date = new Date(value);
        return Number.isNaN(date.valueOf()) ? '' : date.toISOString().slice(0, 10);
      }
    });
    vm.runInContext(dateAdapter + '\n' + freshnessAdapter +
      '\nthis.api = { dailyEvidenceDate, sourceFreshness };', context);
    const observationDate = context.api.dailyEvidenceDate('sor', item);
    const evidence = context.api.sourceFreshness('sor', { today });
    const report = F.evaluateReportNeed({
      key: 'sor', today, evidence, observationDate,
      activeFeature: 'Selected Performance trend'
    });
    return { observationDate, evidence, report };
  }

  const importOnly = evaluate({ period: '2026-10', importedAt: '2026-10-20T12:00:00.000Z' });
  assert.equal(importOnly.observationDate, '', 'local import time is not source date evidence');
  assert.equal(importOnly.report.state, 'NEED NOW',
    'a financial-month label and import time cannot mark SOR current for an active trend');
  assert.equal(importOnly.evidence.status, 'historical-valid');

  const datedFile = evaluate({
    period: '2026-10', sourceModifiedAt: '2026-10-19T18:00:00.000Z',
    importedAt: '2026-10-20T12:00:00.000Z'
  });
  assert.equal(datedFile.observationDate, '2026-10-19');
  assert.equal(datedFile.report.state, 'CURRENT',
    'a valid source-file observation in the represented financial month may establish the current point');

  const futureFile = evaluate({
    period: '2026-10', sourceModifiedAt: '2026-10-21T18:00:00.000Z',
    importedAt: '2026-10-20T12:00:00.000Z'
  });
  assert.equal(futureFile.observationDate, '2026-10-21');
  assert.equal(futureFile.report.state, 'NEED NOW',
    'a future file date cannot establish current source confidence');
});

test('historical source coverage rejects malformed explicit boundaries', () => {
  const invalidSourceStart = F.evaluateSource({
    key: 'menu', exists: true, purpose: 'historical',
    targetStart: '2026-09-01', targetEnd: '2026-09-30',
    periodStart: '2026-02-30', periodEnd: '2026-09-30'
  });
  assert.equal(invalidSourceStart.status, 'invalid');
  assert.equal(invalidSourceStart.safeForPurpose, false);

  const invalidTargetStart = F.evaluateSource({
    key: 'menu', exists: true, purpose: 'historical',
    targetStart: '2026-02-30', targetEnd: '2026-09-30',
    periodStart: '2026-09-01', periodEnd: '2026-09-30'
  });
  assert.equal(invalidTargetStart.status, 'stale');
  assert.equal(invalidTargetStart.safeForPurpose, false);
});

test('legacy historical reports with no explicit start retain end-only coverage', () => {
  const evidence = F.evaluateSource({
    key: 'menu', exists: true, purpose: 'historical',
    targetStart: '2026-09-30', targetEnd: '2026-09-30',
    periodEnd: '2026-09-30'
  });
  assert.equal(evidence.status, 'historical-valid');
  assert.equal(evidence.safeForPurpose, true);
});

test('end-only source observations cannot certify earlier historical intervals across all report families', () => {
  const end='2026-09-30', keys=Object.keys(F.SOURCE_DEFINITIONS);
  assert.equal(keys.length,14,'cover every catalogued source authority');
  for(const key of keys){
    const source={key,exists:true,purpose:'historical',today:'2026-10-07',periodEnd:end};
    const unverifiedMonth=F.evaluateSource({...source,
      targetStart:'2026-09-01',targetEnd:end});
    assert.equal(unverifiedMonth.status,'stale',key+' end-only source cannot backfill a month');
    assert.equal(unverifiedMonth.safeForPurpose,false,key+' earlier coverage remains unverified');
    assert.equal(F.evaluateMetric([unverifiedMonth]).verified,false,key+' history cannot yield a verified KPI');

    const unverifiedDay=F.evaluateSource({...source,
      targetStart:'2026-09-29',targetEnd:'2026-09-29'});
    assert.equal(unverifiedDay.status,'stale',key+' prior day is not established by a later observation');

    const verifiedEnd=F.evaluateSource({...source,targetStart:end,targetEnd:end});
    assert.equal(verifiedEnd.status,'historical-valid',key+' known observation date still works');

    const explicitCoverage=F.evaluateSource({...source,periodStart:'2026-09-01',
      targetStart:'2026-09-01',targetEnd:end});
    assert.equal(explicitCoverage.status,'historical-valid',key+' documented start proves full period');
  }
});

test('Open RO without source date never inherits the current computer date', () => {
  // Derive today's actual business-date key so this regression cannot turn
  // green merely because a hard-coded 2026 day has passed.
  const now = new Date();
  const businessToday = F.dateKey(now);
  for (const sourceTimestamp of [undefined, null, '']) {
    const evidence = F.evaluateSource({
      key: 'openRo', exists: true, today: businessToday, sourceTimestamp
    });
    assert.equal(evidence.status, 'stale', 'undated Open RO must not be current');
    assert.equal(evidence.safeForCurrent, false);
    assert.match(evidence.reason, /unknown/);
  }
});

test('Open RO with verified business-date source evidence retains normal freshness', () => {
  const now = new Date();
  const businessToday = F.dateKey(now);
  assert.equal(F.evaluateSource({
    key: 'openRo', exists: true, today: businessToday, sourceDate: businessToday
  }).status, 'current');
  assert.equal(F.evaluateSource({
    key: 'openRo', exists: true, today: businessToday, sourceTimestamp: now.toISOString()
  }).status, 'current');
  assert.equal(F.evaluateSource({
    key: 'openRo', exists: true, today: businessToday,
    sourceDate: F.addDays(businessToday, -1)
  }).status, 'stale');
});

test('reversed requested historical periods never receive valid source confidence', () => {
  const source = {
    key: 'sor', exists: true, purpose: 'historical', today: '2026-10-30',
    periodStart: '2026-10-01', periodEnd: '2026-10-31'
  };
  const reversed = F.evaluateSource({
    ...source, targetStart: '2026-10-20', targetEnd: '2026-10-05'
  });
  assert.equal(reversed.status, 'stale',
    'an impossible requested interval cannot pass source coverage');
  assert.equal(reversed.safeForPurpose, false);
  assert.equal(F.evaluateMetric([reversed]).verified, false);

  const ordered = F.evaluateSource({
    ...source, targetStart: '2026-10-05', targetEnd: '2026-10-20'
  });
  assert.equal(ordered.status, 'historical-valid',
    'same source must continue to cover a properly ordered interval');
  assert.equal(ordered.safeForPurpose, true);

  const singleDay = F.evaluateSource({
    ...source, targetStart: '2026-10-20', targetEnd: '2026-10-20'
  });
  assert.equal(singleDay.status, 'historical-valid',
    'valid single-day history queries must remain supported');

  const malformed = F.evaluateSource({
    ...source, targetStart: '2026-02-30', targetEnd: '2026-10-20'
  });
  assert.equal(malformed.safeForPurpose, false);
});
