'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.js'), 'utf8');

// Evaluate the ACTUAL production helpers against synthetic state. Do not
// duplicate or rewrite merge behavior in the test.
function loadMerge(state) {
  const start = app.indexOf('  function defaultManagementFor(');
  const end = app.indexOf('  async function importCdkRepairOrdersDocx(', start);
  assert.ok(start >= 0 && end > start, 'canonical complete-source merge helpers must exist');
  const context = {
    model: { state },
    CLOSED_RO_RETENTION_DAYS: 730,
    canonicalCdkStatus: () => ''
  };
  const helpers = vm.runInNewContext(
    app.slice(start, end) + '\n({mergeCompleteOpenRoRecords, defaultManagementFor})',
    context
  );
  assert.equal(typeof helpers.mergeCompleteOpenRoRecords, 'function');
  return helpers;
}

function loadAdmin() {
  const start = app.indexOf('  const ADMIN_CLOSEOUT_BLOCKERS =');
  const end = app.indexOf('  function cdkStatusIndicator(', start);
  assert.ok(start >= 0 && end > start, 'canonical closeout rules must exist');
  const context = {
    localDateKey: () => '2026-10-17',
    isClosedManagement: (management) =>
      String(management?.status || '').toLowerCase() === 'closed'
  };
  return vm.runInNewContext(
    app.slice(start, end) + '\n({nextAdminCloseout, adminCloseoutState})',
    context
  );
}

function existing(overrides = {}) {
  return {
    id: 'synthetic-1', ro: 'TEST-1', advisor: 'Synthetic Advisor',
    management: {
      status: 'Ready for Review',
      owner: 'Follow-up Owner',
      nextAction: 'Confirm warranty paperwork',
      reviewDate: '2026-10-19',
      adminCloseout: {
        blocker: 'Warranty approval or processing',
        taskDate: '2026-10-18',
        expectedCloseDate: '2026-10-20',
        updatedAt: '2026-10-15T12:00:00Z',
        revisions: [{
          at: '2026-10-15T12:00:00Z',
          reason: 'Advisor revised filing expectation',
          previous: {taskDate:'2026-10-17',expectedCloseDate:'2026-10-19'},
          next: {taskDate:'2026-10-18',expectedCloseDate:'2026-10-20'}
        }]
      }
    },
    ...overrides
  };
}

test('complete-source reimports preserve actual manager commitment, owner, date and revision history', () => {
  const prior = existing();
  const state = { records: [prior], closedRecords: [] };
  const { mergeCompleteOpenRoRecords } = loadMerge(state);
  // Even malformed incoming management must not be authoritative for RO reviews.
  const incoming = [{
    id: prior.id, ro: prior.ro, advisor: prior.advisor,
    sourceStatus: 'Repair', daysOpen: 5,
    management: { owner: 'DO NOT OVERWRITE', adminCloseout: {taskDate: '2030-01-01'} }
  }];
  const merged = mergeCompleteOpenRoRecords(incoming, '2026-10-17T12:00:00Z', 'open-ro-xlsx');
  assert.equal(merged.records.length, 1);
  const record = merged.records[0];
  assert.strictEqual(record.management, prior.management);
  assert.strictEqual(record.management.adminCloseout, prior.management.adminCloseout);
  assert.equal(record.management.owner, 'Follow-up Owner');
  assert.equal(record.management.reviewDate, '2026-10-19');
  assert.equal(record.management.adminCloseout.revisions.length, 1);
  assert.equal(record.management.adminCloseout.revisions[0].reason, 'Advisor revised filing expectation');
  assert.equal(record.daysOpen, 5, 'verified source fields still refresh');
  assert.equal(state.records[0], prior, 'pure merge must not modify existing persisted state');

  // Second complete-source import must retain the same manager-entered object.
  state.records = merged.records;
  const repeated = mergeCompleteOpenRoRecords([{
    id: prior.id, ro: prior.ro, advisor: prior.advisor, daysOpen: 6
  }], '2026-10-18T12:00:00Z', 'open-ro-xlsx');
  assert.strictEqual(repeated.records[0].management.adminCloseout, prior.management.adminCloseout);
  assert.equal(repeated.records[0].daysOpen, 6);
});

