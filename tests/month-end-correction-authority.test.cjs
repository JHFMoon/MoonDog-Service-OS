const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
const start = source.indexOf('  async function applyMonthEndCorrection(');
const end = source.indexOf('  function syncArrivalDate(', start);
assert.ok(start >= 0 && end > start);
const month = '2026-10';

function fixture(onWrite = async () => {}, mismatch = false) {
  const original = { monthlySummaries: { [month]: { status: 'locked', lockedAt: 'original' } }, other: { total: 42 } };
  const model = { root: {}, operationalMetrics: original };
  const writes = [];
  let renders = 0;
  const context = vm.createContext({
    model,
    window: { confirm: () => true },
    monthEndCorrectionCandidate: () => ({ status: 'locked', lockedAt: 'corrected', basis: {} }),
    now: () => 'new time',
    stamp: () => 'synthetic',
    OPERATIONAL_METRICS_PATH: ['data', 'operational-metrics.json'],
    writeJson: async (path, value) => {
      writes.push({ path: path.join('/'), value: structuredClone(value) });
      await onWrite(writes.length, model);
    },
    readJson: async () => mismatch
      ? { ...writes.at(-1).value, other: { total: 0 } }
      : writes.at(-1).value,
    addHistory: async () => {},
    renderAll: () => { renders++; },
  });
  const apply = vm.runInContext(source.slice(start, end) + '\napplyMonthEndCorrection', context);
  return { original, model, writes, apply, rendered: () => renders };
}

test('late correction refuses to write to a different Workspace after backup', async () => {
  const replacement = { monthlySummaries: { [month]: { status: 'locked', lockedAt: 'other store' } } };
  const f = fixture(async (count, model) => {
    if (count === 1) {
      model.root = {};
      model.operationalMetrics = replacement;
    }
  });
  await assert.rejects(f.apply(month), /source data changed during backup/);
  assert.equal(f.writes.length, 1);
  assert.equal(f.model.operationalMetrics, replacement);
  assert.equal(replacement.monthlySummaries[month].lockedAt, 'other store');
});

test('late correction requires full durable readback and keeps the original visible on mismatch', async () => {
  const f = fixture(undefined, true);
  await assert.rejects(f.apply(month), /could not be verified/);
  assert.equal(f.model.operationalMetrics, f.original);
  assert.equal(f.original.monthlySummaries[month].lockedAt, 'original');
  assert.equal(f.rendered(), 0);
});

test('verified late correction preserves backup and publishes full snapshot with lineage', async () => {
  const f = fixture(async (count, model) => {
    if (count === 2) assert.equal(model.operationalMetrics.monthlySummaries[month].lockedAt, 'original');
  });
  await f.apply(month);
  assert.deepEqual(f.writes[0].value, f.original);
  assert.equal(f.model.operationalMetrics.monthlySummaries[month].correctionOf, 'original');
  assert.equal(f.model.operationalMetrics.other.total, 42);
  assert.equal(f.rendered(), 1);
});
