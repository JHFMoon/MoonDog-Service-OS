const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../assets/app.js'),'utf8');
const begin = app.indexOf('  function installAdminCloseoutUi() {');
const end = app.indexOf('  installAdminCloseoutUi();',begin);
assert.ok(begin>=0 && end>begin, 'RO editor legacy controls still initialize');
const installer=app.slice(begin,end);

test('administrative closeout form is no longer visible in RO update control',()=>{
  assert.match(installer,/section\.hidden\s*=\s*true;/);
  assert.match(installer,/section\.style\.display\s*=\s*"none";/);
  assert.match(installer,/ui\.adminCloseoutEditor\s*=\s*section;/);
  assert.ok(installer.indexOf('section.hidden = true;')<installer.indexOf('ui.editCommunication.closest("label").before(section)'), 'hide before inserting');
});

test('stored administrative evidence can still roundtrip without deleting legacy input nodes',()=>{
  for(const id of ['editAdminBlocker','editAdminWorkStatus','editAdminTaskDate','editAdminCloseDate','editAdminPickupStatus','editAdminPickupContactDate','editAdminPickupDate','editAdminWarrantyStatus','editAdminEvidence','editAdminChangeReason','editAdminCoachingGroup','editAdminCoachingStatus','editAdminCoachingAction'])
    assert.ok(installer.includes('id="'+id+'"'), id+' must remain available for compatible saved records');
  assert.match(installer,/ui\[id\]\s*=\s*document\.getElementById\(id\)/);
});

const savePolicyStart=app.indexOf('      const adminEditorHidden=');
const savePolicyEnd=app.indexOf('      if(!nextAction',savePolicyStart);
assert.ok(savePolicyStart>=0&&savePolicyEnd>savePolicyStart,'production inline save policy must exist');
const inlineSavePolicy=app.slice(savePolicyStart,savePolicyEnd);
const decide=(prior,submittedBlocker,hidden)=>{
  const context={record:{management:{adminCloseout:prior}},submitted:{adminBlocker:submittedBlocker},ui:{adminCloseoutEditor:{hidden}}};
  vm.runInNewContext(inlineSavePolicy+'\nthis.decision={adminEditorHidden,adminBlocker};',context);
  return context.decision;
};

test('hidden editor preserves existing administrative data and skips unseen admin updates',()=>{
  const old={blocker:'Customer pickup',taskDate:'2026-10-28',expectedCloseDate:'2026-10-30',physicalWorkStatus:'verified',revisions:[{reason:'original'}],evidence:'legacy evidence'};
  const decision=decide(old,'',true);
  assert.equal(decision.adminBlocker,old.blocker);
  assert.equal(decision.adminEditorHidden,true);
  assert.match(app,/if\(!adminEditorHidden&&\(adminBlocker\|\|record\.management\.adminCloseout\?\.blocker\)\)try\{/);
  assert.match(app,/proposed=\{\.\.\.record\.management/);
});

test('hidden editor does not reinterpret unknown historical admin blockers',()=>{
  const decision=decide({blocker:'legacy-unsupported-value'},'',true);
  assert.equal(decision.adminBlocker,'legacy-unsupported-value');
  assert.equal(decision.adminEditorHidden,true);
});

test('stale hidden input cannot create a new administrative blocker',()=>{
  const decision=decide(null,'Customer pickup',true);
  assert.equal(decision.adminBlocker,'');
  assert.equal(decision.adminEditorHidden,true);
});

test('visible legacy editor uses explicitly submitted admin values only',()=>{
  const decision=decide({blocker:'Customer pickup'},'Billing / paperwork',false);
  assert.equal(decision.adminBlocker,'Billing / paperwork');
  assert.equal(decision.adminEditorHidden,false);
});
