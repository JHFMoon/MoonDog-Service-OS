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

const admission = extract('  function workspaceConnectionBlockReason()', '  async function finishConnection(');
const recovery = extract('  async function withWorkspaceRecoveryHold(', '  async function createBackupNow(');
const watcher = extract('  async function folderWatchScan(', '  async function autoSurveyFolder(');
const picker = extract('    importFile: async function(file) {', '\n  });');
const sapr = extract('ui.importPerformance.addEventListener("click"', 'ui.performanceAdvisor.addEventListener(');
const arrivals = extract('ui.importAppointments.addEventListener(', '; ui.');

function fixture() {
  const callbacks = {};
  const calls = [];
  const button = key => ({ addEventListener: (_event, callback) => { callbacks[key] = callback; } });
  const context = vm.createContext({
    model: { root: {} },
    ui: { importPerformance: button('sapr'), importAppointments: button('arrivals') },
    writeAuthority: { canWrite: true },
    workspaceConnectionBusy: false, workspaceRecoveryBusy: false, supervisorWorkbookInFlight: 0,
    folderWatch: { busy: false }, dailyImportBusy: false,
    appointmentImportBusy: false, postConnectionScanBusy: false,
    folderWatchEnabled: () => true,
    watchStatus: () => calls.push('watch status'),
    recordDiagnostic: () => {},
    permission: async () => { calls.push('permission'); throw new Error('Unexpected read'); },
    run: action => action(),
    importPerformanceFile: async () => calls.push('sapr'),
    importAppointmentFile: async () => calls.push('arrivals'),
    stopFolderWatch: () => calls.push('stop'),
    startFolderWatch: () => calls.push('start'),
  });
  const operations = vm.runInContext(admission + recovery + watcher + sapr + arrivals + ';\n' +
    '({ withWorkspaceRecoveryHold, folderWatchScan, daily: ({' + picker + '}).importFile })', context);
  return { ...operations, context, calls, callbacks };
}

test('recovery refuses to start before active source work settles', async () => {
  const f = fixture();
  for (const flag of ['dailyImportBusy', 'appointmentImportBusy', 'postConnectionScanBusy']) {
    f.context[flag] = true;
    await assert.rejects(f.withWorkspaceRecoveryHold(() => f.calls.push('recovery')), /Workspace operation is in progress/);
    f.context[flag] = false;
  }
  f.context.folderWatch.busy = true;
  await assert.rejects(f.withWorkspaceRecoveryHold(() => f.calls.push('recovery')), /Workspace operation is in progress/);
  f.context.folderWatch.busy = false;
  assert.deepEqual(f.calls, []);
  assert.equal(await f.withWorkspaceRecoveryHold(() => 'retried'), 'retried');
});

test('held recovery prevents watcher, Daily, SAPR and Arrivals work before source I/O', async () => {
  const f = fixture();
  await f.withWorkspaceRecoveryHold(async () => {
    await f.folderWatchScan();
    assert.deepEqual(f.calls, []);
    await assert.rejects(f.daily({ arrayBuffer: async () => f.calls.push('read') }), /Workspace operation is in progress/);
    await assert.rejects(f.callbacks.sapr(), /Workspace operation is in progress/);
    await assert.rejects(f.callbacks.arrivals(), /Workspace operation is in progress/);
    assert.deepEqual(f.calls, []);
  });
  await f.callbacks.arrivals();
  assert.deepEqual(f.calls, ['arrivals']);
});
