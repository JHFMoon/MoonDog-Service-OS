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
