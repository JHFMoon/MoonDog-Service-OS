const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const app = readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
const start = app.indexOf('ui.importAppointments.addEventListener(');
const end = app.indexOf('; ui.', start);
assert.ok(start >= 0 && end > start);

for (const flag of ['workspaceConnectionBusy', 'postConnectionScanBusy', 'workspaceRecoveryBusy']) {
  test('Arrivals import excludes ' + flag + ' before reading an appointment source', async () => {
    let click;
    let imports = 0;
    const context = vm.createContext({
      ui: { importAppointments: { addEventListener: (_event, callback) => { click = callback; } } },
      workspaceConnectionBusy: false,
      workspaceRecoveryBusy: false,
      postConnectionScanBusy: false,
      run: action => action(),
      importAppointmentFile: async () => { imports++; },
      [flag]: true,
    });
    vm.runInContext(app.slice(start, end + 1), context);
    await assert.rejects(click(), /Workspace operation is in progress/);
    assert.equal(imports, 0);
    context[flag] = false;
    await click();
    assert.equal(imports, 1);
  });
}
