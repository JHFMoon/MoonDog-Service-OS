const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}
const backup = extract('  async function withWorkspaceRecoveryHold(', '  async function scanRecoveryBackups()');
const connect = extract('  let postConnectionScanBusy=false;', '  async function finishConnection(');

function fixture(backupPromise, recordHistory = async () => {}) {
  const calls = [];
  const context = vm.createContext({
    workspaceConnectionBusy: false,
    supervisorWorkbookInFlight: 0,
    folderWatch: { busy: false },
    dailyImportBusy: false,
    appointmentImportBusy: false,
    model: { recovery: { status: 'Ready' } },
    VERSION: 'synthetic',
    RECOVERY_PATH: ['data', 'recovery.json'],
    renderRecovery: () => calls.push('render'),
    writeValidatedBackup: () => { calls.push('backup'); return backupPromise; },
    writeJson: async () => calls.push('write'),
    addHistory: async () => { calls.push('history'); await recordHistory(); },
    scanRecoveryBackups: async () => {},
    status: () => {},
    recordDiagnostic: () => {},
  });
  const api = vm.runInContext(connect + backup + '\n({ createBackupNow, workspaceConnectionBlockReason })', context);
  return { ...api, context, calls };
}

test('backup cannot begin or write while a Workspace connection is active', async () => {
  const { context, createBackupNow, calls } = fixture(Promise.resolve(null));
  context.workspaceConnectionBusy = true;
  await assert.rejects(createBackupNow(), /Workspace operation is in progress/);
  assert.equal(context.model.recovery.status, 'Ready');
  assert.deepEqual(calls, []);
});

test('an active backup excludes reconnect and releases its hold after failure', async () => {
  let rejectBackup;
  const pending = new Promise((_, reject) => { rejectBackup = reject; });
  const { createBackupNow, workspaceConnectionBlockReason, calls } = fixture(pending);
  const result = createBackupNow();
  try {
    assert.match(workspaceConnectionBlockReason(), /another workspace operation/);
    await assert.rejects(createBackupNow(), /Workspace operation is in progress/);
    assert.deepEqual(calls, ['render', 'backup']);
  } finally {
    rejectBackup(new Error('synthetic backup failure'));
    await assert.rejects(result, /synthetic backup failure/);
  }
  assert.equal(workspaceConnectionBlockReason(), '');
});

test('successful backup excludes reconnect until recovery history is saved', async () => {
  let finishHistory;
  let historyStarted;
  const started = new Promise(resolve => { historyStarted = resolve; });
  const pending = new Promise(resolve => { finishHistory = resolve; });
  const manifest = { createdAt: '2026-11-04T12:00:00Z', recordCounts: { openRos: 0 } };
  const { context, createBackupNow, workspaceConnectionBlockReason, calls } = fixture(
    Promise.resolve({ name: 'Synthetic backup.zip', manifest }),
    () => { historyStarted(); return pending; }
  );
  const originalRecovery = context.model.recovery;
  const result = createBackupNow();
  await started;
  try {
    assert.equal(context.model.recovery.status, 'Backup ready');
    assert.equal(context.model.recovery.lastBackup.fileName, 'Synthetic backup.zip');
    assert.match(workspaceConnectionBlockReason(), /another workspace operation/);
  } finally {
    finishHistory();
    await result;
  }
  assert.equal(context.model.recovery, originalRecovery);
  assert.equal(workspaceConnectionBlockReason(), '');
  assert.deepEqual(calls, ['render', 'backup', 'write', 'history', 'render']);
});
