const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../assets/freshness.js');

const today = '2026-10-07';
const base = {key: 'csi', exists: true, today, scopeVerified: true};

test('reversed explicitly verified CSI coverage cannot be considered current', () => {
  const source = F.evaluateSource({...base,
    scopeStart: '2026-10-07', scopeEnd: '2026-10-06',
    sourceTimestamp: '2026-10-07T15:00:00Z'});
  assert.equal(source.status, 'invalid');
  assert.equal(source.safeForCurrent, false);
  assert.equal(source.safeForPurpose, false);
  assert.match(source.requiredAction, /coverage dates/i);
  assert.equal(F.evaluateMetric([source]).verified, false);
});

test('verified CSI coverage start remains validated when end comes from report period', () => {
  const source = F.evaluateSource({...base,
    scopeStart: '2026-10-07', periodEnd: '2026-10-06'});
  assert.equal(source.status, 'invalid');
  assert.equal(source.safeForPurpose, false);
});

test('calendar-invalid verified CSI scope cannot substitute its current-looking end date', () => {
  for (const scope of [
    {scopeStart: '2026-02-30', scopeEnd: '2026-10-06'},
    {scopeStart: '2026-10-01', scopeEnd: '2026-02-30'}
  ]) {
    const source = F.evaluateSource({...base, ...scope});
    assert.equal(source.status, 'invalid');
    assert.equal(source.safeForPurpose, false);
  }
});

test('a claimed verified CSI scope with no end evidence cannot use observation freshness', () => {
  const missingEnd = F.evaluateSource({...base,
    scopeStart: '2026-10-01',
    observationVerified: true, sourceDate: '2026-10-06'});
  assert.equal(missingEnd.status, 'invalid');
  assert.equal(missingEnd.safeForPurpose, false);
  assert.match(missingEnd.requiredAction, /coverage dates/i);
  assert.equal(F.evaluateMetric([missingEnd]).verified, false);
  const validPeriodEnd = F.evaluateSource({...base,
    scopeStart: '2026-10-01', periodEnd: '2026-10-06'});
  assert.equal(validPeriodEnd.status, 'current',
    'a verified periodEnd remains a valid core evaluator substitute');
});

test('ordered and end-only validated CSI coverage keep their current-source behavior', () => {
  const ordered = F.evaluateSource({...base,
    scopeStart: '2026-10-01', scopeEnd: '2026-10-06', responseCount: 0});
  const legacyEndOnly = F.evaluateSource({...base,
    scopeEnd: '2026-10-06', responseCount: 0});
  assert.equal(ordered.status, 'current');
  assert.equal(legacyEndOnly.status, 'current');
  assert.equal(ordered.safeForPurpose, true);
  assert.equal(legacyEndOnly.safeForPurpose, true);
  const old = F.evaluateSource({...base,
    scopeStart: '2026-10-01', scopeEnd: '2026-10-03'});
  assert.equal(old.status, 'stale');
});

test('CSI trend coverage and current-source confidence agree on a reversed range', () => {
  const bad = {scopeVerified: true,
    scopeStart: '2026-10-07', scopeEnd: '2026-10-06'};
  const evidence = F.csiTrendEvidence({imports: [bad], surveys: {}, today});
  assert.equal(evidence.verifiedScope, null);
  assert.equal(F.evaluateSource({...base, ...bad}).safeForPurpose, false);
});
