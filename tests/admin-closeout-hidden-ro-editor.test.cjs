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

const saveDecisionStart = app.indexOf('  function adminCloseoutSaveDecision(');
const saveDecisionEnd = app.indexOf('  async function saveRecord(', saveDecisionStart);
assert.ok(saveDecisionStart>=0 && saveDecisionEnd>saveDecisionStart, 'production legacy-save policy must exist');
const sandbox={};
vm.runInNewContext(app.slice(saveDecisionStart,saveDecisionEnd)+'\nthis.decide=adminCloseoutSaveDecision;',sandbox);

test('hidden editor leaves existing administrative fields untouched by ordinary RO saves',()=>{
  const old={blocker:'Customer pickup',taskDate:'2026-10-28',expectedCloseDate:'2026-10-30',physicalWorkStatus:'verified',revisions:[{reason:'original'}],evidence:'legacy evidence'};
  const decision=sandbox.decide(old,'',true);
  assert.equal(decision.blocker,old.blocker);
  assert.equal(decision.editable,false);
  assert.match(app,/if\(adminDecision\.editable\)try\{/);
  assert.match(app,/proposed=\{\.\.\.record\.management/);
});

test('hidden editor cannot block a normal RO save on an unrecognized historical admin blocker',()=>{
  const decision=sandbox.decide({blocker:'legacy-unsupported-value'},'',true);
  assert.equal(decision.blocker,'legacy-unsupported-value');
  assert.equal(decision.editable,false);
});

test('no administrative blocker stays absent when the hidden form has stale values',()=>{
  const decision=sandbox.decide(null,'Customer pickup',true);
  assert.equal(decision.blocker,'');
  assert.equal(decision.editable,false);
});

test('visible-only legacy editor continues to allow intentional admin changes',()=>{
  const decision=sandbox.decide({blocker:'Customer pickup'},'Billing / paperwork',false);
  assert.equal(decision.blocker,'Billing / paperwork');
  assert.equal(decision.editable,true);
});
