'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.js'), 'utf8');
const start = app.indexOf('  const ADMIN_CLOSEOUT_BLOCKERS =');
const end = app.indexOf('  function cdkStatusIndicator(', start);
assert.ok(start >= 0 && end > start, 'canonical administrative closeout logic exists');

const context = {
  localDateKey: () => '2026-10-17',
  isClosedManagement: (management) => String(management?.status || '').toLowerCase() === 'closed'
};
const { adminCloseoutState, nextAdminCloseout, nextAdminCloseoutEvidence } = vm.runInNewContext(
  app.slice(start, end) + '\n({adminCloseoutState,nextAdminCloseout,nextAdminCloseoutEvidence})',
  context
);
const at = '2026-10-17T12:00:00Z';

function commitments(blocker = 'Customer pickup') {
  return nextAdminCloseout(null, blocker, '2026-10-17', '2026-10-20', '', at);
}

test('unverified physical work does not surface as administrative closeout or a manager priority', () => {
  const pending = nextAdminCloseoutEvidence(commitments(), {
    physicalWorkStatus: 'unverified',
    pickupStatus: 'pickup-expected',
    expectedPickupDate: '2026-10-16'
  }, at);
  const state = adminCloseoutState({management: {status: 'Ready for Review', adminCloseout: pending}}, '2026-10-17');
  assert.equal(state.active, false);
  assert.equal(state.verified, false);
  assert.equal(state.overdue, false);
});

test('manager-confirmed pickup outreach and expected pickup are distinct from RO close commitments', () => {
  let closeout = nextAdminCloseoutEvidence(commitments(), {
    physicalWorkStatus: 'verified',
    pickupStatus: 'contact-attempted',
    pickupContactDate: '2026-10-16',
    expectedPickupDate: '2026-10-19',
    evidence: 'Manager confirmed repair complete; advisor attempted pickup outreach.'
  }, at);
  let state = adminCloseoutState({management: {status: 'Ready for Review', adminCloseout: closeout}}, '2026-10-17');
  assert.equal(state.active, true);
  assert.equal(state.pickupStatus, 'contact-attempted');
  assert.equal(state.pickupContactDate, '2026-10-16');
  assert.equal(state.expectedPickupDate, '2026-10-19');
  assert.equal(state.closeDate, '2026-10-20');
  assert.equal(state.evidenceHistoryCount, 1);

  const notified = nextAdminCloseoutEvidence(closeout, {
    physicalWorkStatus: 'verified',
    pickupStatus: 'notified',
    pickupContactDate: '2026-10-17',
    expectedPickupDate: '2026-10-19',
    evidence: 'Advisor confirmed notification; pickup remains expected.'
  }, '2026-10-17T15:00:00Z');
  assert.equal(notified.evidenceHistory.length, 2);
  assert.equal(notified.evidenceHistory[1].previous.pickupStatus, 'contact-attempted');
  assert.equal(notified.evidenceHistory[1].next.pickupStatus, 'notified');
  assert.equal(notified.evidenceHistory[1].at, '2026-10-17T15:00:00Z');
  assert.strictEqual(nextAdminCloseoutEvidence(notified, {
    physicalWorkStatus: 'verified',
    pickupStatus: 'notified',
    pickupContactDate: '2026-10-17',
    expectedPickupDate: '2026-10-19',
    evidence: 'Advisor confirmed notification; pickup remains expected.'
  }, '2026-10-18T12:00:00Z'), notified, 'unchanged follow-through does not duplicate history');
});

test('warranty claim stages distinguish not filed, submitted, processing and approval received', () => {
  let closeout = nextAdminCloseoutEvidence(commitments('MaxCare / extended-warranty claim'), {
    physicalWorkStatus: 'verified',
    warrantyStatus: 'not-filed',
    evidence: 'Advisor confirmed claim submission remains outstanding.'
  }, at);
  assert.equal(adminCloseoutState({management: {adminCloseout: closeout}}, '2026-10-17').warrantyStatus, 'not-filed');
  for (const [status, time] of [['submitted', '2026-10-18T12:00:00Z'], ['processing', '2026-10-19T12:00:00Z'], ['approval-received', '2026-10-20T12:00:00Z']]) {
    closeout = nextAdminCloseoutEvidence(closeout, {
      physicalWorkStatus: 'verified',
      warrantyStatus: status,
      evidence: `Manager confirmed warranty status: ${status}.`
    }, time);
  }
  assert.equal(closeout.warrantyStatus, 'approval-received');
  assert.deepEqual(Array.from(closeout.evidenceHistory, (entry) => entry.next.warrantyStatus), ['not-filed', 'submitted', 'processing', 'approval-received']);
});

