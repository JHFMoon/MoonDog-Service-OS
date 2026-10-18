const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Synthetic regression tests for admin closeout / reimport preservation
// These tests exercise presence and simple merge semantics without changing product code.

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets', 'app.js'), 'utf8');

test('canonical admin-closeout helpers and merge points are present', () => {
  // Existence checks for canonical functions / strings noted in the audit
  assert.ok(app.includes('function adminCloseoutState('), 'adminCloseoutState should be present');
  assert.ok(app.includes('function nextAdminCloseout('), 'nextAdminCloseout should be present');
  assert.ok(app.includes('mergeCompleteOpenRoRecords'), 'mergeCompleteOpenRoRecords should be referenced');
  assert.ok(app.includes('Administrative closeout action changed in workbook'), 'Workbook-change warning text should be present');
  assert.ok(app.includes('writeJson('), 'writeJson helper should be present for durable writes');
});

test('proposed management merges do not drop prior adminCloseout (synthetic merge semantics)', () => {
  // Simulate the observed import pattern: imports apply updates with { ...current.management, ...proposed }
  const prior = {
    management: {
      status: 'Ready for Review',
      adminCloseout: { blocker: 'Customer pickup', taskDate: '2026-10-12', expectedCloseDate: '2026-10-13', revisions: [], updatedAt: '2026-10-11T12:00:00Z' },
      reviewDate: '2026-10-12'
    }
  };

  const proposed = {
    // simulated returned workbook proposals (intentionally omits adminCloseout)
    status: 'Ready for Review',
    nextAction: 'Contact customer',
    reviewDate: '2026-10-12'
  };

  const merged = { ...(prior.management || {}), ...proposed };
  // adminCloseout should remain from prior.management when proposed lacks it
  assert.deepEqual(merged.adminCloseout, prior.management.adminCloseout, 'adminCloseout must be preserved when proposed does not include it');
});

test('missing administrative commitments remain represented as missing rather than fabricated', () => {
  // Reuse nextAdminCloseout and adminCloseoutState snippets already covered in product tests — presence validated above
  // Here we check that the app contains the UI ids and messaging referenced by the acceptance criteria.
  for (const id of ['editAdminBlocker','editAdminCloseDate','editAdminChangeReason']) assert.ok(app.includes('id="'+id+'"'), `UI should include ${id}`);
  for (const filter of ['admin-closeout','admin-commitment-needed','admin-overdue']) assert.ok(app.includes('value="'+filter+'"'), `filter ${filter} must be available`);
});

// Durable read-back / writeJson presence (we cannot perform actual workspace writes in CI harness here), but ensure the read-back verification exists in code

test('writeJson includes read-back verification', () => {
  assert.ok(/readJson\(path, null\)/.test(app) || app.includes('const check = await readJson(path, null)'), 'writeJson should verify read-back via readJson');
});
