const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const freshness = require('../assets/freshness.js');

// Exercise the actual production parser and importer together. In-memory stubs
// stand in for the browser's File System Access API and protected Workspace.
const app = fs.readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
const start = app.indexOf('  const CSI_ADVISOR_CODES = {};');
const end = app.indexOf('  const isoCell =', start);
assert.ok(start >= 0 && end > start, 'production CSI ingestion functions must be located');
const ingestionSource = app.slice(start, end);

const headers = [
  'Invite_ID', '_recordId', 'SURVEY_STATUS', 'INCLUDE_IN_SCORING',
  'Date of Survey (-04:00 GMT)', 'Service Advisor',
  'Dealer NPS (Service)', 'Sales NPS Group (Service)',
  'NPS: ServPulse', 'NPS Filter Group'
].join(',');

function harness({ scopeEnd = '2026-10-06', includeScope = true, initialSurveys = {} } = {}) {
  const lines = [
    ...(includeScope ? ['From,2026-10-01', 'To,' + scopeEnd] : []),
    headers
  ];
  const csv = lines.join('\n') + '\n';
  const csi = { surveys: { ...initialSurveys }, imports: [] };
  const model = { operationalMetrics: { csi } };
  let durable = null;
  const context = {
    model, OPERATIONAL_METRICS_PATH: ['data', 'operational-metrics.json'],
    now: () => '2026-10-07T15:00:00Z',
    localDateKey: () => '2026-10-07',
    text: (value) => value == null ? '' : String(value),
    norm: (value) => String(value ?? '').trim().toLowerCase(),
    validCoverageDate: (value) => /^20\d{2}-\d{2}-\d{2}$/.test(String(value || '')) ? value : '',
    strictReportDate: () => '',
    csvNumber: (value) => value === '' ? null : Number(value),
    parseCsv: (value) => value.trimEnd().split(/\r?\n/).map((line) => line.split(',')),
    sourceFileHandle: async () => ({ getFile: async () => ({ text: async () => csv }) }),
    freshness,
    writeJson: async (_, value) => { durable = structuredClone(value); },
    readJson: async () => durable,
    addHistory: async () => {},
    removeSourceEntry: async () => {},
    renderOverviewIntelligence: () => {},
    renderMeeting: () => {}
  };
  vm.runInNewContext(ingestionSource + '\nthis.importCsiFile = importCsiFile;', context, {
    filename: 'assets/app.js CSI ingestion'
  });
  return { importCsiFile: context.importCsiFile, csi, durable: () => durable };
}

test('validated header-only zero-response CSI report passes production parse and import', async () => {
  const { importCsiFile, csi, durable } = harness();
  await importCsiFile('zero-response.csv');
  assert.equal(csi.imports.length, 1);
  assert.equal(csi.imports[0].rows, 0);
  assert.equal(csi.imports[0].dailySummary.responses, 0);
  assert.equal(csi.imports[0].dailySummary.nps, null);
  assert.equal(csi.imports[0].scopeVerified, true);
  assert.equal(csi.imports[0].scopeEnd, '2026-10-06');
  assert.equal(durable().csi.imports[0].scopeEnd, '2026-10-06');
  assert.equal(freshness.evaluateSource({
    key: 'csi', exists: true, today: '2026-10-07',
    scopeVerified: csi.imports[0].scopeVerified,
    scopeEnd: csi.imports[0].scopeEnd,
    sourceTimestamp: csi.imports[0].importedAt
  }).status, 'current');
});

test('reimported stale CSI scope stays stale despite a fresh local import timestamp', async () => {
  const { importCsiFile, csi } = harness({ scopeEnd: '2026-10-03' });
  await importCsiFile('old-report.csv');
  const latest = csi.imports.at(-1);
  assert.equal(freshness.evaluateSource({
    key: 'csi', exists: true, today: '2026-10-07',
    scopeVerified: latest.scopeVerified, scopeEnd: latest.scopeEnd,
    sourceTimestamp: latest.importedAt
  }).status, 'stale');
});

test('unverified empty CSI export is rejected without writing Workspace state', async () => {
  const { importCsiFile, csi, durable } = harness({ includeScope: false });
  await assert.rejects(importCsiFile('unverified.csv'), /no scoring surveys and no verified reporting scope/);
  assert.equal(csi.imports.length, 0);
  assert.equal(durable(), null);
});

test('valid zero-response report retains previously imported survey history', async () => {
  const existing = { 'old-id': { id: 'old-id', surveyDate: '2026-10-02', score: 10 } };
  const { importCsiFile, csi, durable } = harness({ initialSurveys: existing });
  await importCsiFile('empty-but-current.csv');
  assert.deepEqual(Object.keys(csi.surveys), ['old-id']);
  assert.equal(durable().csi.surveys['old-id'].score, 10);
});
