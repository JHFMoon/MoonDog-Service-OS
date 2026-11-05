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
const date = '2026-10-31';
const csv = 'Report Date,2026-10-31\nAdvisor Name,Total ROs,VIR Printed/Emailed,VIR Use %\nSynthetic Advisor,10,0,0%';

function fixture(onRead = () => {}, onWrite = () => {}, options = {}) {
  const model = {
    root: {}, state: { records: [{ id: 'shared-ro' }], closedRecords: [] },
    settings: { schemaVersion: 4, store: { code: '9001', name: 'Synthetic Dodge' } },
    appointments: { days: {} }, performance: { snapshots: {} }, assignNext: { days: {} },
    autoImport: { seen: {} }, operationalMetrics: { csi: {}, vir: { snapshots: {} } },
    meetingCycle: { metrics: {} },
  };
  let persisted;
  const context = vm.createContext({
    model, structuredClone,
    text: value => String(value ?? ''), norm: value => String(value ?? '').trim().toLowerCase(),
    VIR_NAME_CODES: { 'synthetic advisor': '9901' }, ADVISOR_NAMES: { 9901: 'Synthetic Advisor' },
    internalObservationDate: rows => rows[0]?.[1],
    verifiedVirSourceObservationDate: source => source.reportDate,
    now: () => '2026-10-31T18:00:00Z', sourceLocations: new Map(),
    sourceFileHandle: async () => ({ getFile: async () => ({
      lastModified: Date.parse('2026-10-31T18:00:00Z'),
      text: async () => { onRead(model); return csv; },
    }) }),
    pruneDatedSnapshots: value => value,
    OPERATIONAL_METRICS_PATH: ['data', 'operational-metrics.json'],
    writeJson: async (_path, value) => { persisted = JSON.stringify(value); onWrite(model); },
    readJson: async () => options.readBack ? options.readBack() : JSON.parse(persisted),
    addHistory: async () => options.onHistory?.(model),
    removeSourceEntry: async () => options.onDelete?.(),
    recordDiagnostic: () => {}, renderOverviewIntelligence: () => {},
  });
  const importer = vm.runInContext(section('  function parseCsv(', '  const NEXT_APPOINTMENT_NAMES') +
    section('  function parseVirCsv(', '  function normalizeOperationalCoverage(') + '\nimportVirFile', context);
  return { model, durable: () => persisted, run: cleanup => importer('synthetic-vir.csv', cleanup) };
}

test('VIR publishes after readback and its explicit zero survives verified backup and hydration', async () => {
  const local = fixture(undefined, model => assert.deepEqual(model.operationalMetrics.vir.snapshots, {}));
  await local.run();
  const archive = backupFunctions(app, local.model, date);
  const { bytes } = await archive.createBackupBytes('Synthetic VIR');
  const { values } = await archive.validateBackupBytes(bytes);
  assert.equal(JSON.stringify(values['data/operational-metrics.json']), local.durable());
  const files = new Map(Object.entries(values).map(([name, value]) => [name, JSON.stringify(value)]));
  const restored = await hydrateWorkspace(app, files, {});
  const source = Object.values(restored.operationalMetrics.vir.snapshots)[0];
  assert.equal(source.reportDate, date);
  assert.equal(source.sourceStoreConfidence, 'configured-destination-only');
  assert.equal(source.advisors['9901'].utilization, 0);
  const meeting = vm.runInNewContext(
    section('  function verifiedVirSourceObservationDate(', '  function sourceFreshness(') +
    section('  function virObservationDate(', '  function virCoverageMethod(') +
    section('  function meetingVirRosterCodes(', '  function virMeetingWindowComparison(') +
    '\nvirMeetingEvidence', {
      model: restored,
      text: value => String(value ?? ''),
      localDateKey: () => date,
      validCoverageDate: value => value === date ? value : '',
      previousOperatingDateKey: () => '2026-10-30',
      configuredAdvisors: () => [{ number: '9901' }],
      validAdvisorIdentity: () => true,
      advisorDisplayName: () => 'Synthetic Advisor',
      metricEvidence: value => value,
      sourceExpectation: () => 'recommended',
    });
  assert.equal(meeting().status, 'known-zero');
  assert.equal(meeting().value, 0);
  source.advisors['9901'].utilization = null;
  assert.equal(meeting().status, 'data-mismatch');
  assert.equal(meeting().value, undefined);
  assert.throws(() => archive.verifyBackupStoreOwnership(
    { store: { code: '1002', name: 'Synthetic BMW' } }, values['data/settings.json'], true
  ), /does not match Guided Setup/);
});

test('VIR discards a source read after the Workspace root changes', async () => {
  const local = fixture(model => { model.root = {}; });
  await assert.rejects(local.run(), /changed during VIR preparation/);
  assert.equal(local.durable(), undefined);
  assert.deepEqual(local.model.operationalMetrics.vir.snapshots, {});
});

test('VIR rejects publication and preserves the replacement model if the root changes during write', async () => {
  const replacement = { vir: { snapshots: { replacement: { reportDate: '2026-11-01' } } } };
  const local = fixture(undefined, model => {
    model.root = {};
    model.operationalMetrics = replacement;
  });
  await assert.rejects(local.run(), /changed during VIR verification/);
  assert.equal(local.model.operationalMetrics, replacement);
});

test('VIR does not publish or remove the source when full readback differs', async () => {
  const local = fixture(undefined, undefined, {
    readBack: () => ({ vir: { snapshots: {} } }),
    onDelete: () => assert.fail('unverified source was removed'),
  });
  await assert.rejects(local.run(true), /could not be verified/);
  assert.deepEqual(local.model.operationalMetrics.vir.snapshots, {});
});

test('VIR retains the source if the Workspace changes after verified save', async () => {
  const local = fixture(undefined, undefined, {
    onHistory: model => { model.root = {}; },
    onDelete: () => assert.fail('source in replacement Workspace was removed'),
  });
  await assert.rejects(local.run(true), /changed before VIR cleanup/);
  assert.ok(local.durable());
});