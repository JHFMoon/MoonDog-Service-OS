const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const freshness = require('../assets/freshness.js');

// Exercise the actual production parser and importer together. In-memory stubs
// stand in for the browser's File System Access API and protected Workspace.
const app = fs.readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
const start = app.indexOf('  const CSI_ADVISOR_CODES = {};');
const end = app.indexOf('  const isoCell =', start);
assert.ok(start >= 0 && end > start, 'production CSI ingestion functions must be located');
const ingestionSource = app.slice(start, end);
const digestStart = app.indexOf('  async function sha256(');
const digestEnd = app.indexOf('  async function readFileBytes(', digestStart);
assert.ok(digestStart >= 0 && digestEnd > digestStart, 'production SHA-256 helper must exist');
const digestHelper = app.slice(digestStart, digestEnd);

const headers = [
  'Invite_ID', '_recordId', 'SURVEY_STATUS', 'INCLUDE_IN_SCORING',
  'Date of Survey (-04:00 GMT)', 'Service Advisor',
  'Dealer NPS (Service)', 'Sales NPS Group (Service)',
  'NPS: ServPulse', 'NPS Filter Group'
].join(',');

function harness({
  scopeStart = '2026-10-01', scopeEnd = '2026-10-06', includeScope = true,
  initialSurveys = {}, surveyDates = []
} = {}) {
  const lines = [
    ...(includeScope ? ['From,' + scopeStart, 'To,' + scopeEnd] : []),
    headers,
    ...surveyDates.map((date, index) =>
      [`SYN-${index}`, `PULSE-${index}`, 'Pulse Completed', 'Yes', date, '', 10, 'Promoter', 10, 'Promoter'].join(','))
  ];
  const csv = lines.join('\n') + '\n';
  const csi = { surveys: { ...initialSurveys }, imports: [] };
  const model = { operationalMetrics: { csi } };
  let durable = null;
  const events = [], history = [];
  const context = {
    model, structuredClone, crypto, TextEncoder, OPERATIONAL_METRICS_PATH: ['data', 'operational-metrics.json'],
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
    addHistory: async (type, _message, metadata) => {
      events.push(type);
      history.push({type, metadata});
    },
    removeSourceEntry: async () => events.push("source-deleted"),
    renderOverviewIntelligence: () => {},
    renderMeeting: () => {}
  };
  vm.runInNewContext(digestHelper + '\n' + ingestionSource + '\nthis.importCsiFile = importCsiFile;', context, {
    filename: 'assets/app.js CSI ingestion'
  });
  return { importCsiFile: context.importCsiFile, csi, durable: () => durable, events, history };
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
  assert.equal(csi.imports[0].sourceStoreConfidence, 'configured-destination-only',
    'unsigned CSI cannot independently verify the originating dealership');
  assert.equal(durable().csi.imports[0].sourceStoreConfidence, 'configured-destination-only');
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

test('impossible CSI survey dates fail before any write, history, or source cleanup', async () => {
  const prior = { 'old-id': { id: 'old-id', surveyDate: '2026-02-02', score: 10 } };
  for (const surveyDate of ['2026-02-30T12:00:00-04:00', '2/29/2026 13:00', '2026-04-31']) {
    const {importCsiFile, csi, durable, events} = harness({
      scopeStart: '2026-01-01', initialSurveys: prior, surveyDates: [surveyDate]
    });
    await assert.rejects(importCsiFile('calendar-invalid.csv', true), /CSI survey date could not be read/);
    assert.equal(durable(), null);
    assert.deepEqual(csi.surveys, prior);
    assert.deepEqual(csi.imports, []);
    assert.deepEqual(events, []);
  }
});

test('verified leap-day CSI survives ISO, US and Excel date formats', async () => {
  const serial = (Date.UTC(2024, 1, 29) - Date.UTC(1899, 11, 30)) / 86400000;
  const {importCsiFile, csi, durable} = harness({
    scopeStart: '2024-02-01',
    surveyDates: ['2024-02-29T12:00:00-04:00', '2/29/24 13:00', serial + 0.5]
  });
  await importCsiFile('calendar-valid.csv');
  assert.deepEqual(Object.values(durable().csi.surveys).map(survey => survey.surveyDate),
    ['2024-02-29', '2024-02-29', '2024-02-29']);
  assert.equal(csi.imports[0].dailySummary.responses, 3);
});

test('a corrected survey can replace an impossible saved date under the same Invite ID', async () => {
  const prior = { id: 'SYN-0', surveyDate: '2026-02-30', score: 10, extensionRecordIds: ['SYN-EXT'] };
  const {importCsiFile, csi, durable, history} = harness({
    scopeStart: '2026-01-01',
    initialSurveys: {'SYN-0': prior},
    surveyDates: ['2026-02-28']
  });
  await importCsiFile('calendar-corrected.csv');
  assert.equal(csi.surveys['SYN-0'].surveyDate, '2026-02-28');
  assert.deepEqual(Array.from(csi.surveys['SYN-0'].extensionRecordIds), ['SYN-EXT']);
  assert.equal(durable().csi.surveys['SYN-0'].surveyDate, '2026-02-28');
  assert.equal(history[0].metadata.revisedMetricSurveyCount, 1);
  assert.equal(prior.surveyDate, '2026-02-30');
});
