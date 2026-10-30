const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../assets/app.js'),'utf8');
const begin = app.indexOf('  function installAdminCloseoutUi() {');
const end = app.indexOf('  installAdminCloseoutUi();',begin);
assert.ok(begin>=0 && end>begin, 'RO editor legacy controls still initialize');
const installer=app.slice(begin,end);

test('administrative closeout form is no longer visible in RO update control',()=>{
  assert.match(installer,/section\.hidden\s*=\s*true;/);
  assert.match(installer,/section\.style\.display\s*=\s*"none";/);
  assert.ok(installer.indexOf('section.hidden = true;')<installer.indexOf('ui.editCommunication.closest("label").before(section)'), 'hide before inserting');
});

test('stored administrative evidence can still roundtrip without deleting legacy input nodes',()=>{
  for(const id of ['editAdminBlocker','editAdminWorkStatus','editAdminTaskDate','editAdminCloseDate','editAdminPickupStatus','editAdminPickupContactDate','editAdminPickupDate','editAdminWarrantyStatus','editAdminEvidence','editAdminChangeReason','editAdminCoachingGroup','editAdminCoachingStatus','editAdminCoachingAction'])
    assert.ok(installer.includes('id="'+id+'"'), id+' must remain available for compatible saved records');
  assert.match(installer,/ui\[id\]\s*=\s*document\.getElementById\(id\)/);
});
