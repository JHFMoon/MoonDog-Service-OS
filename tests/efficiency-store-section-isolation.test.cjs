const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { hydrateWorkspace, backupFunctions } = require('./helpers/workspace-source-roundtrip.cjs');

const app = readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
const start = app.indexOf('  function parseEfficiencyWorkbook(');
const end = app.indexOf('\n  function parseOpenRoSummaryWorkbook(', start);
assert.ok(start >= 0 && end > start);

const identityStart = app.indexOf('  function reportStoreCode(family)');
const identityEnd = app.indexOf('  const LEGACY_PARTICIPATION', identityStart);
assert.ok(identityStart >= 0 && identityEnd > identityStart);
const storeIdentity = app.slice(identityStart, identityEnd);

const dodge = { code: 'SYN01', name: 'Synthetic Dodge', brand: 'Dodge' };
const bmw = { code: 'SYN02', name: 'Synthetic BMW', brand: 'BMW' };

function parserContext(rows, store = dodge) {
  return vm.createContext({
    XLSX: {
      read: () => ({ SheetNames: ['Fixture'], Sheets: { Fixture: { A1: { v: 'Efficiency Tracking Report' } } } }),
      utils: { sheet_to_json: () => rows },
    },
    text: value => String(value ?? ''),
    norm: value => String(value ?? '').trim().toLowerCase(),
    validCoverageDate: value => /^20\d\d-\d\d-\d\d$/.test(value),
    performanceNumber: value => typeof value === 'number' ? value : null,
    sourcePercent: (_book, _sheet, _row, _column, value) => value ?? null,
    resolveTechnicianName: () => '9001',
    serviceAdvisorNumber: () => '9901',
    advisorDisplayName: () => 'Synthetic Advisor',
    model: { settings: { store, advisors: { 9901: {} } } },
    sourceAdapter: { reports: {} },
    now: () => '2026-10-31T12:00:00Z',
  });
}

function parse(rows, store = dodge, context = parserContext(rows, store)) {
  return vm.runInContext(storeIdentity + app.slice(start, end) + '\nparseEfficiencyWorkbook', context)([], 'synthetic-efficiency.xlsx');
}

const productive = ['productive', 'bay/tech ratio', 'bay utilization %', 'bic%', 'clock hours', 'flag hours', 'efficiency%', 'bic%'];
const nonProductive = ['non productive', 'tech count', 'asm count', 'asm/tech ratio %', 'asm hours',
  'avg. tech count saturday', 'avg. asm count saturday', 'asm/tech ratio % saturday'];

const multiStoreRows = [
  ['Efficiency Tracking Report'],
  ['Date Range: 2026-10-01 - 2026-10-31'],
  productive,
  ['SYN01 - Local Store', 1, 80, 81, 100, 110, 110, 120],
  ['Master Technician', null, null, null, 100, 110],
  ['Local, Technician', null, null, null, 100, 110],
  ['SYN02-Other Store', 1, 80, 81, 700, 740, 106, 120],
  ['Master Technician', null, null, null, 700, 740],
  ['Foreign, Technician', null, null, null, 700, 740],
  nonProductive,
  ['SYN01 - Local Store', 1, 1, 100, 40],
  ['Local, Advisor', null, null, null, 40],
  ['SYN02-Other Store', 1, 1, 100, 90],
  ['Foreign, Advisor', null, null, null, 90],
];

test('Efficiency isolates the selected dealership in both sections even with reused advisor codes', () => {
  const result = parse(multiStoreRows);
  const otherStore = parse(multiStoreRows, bmw);
  assert.equal(result.storeCode, 'SYN01');
  assert.equal(otherStore.storeCode, 'SYN02');
  assert.equal(otherStore.store.clockHours, 700);
  assert.equal(otherStore.technicians.length, 1);
  assert.equal(otherStore.technicians[0].name, 'Foreign, Technician');
  assert.equal(otherStore.advisors['9901'].asmHours, 90);
  assert.equal(result.store.clockHours, 100);
  assert.equal(result.groups.length, 1);
  assert.equal(result.technicians.length, 1);
  assert.equal(result.technicians[0].name, 'Local, Technician');
  assert.equal(result.advisors['9901'].asmHours, 40);
});

test('Efficiency retains local technician rows with numeric display prefixes', () => {
  const result = parse([
    ['Efficiency Tracking Report'],
    ['Date Range: 2026-10-01 - 2026-10-31'],
    productive,
    ['SYN01 - Local Store', 1, 80, 81, 100, 110, 110, 120],
    ['Master Technician', null, null, null, 100, 110],
    ['9001 - Local, Technician', null, null, null, 100, 110],
    nonProductive,
    ['SYN01 - Local Store', 1, 1, 100, 40],
    ['Local, Advisor', null, null, null, 40],
  ]);
  assert.equal(result.technicians.length, 1);
  assert.equal(result.technicians[0].name, '9001 - Local, Technician');
  assert.equal(result.advisors['9901'].asmHours, 40);
});

