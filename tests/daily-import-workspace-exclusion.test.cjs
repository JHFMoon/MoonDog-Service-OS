const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
const start = source.indexOf('    importFile: async function(file) {');
const end = source.indexOf('\n  });', start);
assert.ok(start >= 0 && end > start);
const picker = source.slice(start, end);

for (const flag of ['workspaceConnectionBusy', 'postConnectionScanBusy']) {
  test('Daily import is blocked before touching the source during ' + flag, async () => {
    const calls = [];
    const context = vm.createContext({
      model: { root: {} },
      folderWatch: { busy: false },
      dailyImportBusy: false,
      appointmentImportBusy: false,
      workspaceConnectionBusy: false,
      postConnectionScanBusy: false,
      dailyPickedSources: new Map(),
      folderWatchEnabled: () => true,
      stopFolderWatch: () => calls.push('stop'),
      startFolderWatch: () => calls.push('start'),
      classifyImportFile: async () => 'csi',
      processClassifiedCandidate: async () => calls.push('import'),
      completeExactReviewedInboxSource: async () => calls.push('reconcile'),
      dailyNotify: () => calls.push('notify'),
      [flag]: true,
    });
    const importFile = vm.runInContext('({' + picker + '}).importFile', context);
    const file = { name: 'synthetic.csv', arrayBuffer: async () => calls.push('read') };
    await assert.rejects(importFile(file), /Workspace import or connection is in progress/);
    assert.deepEqual(calls, []);
    assert.equal(context.dailyImportBusy, false);
    assert.equal(context.dailyPickedSources.size, 0);
    context[flag] = false;
    assert.equal(await importFile(file), 'csi');
    assert.deepEqual(calls, ['stop', 'read', 'import', 'reconcile', 'notify', 'start']);
    assert.equal(context.dailyImportBusy, false);
    assert.equal(context.dailyPickedSources.size, 0);
  });
}

const queueStart = source.indexOf('    const connectedRoot=model.root;\n    // Let the first interactive frame settle.');
const queueEnd = source.indexOf('\n  async function postConnectReconciliation(', queueStart);
assert.ok(queueStart >= 0 && queueEnd > queueStart);
const queuedChecks = source.slice(queueStart, queueEnd);

function queueFixture() {
  const initialRoot = {};
  const timers = [];
  const jobs = [];
  const context = vm.createContext({
    model: { root: initialRoot },
    writeAuthority: { canWrite: true },
    workspaceConnectionBusy: false,
    postConnectionScanBusy: false,
    folderWatch: { busy: false },
    dailyImportBusy: false,
    appointmentImportBusy: false,
    permissionWasPending: false,
    setTimeout: callback => timers.push(callback),
    folderWatchScan: () => jobs.push('inbox'),
    ensurePreviousMonthSummary: () => jobs.push('month-end'),
    ensureDailyFocus: () => jobs.push('focus'),
    scanAppointmentAndPerformanceFiles: () => jobs.push('sources'),
    ensureMeetingCycleBaseline: () => jobs.push('meeting'),
    scanRecoveryBackups: () => jobs.push('recovery'),
    runVerifiedUpdateFollowup: () => jobs.push('update follow-up'),
    renderRecovery: () => jobs.push('render'),
    recordDiagnostic: () => {},
  });
  vm.runInContext('(function(){' + queuedChecks + ')()', context);
  return { context, timers, jobs };
}

test('queued checks wait when Daily import begins during the idle slice', async () => {
  const { context, timers, jobs } = queueFixture();
  const completion = timers.shift()();
  context.dailyImportBusy = true;
  timers.shift()();
  await new Promise(setImmediate);
  assert.deepEqual(jobs, []);
  assert.equal(context.postConnectionScanBusy, false);
  context.dailyImportBusy = false;
  while (timers.length) {
    timers.shift()();
    await new Promise(setImmediate);
  }
  await completion;
  assert.deepEqual(jobs, ['inbox', 'month-end', 'focus', 'sources', 'meeting', 'recovery', 'update follow-up', 'render']);
});

test('queued checks abandon the old Workspace if it changes while waiting', async () => {
  const { context, timers, jobs } = queueFixture();
  const completion = timers.shift()();
  context.appointmentImportBusy = true;
  timers.shift()();
  await new Promise(setImmediate);
  assert.deepEqual(jobs, []);
  context.model.root = {};
  timers.shift()();
  await completion;
  assert.deepEqual(jobs, []);
});