test('complete-source omission retains a closed RO; reopening restores its admin commitment', () => {
  const prior = existing();
  const state = { records: [prior], closedRecords: [] };
  const { mergeCompleteOpenRoRecords } = loadMerge(state);
  const closed = mergeCompleteOpenRoRecords([], '2026-10-17T12:00:00Z', 'open-ro-xlsx');
  assert.equal(closed.closedCount, 1);
  assert.equal(closed.closedRecords.length, 1);
  assert.strictEqual(closed.closedRecords[0].management.adminCloseout, prior.management.adminCloseout);
  assert.equal(closed.closedRecords[0].closedReason, 'missing-from-complete-open-ro-source');

  state.records = [];
  state.closedRecords = closed.closedRecords;
  const reopened = mergeCompleteOpenRoRecords(
    [{id: prior.id, ro: prior.ro, advisor: prior.advisor, sourceStatus: 'Repair'}],
    '2026-10-18T12:00:00Z', 'open-ro-xlsx'
  );
  assert.equal(reopened.reopenedCount, 1);
  assert.equal(reopened.closedRecords.length, 0);
  assert.strictEqual(reopened.records[0].management.adminCloseout, prior.management.adminCloseout);
  assert.equal(reopened.records[0].closedAt, undefined);
});

test('new ROs get defaults, not a fabricated administrative promise', () => {
  const { mergeCompleteOpenRoRecords } = loadMerge({ records: [], closedRecords: [] });
  const merged = mergeCompleteOpenRoRecords(
    [{id: 'synthetic-new', ro: 'TEST-2', advisor: 'Synthetic New'}],
    '2026-10-17T12:00:00Z', 'open-ro-xlsx'
  );
  assert.equal(merged.records[0].management.owner, 'Synthetic New');
  assert.equal(merged.records[0].management.reviewDate, '');
  assert.equal(merged.records[0].management.adminCloseout, undefined);
});

test('real closeout logic does not fabricate advisor promises from manager reminder dates', () => {
  const { nextAdminCloseout, adminCloseoutState } = loadAdmin();
  const closeout = nextAdminCloseout(
    null, 'Warranty approval or processing', '', '2026-10-20', '',
    '2026-10-17T12:00:00Z'
  );
  const record = { management: { status: 'Ready for Review',
    reviewDate: '2026-10-16', adminCloseout: closeout } };
  const current = adminCloseoutState(record, '2026-10-17');
  assert.equal(current.active, true);
  assert.equal(current.taskDate, '');
  assert.equal(current.needsCommitment, true);
  assert.equal(current.taskOverdue, false);
  assert.equal(current.closeDate, '2026-10-20');

  record.management.status = 'Closed';
  assert.equal(adminCloseoutState(record, '2026-10-17').active, false);
  record.management.status = 'Ready for Review';
  assert.equal(adminCloseoutState(record, '2026-10-17').active, true);
});

test('real closeout revisions preserve prior promise and require a reason', () => {
  const { nextAdminCloseout, adminCloseoutState } = loadAdmin();
  const first = nextAdminCloseout(
    null, 'Customer pickup', '2026-10-16', '2026-10-18', '',
    '2026-10-15T12:00:00Z'
  );
  assert.equal(adminCloseoutState({management:{adminCloseout:first}},'2026-10-17').taskOverdue, true);
  assert.throws(() => nextAdminCloseout(
    first, 'Customer pickup', '2026-10-19', '2026-10-21', '',
    '2026-10-17T12:00:00Z'
  ), /Explain why/);
  const revised = nextAdminCloseout(
    first, 'Customer pickup', '2026-10-19', '2026-10-21',
    'Customer rescheduled pickup', '2026-10-17T12:00:00Z'
  );
  assert.equal(revised.revisions.length, 1);
  assert.equal(revised.revisions[0].previous.taskDate, '2026-10-16');
  assert.equal(revised.revisions[0].reason, 'Customer rescheduled pickup');
  assert.strictEqual(nextAdminCloseout(
    revised, revised.blocker, revised.taskDate, revised.expectedCloseDate,
    '', '2026-10-17T13:00:00Z'
  ), revised, 'unchanged promise must not acquire duplicate history');
});

// Source-contract safeguard only: a full returned XLSX round trip needs the
// separate existing workbook integration harness. Do not claim this is one.
test('returned Supervisor Workbook keeps admin promises outside its proposed edits', () => {
  const start = app.indexOf('async function importReturnedWorkbookUnlocked(');
  const end = app.indexOf('  async function importSource(', start);
  assert.ok(start >= 0 && end > start);
  const importer = app.slice(start, end);
  assert.match(importer, /managementUpdates\.set\(record\.id,\{ \.\.\.record\.management, \.\.\.proposed/);
  assert.match(importer, /current\.adminCloseout\?\.blocker/);
  const proposedStart = importer.indexOf('proposed = {');
  const proposedEnd = importer.indexOf('}, baseline', proposedStart);
  assert.ok(proposedStart >= 0 && proposedEnd > proposedStart);
  assert.ok(!importer.slice(proposedStart, proposedEnd).includes('adminCloseout'));
});
