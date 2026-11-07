const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const freshness = require('../assets/freshness.js');
const { hydrateWorkspace, backupFunctions } = require('./helpers/workspace-source-roundtrip.cjs');

const app = readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
function extract(first, last) {
  const start = app.indexOf(first);
  const end = app.indexOf(last, start);
  assert.ok(start >= 0 && end > start);
  return app.slice(start, end);
}
const source = extract('  function isAppointmentPdf(signature)', '\n') +
  '\n' + extract('  async function importAppointmentFile(', '\n  let arrivalStatusWriteBusy');

const sdlParser = extract('  function parseAppointments(bytes, date)', '  async function importAppointmentFile(');
const selector = extract('  function sourceFreshness(', '  function metricDependencyEvidence(');
const date = '2026-11-04';
const sdlRows = [
  ['Report Date', date],
  ['Time', 'Customer', 'SA', 'Customer #', 'Year', 'Model', 'Service Request'],
  ['08:00', 'Synthetic Guest', 'SHARED', 'SYN-CUSTOMER', '2025', 'Synthetic', 'Synthetic visit'],
];

function fixture({ approved, picked = false, format = 'pdf', realParser = false, storeCode = 'SYN-B' } = {}) {
  const payload = new TextEncoder().encode(format === 'pdf' ? '%PDF-SYNTHETIC' : 'SYNTHETIC-XLSX');
  const original = { days: {} };
  const model = {
    root: {},
    settings: { store: { code: storeCode, name: storeCode === 'SYN-B' ? 'Synthetic BMW' : 'Synthetic Dodge' } },
    appointments: original,
  };
  const name = 'synthetic.' + format;
  const calls = [];
  const prompts = [];
  let durable;
  const context = vm.createContext({
    model, ui: { status: { textContent: '' } },
    dailyPickedSources: new Map(picked ? [[name, {}]] : []),
    folderWatch: { busy: false }, dailyImportBusy: false,
    appointmentImportBusy: false, arrivalStatusWriteBusy: false,
    syncArrivalDate: () => {}, status: () => {}, boundedPdfRead: action => action(),
    sourceFileHandle: async () => {
      calls.push('read');
      return { getFile: async () => ({ size: payload.length, lastModified: 1 }) };
    },
    pdfSignatureText: async () => 'PRE-WORKORDER SERVICE ADVISOR: SYNTHETIC 11/04/2026 08:00',
    strictReportDate: () => date, localDateKey: () => date,
    workbookGrid: () => ({ rows: sdlRows }),
    internalObservationDate: rows => rows[0][1],
    XLSX: {
      read: () => ({ Sheets: { 'Service Daily Log': {} } }),
      utils: { sheet_to_json: () => sdlRows },
    },
    text: value => String(value ?? ''), ARRIVAL_ADVISOR_NAMES: { SHARED: 'Synthetic Advisor' },
    visitSummary: value => value, timeMinutes: () => 480,
    parseAppointmentSource: async () => [{ id: 'synthetic-id', advisorCode: 'SHARED' }],
    window: { confirm: message => { prompts.push(message); return prompts.length === 1 && approved; } },
    structuredClone, stamp: () => 'synthetic', slug: value => value, now: () => '2026-11-04T16:00:00Z',
    APPOINTMENTS_PATH: ['data', 'appointments.json'],
    writeBytes: async () => calls.push('audit copy'),
    writeJson: async (target, value) => {
      calls.push(target.at(-1) === 'appointments.json' ? 'snapshot' : 'backup');
      if (target.at(-1) === 'appointments.json') durable = structuredClone(value);
    },
    readJson: async () => durable,
    addHistory: async type => calls.push(type),
    completeExactReviewedInboxSource: async () => calls.push('ledger'),
    renderArrivals: () => {},
    recordDiagnostic: () => {},
    removeSourceEntry: async () => calls.push('delete'),
  });
  if (realParser) context.parseAppointmentSource = vm.runInContext(sdlParser + '\nparseAppointments', context);
  const importFile = vm.runInContext(source + '\nimportAppointmentFile', context);
  return { model, original, calls, prompts, durable: () => durable, run: automatic => importFile(name, automatic, payload) };
}

for (const format of ['pdf', 'xlsx']) {
  test('unsigned unattended Arrivals ' + format + ' is refused before source I/O', async () => {
    const f = fixture({ format });
    await assert.rejects(f.run(true), /unsigned Arrivals sources require explicit/);
    assert.deepEqual(f.calls, []);
    assert.equal(f.model.appointments, f.original);
  });
}

