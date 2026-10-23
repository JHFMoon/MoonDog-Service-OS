'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.js'), 'utf8');
const start = app.indexOf('  const ADMIN_CLOSEOUT_BLOCKERS =');
const end = app.indexOf('  function cdkStatusIndicator(', start);
assert.ok(start >= 0 && end > start, 'canonical admin closeout and triage helpers exist');
const context = {
  localDateKey: () => '2026-10-17',
  isClosedManagement: (management) => String(management?.status || '').toLowerCase() === 'closed'
};
const helpers = vm.runInNewContext(
  app.slice(start, end) + '\n({adminCloseoutDaysLate,adminCloseoutState,nextAdminCloseout,nextAdminCloseoutEvidence,adminCloseoutEscalations})',
  context
);
const {adminCloseoutDaysLate,adminCloseoutState,nextAdminCloseout,nextAdminCloseoutEvidence,adminCloseoutEscalations} = helpers;

function record(ro, taskDate, expectedCloseDate, status = 'Ready for Review') {
  return {
    id: 'test-' + ro, ro, advisor: 'Synthetic Advisor',
    management: {
      status, owner: 'Assigned Advisor', nextAction: 'Finish paperwork',
      reviewDate: '2026-10-22',
      adminCloseout: nextAdminCloseoutEvidence(nextAdminCloseout(
        null, 'Warranty approval or processing', taskDate, expectedCloseDate,
        '', '2026-10-10T12:00:00Z'
      ), {physicalWorkStatus: 'verified'}, '2026-10-10T12:00:00Z')
    }
  };
}

test('calendar lateness compares dates, not timezone/DST offsets', () => {
  assert.equal(adminCloseoutDaysLate('2026-10-13', '2026-10-17'), 4);
  assert.equal(adminCloseoutDaysLate('2026-10-17', '2026-10-17'), 0);
  assert.equal(adminCloseoutDaysLate('2026-10-22', '2026-10-17'), 0);
  assert.equal(adminCloseoutDaysLate('', '2026-10-17'), 0);
  assert.equal(adminCloseoutDaysLate('2026-03-07', '2026-03-10'), 3);
});

test('task missed and separate close-date missed days are individually reported', () => {
  const task = adminCloseoutState(record('100', '2026-10-12', '2026-10-19'), '2026-10-17');
  assert.equal(task.taskDaysLate, 5);
  assert.equal(task.closeDaysLate, 0);
  assert.equal(task.overdue, true);
  const close = adminCloseoutState(record('101', '2026-10-19', '2026-10-15'), '2026-10-17');
  assert.equal(close.taskDaysLate, 0);
  assert.equal(close.closeDaysLate, 2);
  assert.equal(close.overdue, true);
});

test('Home candidates show only real missing, due or missed admin promises, max three visible', () => {
  const overdue = record('100', '2026-10-12', '2026-10-22');
  const missing = record('101', '', '2026-10-23');
  const today = record('102', '2026-10-17', '2026-10-18');
  const future = record('103', '2026-10-22', '2026-10-23');
  const closed = record('104', '2026-10-12', '2026-10-13', 'Closed');
  const laterOverdue = record('105', '2026-10-16', '2026-10-23');
  const candidates = adminCloseoutEscalations(
    [future, today, closed, missing, laterOverdue, overdue],
    '2026-10-17'
  );
  assert.equal(candidates.length, 4, 'full triage retains actionable count');
  assert.equal(candidates[0].record.ro, '100', 'longest missed promise first');
  assert.equal(candidates[1].record.ro, '105', 'other overdue before missing');
  assert.equal(candidates[2].record.ro, '101', 'missing commitment before due today');
  assert.equal(candidates[3].record.ro, '102');
  assert.ok(!candidates.some(item => ['103', '104'].includes(item.record.ro)));
  assert.equal(candidates.slice(0, 3).length, 3);
});

test('prior missed revisions are counted only from documented promises', () => {
  const original = nextAdminCloseoutEvidence(nextAdminCloseout(
    null, 'Customer pickup', '2026-10-11', '2026-10-12', '', '2026-10-10T10:00:00Z'
  ), {physicalWorkStatus: 'verified'}, '2026-10-10T10:00:00Z');
  const firstMiss = nextAdminCloseout(
    original, 'Customer pickup', '2026-10-13', '2026-10-14',
    'Customer moved pickup', '2026-10-13T10:00:00Z'
  );
  const secondMiss = nextAdminCloseout(
    firstMiss, 'Customer pickup', '2026-10-16', '2026-10-18',
    'Advisor missed outreach', '2026-10-15T10:00:00Z'
  );
  const state = adminCloseoutState({
    management: {status: 'Ready for Review', adminCloseout: secondMiss}
  }, '2026-10-17');
  assert.equal(state.revisionCount, 2);
  assert.equal(state.missedRevisions, 2);
  assert.equal(state.taskDaysLate, 1);
  assert.equal(state.closeDaysLate, 0);
  assert.equal(secondMiss.revisions[0].previous.taskDate, '2026-10-11');
  assert.equal(secondMiss.revisions[1].previous.taskDate, '2026-10-13');
});

test('Home admin action is manager-only, uses verified state and never changes meeting or auto-closes ROs', () => {
  const home = app.slice(app.indexOf('  function renderAdminCloseoutAttention('), app.indexOf('  function renderOverviewIntelligence('));
  assert.ok(home.includes('adminCloseoutEscalations(model.state.records, today)'));
  assert.ok(home.includes('escalations.slice(0, 3)'));
  assert.ok(home.includes('navigateTo("open-ro")'));
  assert.ok(home.includes('openEdit(record.id)'));
  assert.ok(home.includes('record.management?.owner || record.advisor'));
  assert.ok(app.includes('renderAdminCloseoutAttention();'));
  assert.ok(app.includes('id = "adminCloseoutAttention"'));
  assert.ok(!home.includes('renderMeeting('));
  assert.ok(!home.includes('closeRo('));
});
