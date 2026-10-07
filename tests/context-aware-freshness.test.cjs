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
  const source = F.evaluateSource({key:'csi',exists:true,today,sourceDate:'2026-10-06',periodStart:'2026-10-01',periodEnd:'2026-10-06',responseCount:0});
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
