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
    assert.deepEqual(calls, ['stop', 'read', 'import', 'notify', 'start']);
    assert.equal(context.dailyImportBusy, false);
    assert.equal(context.dailyPickedSources.size, 0);
  });
}
