const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { hydrateWorkspace, backupFunctions } = require('./helpers/workspace-source-roundtrip.cjs');

const app = readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
function section(first, last) {
  const start = app.indexOf(first);
  const end = app.indexOf(last, start + first.length);
  assert.ok(start >= 0 && end > start, first);
  return app.slice(start, end);
}
const columns = ['', 'cp and wp ro count', 'media created', 'media created %', 'media sent',
  'media sent %', 'video created', 'video created %', 'video sent', 'video sent %',
  'image created', 'image created %', 'image sent', 'image sent %', 'media viewed by customer',
  'media viewed by customer %', 'customer viewed cp gross/ro'];
const date = '2026-10-31';

function fixture(role, code) {
  const rows = [
    ['Media ASR Usage Report'],
    ['for 9001 - Synthetic Dodge From 10/1/2026 to 10/31/2026'],
    [],
    columns,
    ['Grand Total', 20, 10, 50, 10, 50, 10, 50, 10, 50, 0, 0, 0, 0, 8, 40],
    [role === 'advisor' ? 'Synthetic Advisor' : '9901 - Synthetic, Technician',
      10, 5, 50, 5, 50, 5, 50, 5, 50, 0, 0, 0, 0, 4, 40],
  ];
  const model = {
    root: {}, state: { records: [{ id: 'shared-ro' }], closedRecords: [] },
    settings: { schemaVersion: 4, store: { code, name: code === '9001' ? 'Synthetic Dodge' : 'Synthetic BMW' },
      advisors: { 9901: {} } },
    appointments: { days: {} }, performance: { snapshots: {} }, assignNext: { days: {} },
    autoImport: { seen: {} }, operationalMetrics: { csi: {} }, meetingCycle: { metrics: {} },
  };
  let durable;
  const context = vm.createContext({
    model, structuredClone,
    XLSX: {
      read: () => ({ SheetNames: ['Fixture'], Sheets: { Fixture: { A1: { v: 'Media ASR Usage Report' } } } }),
      utils: { sheet_to_json: () => rows },
    },
    workbookGrid: () => ({ rows }),
    reportStoreCode: () => code, escapeSourceCode: value => value,
    text: value => String(value ?? ''), norm: value => String(value ?? '').toLowerCase().trim(),
    strictReportDate: value => value === '10/1/2026' ? '2026-10-01' : value === '10/31/2026' ? date : '',
    performanceNumber: value => typeof value === 'number' ? value : null,
    sourcePercent: (_book, _name, _r, _c, value) => value ?? null,
    validTechnicianIdentity: () => true, normalizedPerson: value => value.toLowerCase(),
    serviceAdvisorNumber: value => value === 'Synthetic Advisor' ? '9901' : '',
    advisorDisplayName: () => 'Synthetic Advisor',
    parseSorWorkbook() {}, parseAppointmentActivityWorkbook() {}, parseEfficiencyWorkbook() {}, parseOpenRoSummaryWorkbook() {},
    sourceFileHandle: async () => ({ getFile: async () => ({ lastModified: Date.parse('2026-10-31T12:00:00Z') }) }),
    dailyEvidenceDate: (_family, source) => source.periodEnd,
    managerConflictObservationDate: (_family, source) => source.periodEnd,
    pruneDatedSnapshots: value => value,
    localDateKey: () => date, now: () => '2026-10-31T18:00:00Z',
    OPERATIONAL_METRICS_PATH: ['data', 'operational-metrics.json'],
    writeJson: async (_path, value) => { durable = JSON.stringify(value); },
    readJson: async () => JSON.parse(durable),
    addHistory: async () => {},
  });
  const importer = vm.runInContext(
    section('  function learnTechnicians(', '  function parseEfficiencyWorkbook(') +
    section('  async function importManagerSource(', '  async function classifyImportFile(') +
    '\nimportManagerSource', context);
  return { model, durable: () => durable, importReport: () => importer(
    'synthetic-media-asr.xlsx', role === 'advisor' ? 'media-asr' : 'media-asr-tech', []) };
}

for (const role of ['advisor', 'technician']) {
  test('Media ASR ' + role + ' stays scoped through real import, backup validation and hydration', async () => {
    const foreign = fixture(role, '1002');
    await assert.rejects(foreign.importReport(), /structure or store could not be verified/);
    assert.equal(foreign.durable(), undefined);

    const local = fixture(role, '9001');
    await local.importReport();
    const archive = backupFunctions(app, local.model, date);
    const { bytes } = await archive.createBackupBytes('Synthetic Media ASR');
    const { values } = await archive.validateBackupBytes(bytes);
    assert.equal(JSON.stringify(values['data/operational-metrics.json']), local.durable());
    const files = new Map(Object.entries(values).map(([name, value]) => [name, JSON.stringify(value)]));
    const restored = await hydrateWorkspace(app, files, {});
    const family = role === 'advisor' ? 'mediaAsr' : 'mediaAsrTech';
    const retained = restored.operationalMetrics[family].snapshots[date];
    assert.equal(retained.storeCode, '9001');
    assert.equal(retained.periodStart, '2026-10-01');
    assert.equal(retained.periodEnd, date);
    assert.equal(retained.sourceScope, role);
    assert.equal(retained.store.mediaViewedRate, 40);
    if (role === 'advisor') {
      assert.equal(retained.advisors['9901'].mediaViewedRate, 40);
      assert.deepEqual(retained.technicians, []);
    } else {
      assert.equal(retained.technicians[0].number, '9901');
      assert.deepEqual(retained.advisors, {});
      assert.equal(restored.operationalMetrics.mediaAsrTech.directory['9901'].lastSourceDate, date);
    }
  });
}
