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

const connection = extract('  let postConnectionScanBusy=false;', '  async function finishConnection(');
const hold = extract('  async function withWorkspaceRecoveryHold(', '  async function createBackupNow(');
const buttons = extract('ui.interruptedRecoveryButton.addEventListener(', 'ui.showDiagnosticsLocation.addEventListener(');

for (const name of ['restoreBackup', 'interruptedRecoveryButton']) {
  test(name + ' holds the current Workspace during preflight and releases it after failure', async () => {
    let rejectPreflight;
    const pending = new Promise((_, reject) => { rejectPreflight = reject; });
    const handlers = {};
    let calls = 0;
    const restore = () => { calls++; return context.workspaceConnectionBusy ? Promise.resolve() : pending; };
    const button = id => ({ addEventListener: (_event, handler) => { handlers[id] = handler; } });
    const context = vm.createContext({
      ui: { restoreBackup: button('restoreBackup'), interruptedRecoveryButton: button('interruptedRecoveryButton') },
      workspaceConnectionBusy: true,
      supervisorWorkbookInFlight: 0,
      folderWatch: { busy: false },
      dailyImportBusy: false,
      appointmentImportBusy: false,
      restoreSelectedBackup: restore,
      recoverInterruptedRestore: restore,
      run: action => action(),
    });
    const blockReconnect = vm.runInContext(connection + hold + buttons + '\nworkspaceConnectionBlockReason', context);
    await assert.rejects(handlers[name](), /connection, workbook, or recovery operation/);
    assert.equal(calls, 0);

    context.workspaceConnectionBusy = false;
    const attempt = handlers[name]();
    try {
      assert.equal(calls, 1);
      assert.match(blockReconnect(), /another workspace operation/);
      await assert.rejects(handlers.interruptedRecoveryButton(), /connection, workbook, or recovery operation/);
      await assert.rejects(handlers.restoreBackup(), /connection, workbook, or recovery operation/);
    } finally {
      rejectPreflight(new Error('synthetic preflight failure'));
      await assert.rejects(attempt, /synthetic preflight failure/);
    }
    assert.equal(calls, 1);
    assert.equal(blockReconnect(), '');
  });
}
