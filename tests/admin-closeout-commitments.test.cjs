const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const start = app.indexOf('  const ADMIN_CLOSEOUT_BLOCKERS =');
const end = app.indexOf('  function cdkStatusIndicator(', start);
assert.ok(start >= 0 && end > start, 'admin closeout helpers should be present');
const context = {localDateKey:()=> '2026-10-11'};
vm.runInNewContext(app.slice(start, end)+'\nthis.closeout={nextAdminCloseout,adminCloseoutState};', context);
const {nextAdminCloseout,adminCloseoutState} = context.closeout;

test('manager must explicitly identify an administrative blocker; never infer from RO age', () => {
  const record = {management:{reviewDate:'2026-10-10'}};
  assert.equal(adminCloseoutState(record,'2026-10-11').active, false);
  const initial = nextAdminCloseout(null,'Customer pickup','2026-10-12','2026-10-13','','2026-10-11T12:00:00Z');
  assert.equal(initial.blocker,'Customer pickup');
  assert.equal(initial.taskDate,'2026-10-12');
  assert.equal(initial.expectedCloseDate,'2026-10-13');
  assert.equal(initial.revisions.length,0);
  assert.equal(adminCloseoutState({management:{adminCloseout:initial}},'2026-10-11').overdue,false);
});

test('missing promises are represented as missing, not fabricated', () => {
  const pending=nextAdminCloseout(null,'Billing / paperwork','','','','2026-10-11T12:00:00Z');
  const state=adminCloseoutState({management:{adminCloseout:pending}},'2026-10-11');
  assert.equal(state.active,true);
  assert.equal(state.needsCommitment,true);
  assert.equal(state.overdue,false);
  assert.equal(pending.expectedCloseDate,'');
});

test('missed task date or close date is flagged without closing or authorizing RO', () => {
  const promised=nextAdminCloseout(null,'MaxCare / extended-warranty claim','2026-10-10','2026-10-15','','2026-10-09T12:00:00Z');
  assert.equal(adminCloseoutState({management:{adminCloseout:promised}},'2026-10-11').overdue,true);
  const closeDue=nextAdminCloseout(null,'Customer pickup','2026-10-15','2026-10-10','','2026-10-09T12:00:00Z');
  assert.equal(adminCloseoutState({management:{adminCloseout:closeDue}},'2026-10-11').overdue,true);
});

test('revising an advisor promise requires reason and preserves previous dates', () => {
  const first=nextAdminCloseout(null,'Warranty approval or processing','2026-10-12','2026-10-13','','2026-10-11T12:00:00Z');
  assert.throws(()=>nextAdminCloseout(first,'Warranty approval or processing','2026-10-14','2026-10-16','','2026-10-12T12:00:00Z'),/Explain why/);
  const next=nextAdminCloseout(first,'Warranty approval or processing','2026-10-14','2026-10-16','Advisor awaiting warranty claim number','2026-10-12T12:00:00Z');
  assert.equal(next.revisions.length,1);
  assert.equal(next.revisions[0].previous.taskDate,'2026-10-12');
  assert.equal(next.revisions[0].previous.expectedCloseDate,'2026-10-13');
  assert.equal(next.revisions[0].reason,'Advisor awaiting warranty claim number');
  const savedAgain=nextAdminCloseout(next,next.blocker,next.taskDate,next.expectedCloseDate,'','2026-10-13T12:00:00Z');
  assert.equal(savedAgain.revisions.length,1);
});

test('update form and Open RO exception filters are manager-only; existing durable state is reused',()=>{
  for(const id of ['editAdminBlocker','editAdminCloseDate','editAdminChangeReason']) assert.ok(app.includes('id="'+id+'"'));
  for(const filter of ['admin-closeout','admin-commitment-needed','admin-overdue']) assert.ok(app.includes('value="'+filter+'"'));
  assert.match(app,/adminCloseout=nextAdminCloseout\(/);
  assert.ok(app.includes('await saveState("Updated RO "+record.ro, priorState)'));
  assert.match(app,/management=prior\?\.management\|\|defaultManagementFor\(raw\)/);
  assert.doesNotMatch(html,/data-view="advisor-closeout"/);
});

test('Home save does not clear or transfer administrative fields between ROs', () => {
  assert.ok(app.includes("ui.editAdminBlocker.value=record.management.adminCloseout?.blocker||''"));
  assert.ok(app.includes("ui.editAdminCloseDate.value=record.management.adminCloseout?.expectedCloseDate||''"));
  assert.ok(app.includes("ui.editAdminChangeReason.value=''"));
});

test('Supervisor Workbook updates do not silently replace an existing admin commitment', () => {
  assert.ok(app.includes('Administrative closeout promise changed in workbook: confirm the revised date and reason'));
  assert.ok(app.includes('proposed.reviewDate !== (current.adminCloseout.taskDate || "")'));
  assert.ok(app.includes('!record.management.nextAction ? 5 : 6'));
});
