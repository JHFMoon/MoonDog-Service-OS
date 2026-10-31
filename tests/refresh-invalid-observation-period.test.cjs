const test = require('node:test');
const assert = require('node:assert/strict');
require('../assets/freshness.js');
const refresh = globalThis.ServiceRefreshIntelligence;

test('invalid supplied report period cannot fabricate a refresh observation or clear snooze', () => {
  const before = refresh.learn(refresh.empty(), 'performance', 'not-now', {
    at: '2026-10-30T15:00:00Z'
  });
  const after = refresh.learn(before, 'performance', 'imported', {
    at: '2026-10-30T16:00:00Z', periodEnd: '2026-02-30', hour: 9
  });
  assert.deepEqual(after, before);
  assert.deepEqual(refresh.sourceRecord(after, 'performance').observations, []);
  assert.equal(after.sources.performance.notNowUntil, before.sources.performance.notNowUntil);
});

test('invalid explicit observed date does not silently fall back to import date', () => {
  const before = refresh.empty();
  const after = refresh.learn(before, 'csi', 'imported', {
    at: '2026-10-30T15:00:00Z', observedDate: '2026-13-01'
  });
  assert.deepEqual(after, before);
});

test('validated report period still records one observation and resets a snooze', () => {
  const before = refresh.learn(refresh.empty(), 'performance', 'not-now', {
    at: '2026-10-30T15:00:00Z'
  });
  const after = refresh.learn(before, 'performance', 'imported', {
    at: '2026-10-30T16:00:00Z', periodEnd: '2026-10-29', hour: 9
  });
  assert.equal(after.sources.performance.observations.length, 1);
  assert.equal(after.sources.performance.observations[0].day, '2026-10-29');
  assert.equal(after.sources.performance.notNowUntil, '');
});

test('date-less verified import retains the existing import-day learning behavior', () => {
  const after = refresh.learn(refresh.empty(), 'open-ro', 'imported', {
    at: '2026-10-30T16:00:00Z', hour: 9
  });
  assert.equal(after.sources['open-ro'].observations[0].day, '2026-10-30');
});
