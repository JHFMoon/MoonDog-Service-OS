const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app = readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
function extract(first, last) {
  const start = app.indexOf(first);
  const end = app.indexOf(last, start);
  assert.ok(start >= 0 && end > start);
  return app.slice(start, end);
}
const source = extract('  function isAppointmentPdf(signature)', '\n') +
  '\n' + extract('  async function importAppointmentFile(', '\n  let arrivalStatusWriteBusy');

function fixture({ approved, picked = false, format = 'pdf' } = {}) {
  const payload = new TextEncoder().encode(format === 'pdf' ? '%PDF-SYNTHETIC' : 'SYNTHETIC-XLSX');
  const original = { days: {} };
  const model = {
    root: {},
    settings: { store: { code: 'SYN-B', name: 'Synthetic BMW' } },
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
    strictReportDate: () => '2026-11-04', localDateKey: () => '2026-11-04',
    parseAppointmentSource: async () => [{ id: 'synthetic-id', advisorCode: 'SHARED' }],
    window: { confirm: message => { prompts.push(message); return prompts.length === 1 && approved; } },
    structuredClone, stamp: () => 'synthetic', slug: value => value, now: () => 'synthetic-time',
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
  const importFile = vm.runInContext(source + '\nimportAppointmentFile', context);
  return { model, original, calls, prompts, run: automatic => importFile(name, automatic, payload) };
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
