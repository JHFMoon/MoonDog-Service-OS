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
const csv = [
  'Next Appointments Scheduled Summary,,From:,10/01/2026',
  ',,To:,10/31/2026',
  'Opportunities:,10',
  'Vehicles Serviced:,10',
  'Scheduled:,0',
  'Not Scheduled:,10',
  'Existing Appointments:,0',
  'Success:,0%',
  'Service Advisors,ID,Opportunities,Scheduled,Not Scheduled,Existing Appointments,Success',
  'Synthetic Advisor,9901,10,0,10,0,0%',
].join('\n');

function fixture(source, { onRead = () => {}, onWrite = () => {} } = {}) {
  const model = {
    root: {}, state: { records: [{ id: 'shared-ro' }], closedRecords: [] },
    settings: { schemaVersion: 4, store: { code: '9001', name: 'Synthetic Dodge' } },
    appointments: { days: {} }, performance: { snapshots: {} }, assignNext: { days: {} },
    autoImport: { seen: {} }, operationalMetrics: { csi: {}, nextAppointments: { snapshots: {} } },
    meetingCycle: { metrics: {} },
  };
  let durable;
  const context = vm.createContext({
    model, structuredClone, ADVISOR_NAMES: { 9901: 'Synthetic Advisor' },
    text: value => String(value ?? ''), norm: value => String(value ?? '').trim().toLowerCase(),
    now: () => '2026-11-02T18:00:00Z', localDateKey: () => '2026-11-02',
    previousOperatingDateKey: () => day, isSunday: () => false,
    OPERATIONAL_METRICS_PATH: ['data', 'operational-metrics.json'],
    sourceFileHandle: async () => ({ getFile: async () => ({ text: async () => { onRead(model); return source; } }) }),
    writeJson: async (_path, value) => { durable = JSON.stringify(value); onWrite(model); },
    readJson: async () => JSON.parse(durable),
    addHistory: async () => {}, renderOverviewIntelligence: () => {},
  });
  const importer = vm.runInContext(
    section('  function usDateToIso(', '  const CONTROLLABLES') +
    section('  function parseCsv(', '  function appointmentSummaryAdvisor(') +
    section('  function parseAppointmentsCreatedSummaryCsv(', '  function parseCashClearingWorkbook(') +
    section('  function latestNextAppointmentsSnapshot(', '  const VIR_NAME_CODES =') +
    '\nNEXT_APPOINTMENT_NAMES["9901"]="synthetic advisor"; importNextAppointmentsFile', context);
  return { model, durable: () => durable, run: () => importer('synthetic-next-appointments.csv') };
}

test('Next Appointments preserves a verified zero through archive and hydration', async () => {
  const local = fixture(csv);
  await local.run();
  const archive = backupFunctions(app, local.model, day);
  const { bytes } = await archive.createBackupBytes('Synthetic Next Appointments');
  const { values } = await archive.validateBackupBytes(bytes);
  assert.equal(JSON.stringify(values['data/operational-metrics.json']), local.durable());
  assert.throws(() => archive.verifyBackupStoreOwnership(
    { store: { code: '1002', name: 'Synthetic BMW' } }, values['data/settings.json'], true
  ), /does not match Guided Setup/);
  const files = new Map(Object.entries(values).map(([name, value]) => [name, JSON.stringify(value)]));
  const restored = await hydrateWorkspace(app, files, {});
  const latest = vm.runInNewContext(
    section('  function latestNextAppointmentsSnapshot(', '  function effectiveOperationalCoverageDate(') +
    '\nlatestNextAppointmentsSnapshot', { model: restored });
  const snapshot = latest();
  assert.equal(snapshot.periodEnd, day);
  assert.equal(snapshot.sourceStoreConfidence, 'configured-destination-only');
  assert.equal(snapshot.summary.opportunities, 10);
  assert.equal(snapshot.summary.successRate, 0);
  assert.equal(snapshot.advisors['9901'].successRate, 0);
});

test('Next Appointments refuses a missing success value before persistence', async () => {
  const local = fixture(csv.replace('Success:,0%', 'Success:,'));
  await assert.rejects(local.run(), /store summary is incomplete/);
  assert.equal(local.durable(), undefined);
});

test('Next Appointments cannot use a source read from a superseded Workspace', async () => {
  const local = fixture(csv, { onRead: model => { model.root = {}; } });
  await assert.rejects(local.run(), /changed during Next Appointments preparation/);
  assert.equal(local.durable(), undefined);
});

test('Next Appointments does not expose candidate data while the durable write is pending', async () => {
  const local = fixture(csv, { onWrite: model => {
    assert.deepEqual(model.operationalMetrics.nextAppointments.snapshots, {});
  } });
  await local.run();
});

test('Next Appointments preserves a newer live revision while verification is pending', async () => {
  const local = fixture(csv, { onWrite: model => { model.operationalMetrics.updatedAt = 'newer live revision'; } });
  await assert.rejects(local.run(), /changed during Next Appointments verification/);
  assert.equal(local.model.operationalMetrics.updatedAt, 'newer live revision');
  assert.deepEqual(local.model.operationalMetrics.nextAppointments.snapshots, {});
});
