const test = require('node:test');
const assert = require('node:assert/strict');
require('../assets/freshness.js');
const refresh = globalThis.ServiceRefreshIntelligence;

test('prior-year SAPR with zero declared operating days cannot become a comparable baseline', () => {
  const current = {periodEnd:'2026-10-09',saprDaysCompleted:0,saprTotalDays:8};
  const history = [{periodEnd:'2025-10-09',saprDaysCompleted:0,saprTotalDays:0}];
  const comparison = refresh.matchPriorYear(current,history);
  assert.equal(comparison.status,'needs-history');
  assert.equal(comparison.prior,undefined);
});

test('valid prior-year working-day totals remain eligible for comparison', () => {
  const current = {periodEnd:'2026-10-09',saprDaysCompleted:5,saprTotalDays:8};
  const history = [{periodEnd:'2025-10-08',saprDaysCompleted:5,saprTotalDays:8}];
  const comparison = refresh.matchPriorYear(current,history);
  assert.equal(comparison.status,'comparable');
  assert.deepEqual(comparison.prior,history[0]);
});

test('current SAPR with zero operating days remains unavailable', () => {
  const current = {periodEnd:'2026-10-09',saprDaysCompleted:0,saprTotalDays:0};
  assert.equal(refresh.matchPriorYear(current,[]).status,'unavailable');
});