test('declined dealership confirmation preserves the previous Arrivals data', async () => {
  const f = fixture({ approved: false, picked: true });
  await assert.rejects(f.run(false), /were not confirmed/);
  assert.equal(f.model.appointments, f.original);
  assert.deepEqual(f.calls, ['read', 'appointments-import-failed']);
});

test('explicit review saves destination-only provenance before reconciling the Inbox marker', async () => {
  const f = fixture({ approved: true });
  const outcome = await f.run(false);
  assert.equal(outcome.saved, true);
  assert.equal(outcome.deleted, false);
  assert.match(f.prompts[0], /Synthetic BMW \(SYN-B\)/);
  assert.equal(f.model.appointments.days['2026-11-04'].sourceStoreConfidence, 'configured-destination-only');
  assert.deepEqual(f.calls, ['read', 'backup', 'audit copy', 'snapshot', 'appointments-import', 'ledger']);
});

test('reviewed SDL rows survive durable reload while the same advisor ID cannot authorize another store', async () => {
  const local = fixture({ approved: true, picked: true, format: 'xlsx', realParser: true });
  const other = fixture({ approved: false, picked: true, format: 'xlsx', realParser: true, storeCode: 'SYN-A' });
  await local.run(false);
  await assert.rejects(other.run(false), /were not confirmed/);
  assert.equal(other.durable(), undefined);
  assert.deepEqual(other.model.appointments.days, {});

  const appointments = JSON.parse(JSON.stringify(local.durable()));
  const retained = appointments.days[date];
  assert.equal(retained.appointments[0].advisorCode, 'SHARED');
  assert.equal(retained.sourceStoreConfidence, 'configured-destination-only');
  const context = vm.createContext({
    model: { appointments }, freshness,
    sourceExpectation: () => 'recommended', businessTimeZone: () => 'America/Los_Angeles',
  });
  const selected = vm.runInContext(selector + '\nsourceFreshness', context)('appointments', { today: date });
  assert.equal(selected.reportPeriodVerified, true);
  assert.equal(selected.periodEnd, date);
  assert.equal(selected.safeForCurrent, true);
});

test('reviewed Arrivals import survives backup validation and production Workspace hydration', async () => {
  const local = fixture({ approved: true, picked: true, format: 'xlsx', realParser: true });
  await local.run(false);
  const durable = {
    ...local.model, state: { records: [{ id: 'shared-ro' }], closedRecords: [] },
    settings: { ...local.model.settings, schemaVersion: 4 },
    appointments: local.durable(), performance: { snapshots: {} },
    assignNext: { days: {} }, autoImport: { seen: {} },
    operationalMetrics: { csi: {} }, meetingCycle: { metrics: {} },
  };
  const backup = backupFunctions(app, durable, date);
  const { bytes } = await backup.createBackupBytes('Synthetic reviewed Arrivals');
  const { values } = await backup.validateBackupBytes(bytes);
  assert.equal(backup.verifyBackupStoreOwnership(durable.settings, values['data/settings.json'], true), true);
  assert.throws(() => backup.verifyBackupStoreOwnership(
    { store: { code: 'SYN-A', name: 'Synthetic Dodge' } }, values['data/settings.json'], true
  ), /does not match Guided Setup/);

  const files = new Map(Object.entries(values).map(([path, value]) => [path, JSON.stringify(value)]));
  const model = await hydrateWorkspace(app, files, { appointments: { days: {} } });
  assert.deepEqual(model.appointments, local.durable());
  assert.equal(model.appointments.days[date].sourceStoreConfidence, 'configured-destination-only');
  const context = vm.createContext({
    model, freshness, sourceExpectation: () => 'recommended', businessTimeZone: () => 'America/Los_Angeles',
  });
  const selected = vm.runInContext(selector + '\nsourceFreshness', context)('appointments', { today: date });
  assert.equal(selected.safeForCurrent, true);
  assert.equal(selected.periodEnd, date);

  const prior = model.appointments;
  files.set('data/meeting-cycle.json', '{');
  await assert.rejects(hydrateWorkspace(app, files, model), /JSON/);
  assert.equal(model.appointments, prior, 'a corrupt companion file cannot publish partial hydration');
});
