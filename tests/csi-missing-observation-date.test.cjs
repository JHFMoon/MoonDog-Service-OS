const test = require('node:test');
const assert = require('node:assert/strict');
const freshness = require('../assets/freshness.js');

test('missing CSI import timestamps never become today or fabricate a report observation', () => {
  const evidence = freshness.csiTrendEvidence({
    imports: [{}, {importedAt: null}, {refreshDate: ''}],
    today: '2026-10-30',
    surveys: {}
  });
  assert.deepEqual(evidence.reportDates, []);
  assert.equal(evidence.lastReportObservation, '');
  assert.equal(evidence.verifiedScope, null);
});

test('CSI retains only actual dated report evidence, independent of response dates', () => {
  const evidence = freshness.csiTrendEvidence({
    imports: [
      {},
      {importedAt: '2026-10-27T16:00:00Z'},
      {refreshDate: '2026-10-28'},
      {refreshDate: '2026-02-30'},
      {refreshDate: '2026-11-01'}
    ],
    today: '2026-10-30',
    surveys: {example: {surveyDate: '2026-10-29', advisorCode: 'A'}}
  });
  assert.deepEqual(evidence.reportDates, ['2026-10-27','2026-10-28']);
  assert.equal(evidence.lastReportObservation, '2026-10-28');
  assert.deepEqual(evidence.responseDates, ['2026-10-29']);
});
