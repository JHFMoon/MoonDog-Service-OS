const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const app = readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
function extract(first, last) {
  const start = app.indexOf(first);
  const end = app.indexOf(last, start);
  assert.ok(start >= 0 && end > start);
  return app.slice(start, end);
}
const workbook = extract('  let supervisorWorkbookOperationTail', '  const dailyPickedSources');
const admission = extract('  function workspaceConnectionBlockReason()', '  async function finishConnection(');
const recovery = extract('  async function withWorkspaceRecoveryHold(', '  async function createBackupNow(');

function fixture() {
  let finish;
  const active = new Promise(resolve => { finish = resolve; });
  const calls = [];
  const state = { records: [], closedRecords: [] };
  const context = vm.createContext({
    model: { root: {}, state },
    workspaceConnectionBusy: false,
    workspaceRecoveryBusy: false,
    folderWatch: { busy: false }, dailyImportBusy: false,
    appointmentImportBusy: false, postConnectionScanBusy: false,
    navigator: { locks: { request: (_name, _options, action) => { calls.push('lock'); return action(); } } },
    STATE_PATH: ['data', 'state.json'],
    RECOVERY_PATH: ['data', 'recovery.json'],
    readJson: async key => key.at(-1) === 'state.json' ? structuredClone(state) : null,
  });
  const operations = vm.runInContext(workbook + admission + recovery +
    '\n({ withSupervisorWorkbookLock, withWorkspaceRecoveryHold })', context);
  return { ...operations, active, finish, calls };
}

test('recovery preflight excludes new workbook work until it settles', async () => {
  const f = fixture();
  const original = f.withWorkspaceRecoveryHold(() => f.active);
  try {
    await assert.rejects(f.withSupervisorWorkbookLock(() => {}), /recovery operation is in progress/);
    assert.deepEqual(f.calls, []);
  } finally {
    f.finish();
    await original;
  }
  assert.equal(await f.withSupervisorWorkbookLock(() => 'retried'), 'retried');
});

test('queued workbook work excludes recovery before preflight and permits safe retry', async () => {
  const f = fixture();
  const pending = f.withSupervisorWorkbookLock(() => f.active);
  try {
    await assert.rejects(f.withWorkspaceRecoveryHold(() => {}), /Workspace operation is in progress/);
  } finally {
    f.finish();
    await pending;
  }
  assert.equal(await f.withWorkspaceRecoveryHold(() => 'retried'), 'retried');
});
