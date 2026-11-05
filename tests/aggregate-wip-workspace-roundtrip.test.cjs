const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { hydrateWorkspace, backupFunctions } = require('./helpers/workspace-source-roundtrip.cjs');

const app = readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
function section(first, last) {
  const start = app.indexOf(first), end = app.indexOf(last, start + first.length);
  assert.ok(start >= 0 && end > start, first);
  return app.slice(start, end);
}

const day = '2026-10-31';
function fixture(code) {
  const rows = Array.from({ length: 15 }, () => []);
  rows[0][0] = 'Open RO for 9001 - Synthetic Dodge';
  rows[10][2] = 'Customer Pay';
  rows[11][0] = "OPEN RO'S 10/31/2026";
  rows[13][2] = 0;
  rows[13][27] = 12;
  rows[14][0] = '9901';
  rows[14][2] = 0;
  rows[14][27] = 3;
  const model = {
    root: {}, state: { records: [{ id: 'synthetic-tracker-ro' }], closedRecords: [] },
    settings: { schemaVersion: 4, store: { code, name: code === '9001' ? 'Synthetic Dodge' : 'Synthetic BMW' } },
    appointments: { days: {} }, performance: { snapshots: {} }, assignNext: { days: {} },
    autoImport: { seen: {} }, operationalMetrics: { csi: {} }, meetingCycle: { metrics: {} },
  };
  let durable;
  const context = vm.createContext({
    model, structuredClone, ADVISOR_NAMES: { 9901: 'Synthetic Advisor' },
    text: value => String(value ?? ''), norm: value => String(value ?? '').trim().toLowerCase(),
    now: () => '2026-10-31T18:00:00Z', localDateKey: () => day,
    workbookGrid: () => ({ rows }), reportStoreCode: () => code, escapeSourceCode: value => value,
    parseSorWorkbook() {}, parseAppointmentActivityWorkbook() {}, parseEfficiencyWorkbook() {},
    parseMediaAsrAdvisorWorkbook() {}, parseMediaAsrTechWorkbook() {},
    dailyEvidenceDate: (_family, source) => source.periodEnd,
    pruneDatedSnapshots: value => value,
    sourceFileHandle: async () => ({ getFile: async () => ({ lastModified: Date.parse(day) }) }),
    OPERATIONAL_METRICS_PATH: ['data', 'operational-metrics.json'],
    writeJson: async (_path, value) => { durable = JSON.stringify(value); },
    readJson: async () => JSON.parse(durable),
    addHistory: async () => {},
  });
  const importer = vm.runInContext(
    section('function workbookDate(', '  async function permission(') +
    section('  function usDateToIso(', '  const CONTROLLABLES') +
    section('  function performanceNumber(', '  function performanceRows(') +
    section('  function parseOpenRoSummaryWorkbook(', '  async function classifyImportFile(') +
    '\nimportManagerSource', context);
  return { model, durable: () => durable, run: () => importer('synthetic-wip.xlsx', 'open-ro-summary', []) };
}

test('Aggregate WIP retains dealership scope and stays separate from detailed tracker through hydration', async () => {
  const foreign = fixture('1002');
  await assert.rejects(foreign.run(), /not the configured store aggregate Open RO report/);
  assert.equal(foreign.durable(), undefined);

  const local = fixture('9001');
  await local.run();
  const archive = backupFunctions(app, local.model, day);
  const { bytes } = await archive.createBackupBytes('Synthetic Aggregate WIP');
  const { values } = await archive.validateBackupBytes(bytes);
  assert.equal(JSON.stringify(values['data/operational-metrics.json']), local.durable());
  const files = new Map(Object.entries(values).map(([name, value]) => [name, JSON.stringify(value)]));
  const restored = await hydrateWorkspace(app, files, {});
  const snapshot = restored.operationalMetrics.openRoSummary.snapshots[day];
  assert.equal(snapshot.storeCode, '9001');
  assert.equal(snapshot.store.total.open, 12);
  assert.equal(snapshot.store.customerPay.open, 0);
  assert.equal(snapshot.store.warranty.open, null);
  assert.equal(snapshot.advisors['9901'].total.open, 3);
  assert.equal(snapshot.validation.separateFromDetailedTracker, true);
  assert.deepEqual(restored.state.records.map(record => record.id), ['synthetic-tracker-ro']);
});
