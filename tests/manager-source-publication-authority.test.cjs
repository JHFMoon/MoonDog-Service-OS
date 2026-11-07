const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const app = readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
const start = app.indexOf('  async function importManagerSource(');
const end = app.indexOf('  async function classifyImportFile(', start);
assert.ok(start >= 0 && end > start);

function fixture({ onWrite = async () => {}, onOpen = async () => {}, corrupt = false } = {}) {
  const period = '2026-10-31';
  const original = { mediaAsrTech: { directory: { 9001: { sourceAliases: ['Original'] } } } };
  const model = { root: {}, operationalMetrics: original };
  const events = [];
  let durable;
  const context = vm.createContext({
    model, structuredClone,
    parseSorWorkbook: () => {}, parseAppointmentActivityWorkbook: () => {},
    parseMediaAsrAdvisorWorkbook: () => {}, parseMediaAsrTechWorkbook: () => {}, parseOpenRoSummaryWorkbook: () => {},
    parseEfficiencyWorkbook: () => ({
      periodStart: '2026-10-01', periodEnd: period, store: { clockHours: 100 },
      technicians: [{ number: '9001', name: 'Synthetic Alias' }],
    }),
    workbookGrid: () => ({ rows: [] }),
    sourceFileHandle: async () => ({ getFile: async () => { await onOpen(model); return { lastModified: 1 }; } }),
    dailyEvidenceDate: (_family, source) => source.periodEnd,
    managerConflictObservationDate: (_family, source) => source.periodEnd,
    pruneDatedSnapshots: snapshots => snapshots,
    localDateKey: () => period, now: () => '2026-11-04T12:00:00Z',
    OPERATIONAL_METRICS_PATH: ['data', 'operational-metrics.json'],
    writeJson: async (_path, next) => {
      events.push('write');
      durable = structuredClone(next);
      await onWrite(model);
    },
    readJson: async () => {
      if (corrupt) durable.mediaAsrTech.directory['9001'].sourceAliases = ['Wrong'];
      return durable;
    },
    addHistory: async () => events.push('history'),
    removeSourceEntry: async () => events.push('cleanup'),
  });
  const run = vm.runInContext(app.slice(start, end) + '\nimportManagerSource', context);
  return { model, original, events, run: () => run('synthetic-efficiency.xlsx', 'efficiency', [], true) };
}

test('manager report exposes its values and alias only after durable verification', async () => {
  const f = fixture({ onWrite: async model => {
    assert.equal(model.operationalMetrics, f.original);
    assert.equal(model.operationalMetrics.efficiency, undefined);
    assert.deepEqual(model.operationalMetrics.mediaAsrTech.directory['9001'].sourceAliases, ['Original']);
  }});
  await f.run();
  assert.equal(f.model.operationalMetrics.efficiency.snapshots['2026-10-31'].store.clockHours, 100);
  assert.deepEqual(Array.from(f.model.operationalMetrics.mediaAsrTech.directory['9001'].sourceAliases),
    ['Original', 'Synthetic Alias']);
  assert.deepEqual(f.events, ['write', 'history', 'cleanup']);
});

test('manager report refuses stale preparation and full-payload readback mismatch', async () => {
  const stale = fixture({ onOpen: async model => { model.root = {}; } });
  await assert.rejects(stale.run(), /changed during report preparation/);
  assert.deepEqual(stale.events, []);
  assert.equal(stale.model.operationalMetrics, stale.original);

  const corrupt = fixture({ corrupt: true });
  await assert.rejects(corrupt.run(), /could not be verified/);
  assert.equal(corrupt.model.operationalMetrics, corrupt.original);
  assert.deepEqual(corrupt.events, ['write']);
});
