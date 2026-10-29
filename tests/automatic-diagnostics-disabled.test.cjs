'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.js'), 'utf8');
const start = app.indexOf('  // Automatic diagnostics logging is intentionally disabled.');
const end = app.indexOf('  async function writeJson(path, value,restoreId) {', start);

test('optional event diagnostics never create a Workspace journal or background write', async () => {
  assert.ok(start >= 0 && end > start, 'disabled diagnostics boundary is present');
  const snippet = app.slice(start, end);
  assert.doesNotMatch(snippet, /writeBytes|safeWrite|fileAt|setTimeout|visibilitychange|pendingDiagnostics|maintainDiagnostics/);
  const attempted = [];
  const recordDiagnostic = vm.runInNewContext(snippet + '\nrecordDiagnostic', {
    writeBytes: () => attempted.push('write'),
    setTimeout: () => attempted.push('timer'),
    document: {addEventListener: () => attempted.push('listener')}
  });
  for (const kind of ['DURABLE WRITE', 'DURABLE WRITE FAILED', 'IMPORT', 'SUPPORT']) {
    await recordDiagnostic(kind, 'synthetic event');
  }
  assert.deepEqual(attempted, [], 'recording diagnostics does not touch the filesystem or schedule writes');
});

test('automatic diagnostic report is not written during operational saves or new-store setup', () => {
  assert.doesNotMatch(app, /(?:writeBytes|writeText)\(\[?\s*["']MOONDOG_DIAGNOSTICS\.md["']/);
  assert.doesNotMatch(app, /maintainDiagnostics|flushDiagnostics|diagnosticTimer|pendingDiagnostics/);
  assert.match(app, /async function writeJson\(path, value,restoreId\)/);
  assert.match(app, /await writeBytes\(path,bytes,restoreId\)/);
  assert.match(app, /zip\.file\("MOONDOG_DIAGNOSTICS\.md",diagnostics\)/, 'explicit support package remains available');
});

test('transaction protection remains intact and historic diagnostics file is preserved', () => {
  const authority = fs.readFileSync(path.join(__dirname, '..', 'assets', 'moondog-write-authority.js'), 'utf8');
  assert.match(authority, /async function recoverPending\(root, revision\)/);
  assert.match(authority, /PENDING_TRANSACTION/);
  assert.match(authority, /Uncommitted write journal requires controlled recovery/);
  assert.doesNotMatch(app, /removePath\(\["MOONDOG_DIAGNOSTICS\.md"\]\)/);
});
