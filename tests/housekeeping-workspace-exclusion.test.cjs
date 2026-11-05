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
const reconnect = extract('  function workspaceConnectionBlockReason()', '  async function finishConnection(');
const recovery = extract('  async function withWorkspaceRecoveryHold(', '  async function createBackupNow(');
const maintenance = extract('      busy:()=>!writeAuthority.canWrite', '\n      references:').trim();

function fixture() {
  const context = vm.createContext({
    model: { root: {}, connectionState: 'CONNECTED', recovery: { status: 'Ready' } },
    writeAuthority: { canWrite: true },
    workspaceConnectionBusy: false,
    workspaceRecoveryBusy: false,
    maintenanceEngine: { running: false },
    maintenanceOperations: 0,
    folderWatch: { busy: false },
    dailyImportBusy: false,
    appointmentImportBusy: false,
    postConnectionScanBusy: false,
    supervisorWorkbookInFlight: 0,
    document: { fullscreenElement: null },
  });
  const reconnectReason = vm.runInContext(reconnect + '\nworkspaceConnectionBlockReason', context);
  const maintenanceBusy = vm.runInContext('({' + maintenance + '}).busy', context);
  const recoveryHold = vm.runInContext(recovery + '\nwithWorkspaceRecoveryHold', context);
  return { context, reconnectReason, maintenanceBusy, recoveryHold };
}

test('running housekeeping excludes Workspace replacement and releases it once finished', () => {
  const { context, reconnectReason } = fixture();
  context.maintenanceEngine.running = true;
  assert.match(reconnectReason(), /another workspace operation/);
  context.maintenanceEngine.running = false;
  assert.equal(reconnectReason(), '');
});

test('housekeeping defers while Workspace reconnection is active', () => {
  const { context, maintenanceBusy } = fixture();
  assert.equal(maintenanceBusy(), false);
  context.workspaceConnectionBusy = true;
  assert.equal(maintenanceBusy(), true);
  context.workspaceConnectionBusy = false;
  assert.equal(maintenanceBusy(), false);
});

test('recovery and housekeeping exclude one another before writes', async () => {
  const { context, maintenanceBusy, recoveryHold } = fixture();
  context.maintenanceEngine.running = true;
  let calls = 0;
  await assert.rejects(recoveryHold(() => { calls++; }), /housekeeping is in progress/);
  assert.equal(calls, 0);
  context.maintenanceEngine.running = false;
  await recoveryHold(() => {
    calls++;
    assert.equal(maintenanceBusy(), true);
  });
  assert.equal(calls, 1);
  assert.equal(maintenanceBusy(), false);
});