test('Arrivals reconnect rejection and retry leave Efficiency scoped to the active dealership', async () => {
  const clickStart = app.indexOf('ui.importAppointments.addEventListener(');
  const clickEnd = app.indexOf('; ui.', clickStart);
  assert.ok(clickStart >= 0 && clickEnd > clickStart);
  const context = parserContext(multiStoreRows);
  let click;
  const arrivalStores = [];
  Object.assign(context, {
    ui: { importAppointments: { addEventListener: (_event, callback) => { click = callback; } } },
    workspaceConnectionBusy: true,
    workspaceRecoveryBusy: false,
    postConnectionScanBusy: false,
    run: action => action(),
    importAppointmentFile: async () => arrivalStores.push(context.model.settings.store.code),
  });
  const readEfficiency = vm.runInContext(storeIdentity + app.slice(start, end) + '\nparseEfficiencyWorkbook', context);
  vm.runInContext(app.slice(clickStart, clickEnd + 1), context);

  const before = readEfficiency([], 'synthetic-efficiency.xlsx');
  await assert.rejects(click(), /Workspace operation is in progress/);
  assert.deepEqual(arrivalStores, []);
  assert.equal(before.advisors['9901'].asmHours, 40);

  context.model.settings.store = bmw;
  context.workspaceConnectionBusy = false;
  await click();
  const after = readEfficiency([], 'synthetic-efficiency.xlsx');
  assert.deepEqual(arrivalStores, ['SYN02']);
  assert.equal(after.storeCode, 'SYN02');
  assert.equal(after.advisors['9901'].asmHours, 90);
  assert.equal(before.advisors['9901'].asmHours, 40);
});

async function importAndReloadEfficiency(store) {
  const context = parserContext(multiStoreRows, store);
  const model = context.model;
  model.settings.schemaVersion = 4;
  Object.assign(model, {
    state: { records: [{ id: 'shared-ro' }], closedRecords: [] },
    appointments: { days: {} }, performance: { snapshots: {} }, assignNext: { days: {} },
    autoImport: { seen: {} }, operationalMetrics: { csi: {} }, meetingCycle: { metrics: {} },
  });
  let persisted;
  Object.assign(context, {
    structuredClone,
    parseSorWorkbook() {}, parseAppointmentActivityWorkbook() {}, parseMediaAsrAdvisorWorkbook() {},
    parseMediaAsrTechWorkbook() {}, parseOpenRoSummaryWorkbook() {},
    sourceFileHandle: async () => ({ getFile: async () => ({ lastModified: Date.parse('2026-10-31T12:00:00Z') }) }),
    workbookGrid: () => ({ rows: multiStoreRows }),
    dailyEvidenceDate: (_family, snapshot) => snapshot.periodEnd,
    managerConflictObservationDate: (_family, snapshot) => snapshot.periodEnd,
    pruneDatedSnapshots: snapshots => snapshots,
    localDateKey: () => '2026-10-31',
    OPERATIONAL_METRICS_PATH: ['data', 'operational-metrics.json'],
    writeJson: async (_path, payload) => { persisted = JSON.stringify(payload); },
    readJson: async () => JSON.parse(persisted),
    addHistory: async () => {},
  });
  const importerStart = app.indexOf('  async function importManagerSource(');
  const importerEnd = app.indexOf('  async function classifyImportFile(', importerStart);
  assert.ok(importerStart >= 0 && importerEnd > importerStart);
  const importReport = vm.runInContext(storeIdentity + app.slice(start, end) +
    app.slice(importerStart, importerEnd) + '\nimportManagerSource', context);
  await importReport('synthetic-efficiency.xlsx', 'efficiency', []);
  const archive = backupFunctions(app, model, '2026-10-31');
  const { bytes } = await archive.createBackupBytes('Synthetic Efficiency');
  const { values } = await archive.validateBackupBytes(bytes);
  assert.equal(JSON.stringify(values['data/operational-metrics.json']), persisted);
  const files = new Map(Object.entries(values).map(([path, value]) => [path, JSON.stringify(value)]));
  return { model: await hydrateWorkspace(app, files, {}), archive, settings: values['data/settings.json'] };
}

test('Efficiency import, backup and hydration preserve separate source values for overlapping advisor IDs', async () => {
  const first = await importAndReloadEfficiency(dodge);
  const second = await importAndReloadEfficiency(bmw);
  const firstSource = first.model.operationalMetrics.efficiency.snapshots['2026-10-31'];
  const secondSource = second.model.operationalMetrics.efficiency.snapshots['2026-10-31'];
  assert.equal(firstSource.storeCode, dodge.code);
  assert.equal(firstSource.advisors['9901'].asmHours, 40);
  assert.equal(secondSource.storeCode, bmw.code);
  assert.equal(secondSource.advisors['9901'].asmHours, 90);
  assert.equal(firstSource.periodStart, '2026-10-01');
  assert.equal(secondSource.periodEnd, '2026-10-31');
  assert.throws(() => first.archive.verifyBackupStoreOwnership(second.settings, first.settings, true),
    /does not match Guided Setup/);
});
