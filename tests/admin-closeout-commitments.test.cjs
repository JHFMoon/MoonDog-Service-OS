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
const context = {localDateKey:()=> '2026-10-11', isClosedManagement:(management)=>String(management?.status||'').toLowerCase()==='closed'};
vm.runInNewContext(app.slice(start, end)+'\nthis.closeout={nextAdminCloseout,nextAdminCloseoutEvidence,adminCloseoutState};', context);
const {nextAdminCloseout,nextAdminCloseoutEvidence,adminCloseoutState} = context.closeout;
const confirmed = closeout => nextAdminCloseoutEvidence(closeout, {physicalWorkStatus:'verified'}, '2026-10-11T12:00:00Z');

test('manager must explicitly identify an administrative blocker; never infer from RO age', () => {
  const record = {management:{reviewDate:'2026-10-10'}};
  assert.equal(adminCloseoutState(record,'2026-10-11').active, false);
  const initial = confirmed(nextAdminCloseout(null,'Customer pickup','2026-10-12','2026-10-13','','2026-10-11T12:00:00Z'));
  assert.equal(initial.blocker,'Customer pickup');
  assert.equal(initial.taskDate,'2026-10-12');
  assert.equal(initial.expectedCloseDate,'2026-10-13');
  assert.equal(initial.revisions.length,0);
  assert.equal(adminCloseoutState({management:{adminCloseout:initial}},'2026-10-11').overdue,false);
});

test('missing promises are represented as missing, not fabricated', () => {
  const pending=confirmed(nextAdminCloseout(null,'Billing / paperwork','','','','2026-10-11T12:00:00Z'));
  const state=adminCloseoutState({management:{adminCloseout:pending}},'2026-10-11');
  assert.equal(state.active,true);
  assert.equal(state.needsCommitment,true);
  assert.equal(state.overdue,false);
  assert.equal(pending.expectedCloseDate,'');
});

test('missed task date or close date is flagged without closing or authorizing RO', () => {
  const promised=confirmed(nextAdminCloseout(null,'MaxCare / extended-warranty claim','2026-10-10','2026-10-15','','2026-10-09T12:00:00Z'));
  assert.equal(adminCloseoutState({management:{adminCloseout:promised}},'2026-10-11').overdue,true);
  const closeDue=confirmed(nextAdminCloseout(null,'Customer pickup','2026-10-15','2026-10-10','','2026-10-09T12:00:00Z'));
  assert.equal(adminCloseoutState({management:{adminCloseout:closeDue}},'2026-10-11').overdue,true);
});

test('revising an advisor promise requires reason and preserves previous dates', () => {
  const first=confirmed(nextAdminCloseout(null,'Warranty approval or processing','2026-10-12','2026-10-13','','2026-10-11T12:00:00Z'));
  assert.throws(()=>nextAdminCloseout(first,'Warranty approval or processing','2026-10-14','2026-10-16','','2026-10-12T12:00:00Z'),/Explain why/);
  const next=nextAdminCloseout(first,'Warranty approval or processing','2026-10-14','2026-10-16','Advisor awaiting warranty claim number','2026-10-12T12:00:00Z');
  assert.equal(next.revisions.length,1);
  assert.equal(next.revisions[0].previous.taskDate,'2026-10-12');
  assert.equal(next.revisions[0].previous.expectedCloseDate,'2026-10-13');
  assert.equal(next.revisions[0].reason,'Advisor awaiting warranty claim number');
  const savedAgain=nextAdminCloseout(next,next.blocker,next.taskDate,next.expectedCloseDate,'','2026-10-13T12:00:00Z');
  assert.equal(savedAgain.revisions.length,1);
  assert.strictEqual(savedAgain,next,'Unchanged promise should retain the existing object');
  assert.equal(savedAgain.updatedAt,'2026-10-12T12:00:00Z');
});

test('update form and Open RO exception filters are manager-only; existing durable state is reused',()=>{
  for(const id of ['editAdminBlocker','editAdminCloseDate','editAdminChangeReason']) assert.ok(app.includes('id="'+id+'"'));
  for(const filter of ['admin-closeout','admin-commitment-needed','admin-overdue']) assert.ok(app.includes('value="'+filter+'"'));
  assert.match(app,/adminCloseout=nextAdminCloseoutEvidence\(commitments,currentAdminCloseoutEvidence\(\),now\(\)\)/);
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
  assert.ok(app.includes('Administrative closeout action changed in workbook: confirm changes to advisor task commitments directly with the manager in Open RO Control.'));
  assert.ok(app.includes('proposed.nextAction !== (current.nextAction || "")'));
  assert.ok(!app.includes('proposed.reviewDate !== (current.adminCloseout.taskDate || "")'));
  assert.match(app,/adminCloseoutState\(record,today\)\.dueToday\s*\?\s*3/,"admin due-today priority is preserved after refactoring into the production sort helper");
  assert.match(app,/!record\.management\.nextAction\s*\?\s*\d+\s*:\s*\d+/,"missing next action remains a distinct priority tier in the shipped sort helper");
});

test('a manager review reminder is not an advisor closeout commitment', () => {
  const pending=confirmed(nextAdminCloseout(null,'Warranty approval or processing','','2026-10-16','','2026-10-11T12:00:00Z'));
  const record={management:{reviewDate:'2026-10-10',adminCloseout:pending}};
  const state=adminCloseoutState(record,'2026-10-11');
  assert.equal(state.active,true);
  assert.equal(state.taskDate,'');
  assert.equal(state.needsCommitment,true);
  assert.equal(state.taskOverdue,false);
  assert.equal(state.dueToday,false);
  assert.equal(state.closeDate,'2026-10-16');
  // Only an explicitly entered admin promise can establish the task due date.
  const promised=nextAdminCloseout(pending,pending.blocker,'2026-10-12','2026-10-16','Advisor committed to finish by October 12','2026-10-11T16:00:00Z');
  assert.equal(adminCloseoutState({management:{reviewDate:'2026-10-10',adminCloseout:promised}},'2026-10-11').taskDate,'2026-10-12');
});

test('admin promise has a dedicated date field distinct from general manager review', () => {
  assert.ok(app.includes('id="editAdminTaskDate"'));
  assert.ok(app.includes('ui.editAdminTaskDate.value = record.management.adminCloseout?.taskDate || ""'));
  assert.ok(app.includes('nextAdminCloseout(record.management.adminCloseout,adminBlocker,ui.editAdminTaskDate.value,ui.editAdminCloseDate.value'));
  assert.ok(!app.includes('nextAdminCloseout(record.management.adminCloseout,adminBlocker,commitmentDate,'));
  assert.ok(app.includes('The regular review date above is not an advisor promise'));
});

test('Home save preserves the correct RO administrative task date, never stale form state', () => {
  const home = app.slice(app.indexOf("ui.editAdminBlocker.value=record.management.adminCloseout?.blocker||''"));
  const call = home.indexOf('const saved=await saveRecord(null,false,');
  assert.ok(call > 0);
  const beforeSave=home.slice(0,call);
  assert.ok(beforeSave.includes("ui.editAdminTaskDate.value=record.management.adminCloseout?.taskDate||''"));
  assert.ok(beforeSave.includes("ui.editAdminCloseDate.value=record.management.adminCloseout?.expectedCloseDate||''"));
  assert.ok(beforeSave.includes("ui.editAdminChangeReason.value=''"));
});