test('changing commitment dates preserves workflow evidence and its history', () => {
  const evidenced = nextAdminCloseoutEvidence(commitments(), {
    physicalWorkStatus: 'verified',
    pickupStatus: 'pickup-expected',
    pickupContactDate: '2026-10-16',
    expectedPickupDate: '2026-10-19',
    evidence: 'Pickup date confirmed by advisor.'
  }, at);
  const revised = nextAdminCloseout(evidenced, evidenced.blocker, '2026-10-18', '2026-10-21', 'Advisor requested one more outreach day', '2026-10-17T16:00:00Z');
  assert.equal(revised.physicalWorkStatus, 'verified');
  assert.equal(revised.expectedPickupDate, '2026-10-19');
  assert.equal(revised.evidenceHistory.length, 1);
  assert.equal(revised.revisions[0].reason, 'Advisor requested one more outreach day');
});

test('repeat missed commitments support bounded manager coaching follow-through in the same durable record', () => {
  let closeout = nextAdminCloseoutEvidence(
    nextAdminCloseout(null, 'Customer pickup', '2026-10-11', '2026-10-12', '', '2026-10-10T12:00:00Z'),
    {physicalWorkStatus: 'verified'},
    '2026-10-10T12:00:00Z'
  );
  closeout = nextAdminCloseout(closeout, closeout.blocker, '2026-10-13', '2026-10-14', 'First promised outreach was missed', '2026-10-12T12:00:00Z');
  closeout = nextAdminCloseout(closeout, closeout.blocker, '2026-10-16', '2026-10-17', 'Second promised outreach was missed', '2026-10-15T12:00:00Z');
  closeout = nextAdminCloseoutEvidence(closeout, {
    physicalWorkStatus: 'verified',
    coachingStatus: 'discussed',
    coachingAction: 'Review outreach planning and monitor the next commitment.'
  }, '2026-10-17T13:00:00Z');
  const state = adminCloseoutState({management: {adminCloseout: closeout}}, '2026-10-17');
  assert.equal(state.missedRevisions, 2);
  assert.equal(state.coachingStatus, 'discussed');
  assert.equal(state.coachingAction, 'Review outreach planning and monitor the next commitment.');
  assert.equal(closeout.evidenceHistory.length, 2);
  assert.equal(closeout.revisions.length, 2);
});

test('evidence rejects invalid workflow values, impossible dates and oversized notes', () => {
  const prior = commitments();
  assert.throws(() => nextAdminCloseoutEvidence(prior, {physicalWorkStatus: 'maybe'}, at), /physical work completion/);
  assert.throws(() => nextAdminCloseoutEvidence(prior, {pickupStatus: 'customer-contacted'}, at), /pickup follow-through/);
  assert.throws(() => nextAdminCloseoutEvidence(prior, {warrantyStatus: 'approved'}, at), /warranty or MaxCare/);
  assert.throws(() => nextAdminCloseoutEvidence(prior, {coachingStatus: 'discipline'}, at), /manager coaching/);
  assert.throws(() => nextAdminCloseoutEvidence(prior, {expectedPickupDate: '2026-02-31'}, at), /valid expected pickup date/);
  assert.throws(() => nextAdminCloseoutEvidence(prior, {evidence: 'x'.repeat(501)}, at), /500 characters/);
});

test('manager editor wires the evidence fields into durable save without customer messaging or auto-close', () => {
  for (const id of [
    'editAdminWorkStatus', 'editAdminPickupStatus', 'editAdminPickupContactDate',
    'editAdminPickupDate', 'editAdminWarrantyStatus', 'editAdminEvidence',
    'editAdminCoachingStatus', 'editAdminCoachingAction'
  ]) assert.ok(app.includes(`id="${id}"`));
  assert.match(app, /nextAdminCloseoutEvidence\(commitments,currentAdminCloseoutEvidence\(\),now\(\)\)/);
  assert.match(app, /loadAdminCloseoutEvidence\(record\)/);
  assert.match(app, /await saveState\("Updated RO "\+record\.ro, priorState\)/);
  assert.doesNotMatch(app, /sendCustomerMessage|closeRo\(record\.id\)/);
});

test('legacy blocker and dated promise are not evidence that physical repair is complete', () => {
  const legacy = {blocker: 'Customer pickup', taskDate: '2026-10-11', expectedCloseDate: '2026-10-12', revisions: []};
  const record = {management: {status: 'Ready for Review', adminCloseout: legacy}};
  const state = adminCloseoutState(record, '2026-10-17');
  assert.equal(state.active, false);
  assert.equal(state.verified, false);
  assert.equal(state.overdue, false);
  const confirmed = nextAdminCloseoutEvidence(legacy, {physicalWorkStatus: 'verified'}, at);
  assert.equal(adminCloseoutState({management:{adminCloseout:confirmed}}, '2026-10-17').active, true);
  assert.equal(confirmed.evidenceHistory[0].previous.physicalWorkStatus, 'unverified');
  assert.equal(confirmed.evidenceHistory[0].next.physicalWorkStatus, 'verified');
});
