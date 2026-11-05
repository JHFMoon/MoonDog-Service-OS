const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const app = readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
const start = app.indexOf('  function parseEfficiencyWorkbook(');
const end = app.indexOf('\n  function parseOpenRoSummaryWorkbook(', start);
assert.ok(start >= 0 && end > start);

const identityStart = app.indexOf('  function reportStoreCode(family)');
const identityEnd = app.indexOf('  const LEGACY_PARTICIPATION', identityStart);
assert.ok(identityStart >= 0 && identityEnd > identityStart);
const storeIdentity = app.slice(identityStart, identityEnd);

const dodge = { code: 'SYN01', name: 'Synthetic Dodge', brand: 'Dodge' };
const bmw = { code: 'SYN02', name: 'Synthetic BMW', brand: 'BMW' };

function parse(rows, store = dodge) {
  const context = vm.createContext({
    XLSX: {
      read: () => ({ SheetNames: ['Fixture'], Sheets: { Fixture: { A1: { v: 'Efficiency Tracking Report' } } } }),
      utils: { sheet_to_json: () => rows },
    },
    text: value => String(value ?? ''),
    norm: value => String(value ?? '').trim().toLowerCase(),
    validCoverageDate: value => /^20\d\d-\d\d-\d\d$/.test(value),
    performanceNumber: value => typeof value === 'number' ? value : null,
    sourcePercent: (_book, _sheet, _row, _column, value) => value ?? null,
    resolveTechnicianName: () => '9001',
    serviceAdvisorNumber: () => '9901',
    advisorDisplayName: () => 'Synthetic Advisor',
    model: { settings: { store, advisors: { 9901: {} } } },
    sourceAdapter: { reports: {} },
    now: () => '2026-10-31T12:00:00Z',
  });
  return vm.runInContext(storeIdentity + app.slice(start, end) + '\nparseEfficiencyWorkbook', context)([], 'synthetic-efficiency.xlsx');
}

const productive = ['productive', 'bay/tech ratio', 'bay utilization %', 'bic%', 'clock hours', 'flag hours', 'efficiency%', 'bic%'];
const nonProductive = ['non productive', 'tech count', 'asm count', 'asm/tech ratio %', 'asm hours',
  'avg. tech count saturday', 'avg. asm count saturday', 'asm/tech ratio % saturday'];

test('Efficiency isolates the selected dealership in both sections even with reused advisor codes', () => {
  const rows = [
    ['Efficiency Tracking Report'],
    ['Date Range: 2026-10-01 - 2026-10-31'],
    productive,
    ['SYN01 - Local Store', 1, 80, 81, 100, 110, 110, 120],
    ['Master Technician', null, null, null, 100, 110],
    ['Local, Technician', null, null, null, 100, 110],
    ['SYN02 - Other Store', 1, 80, 81, 700, 740, 106, 120],
    ['Master Technician', null, null, null, 700, 740],
    ['Foreign, Technician', null, null, null, 700, 740],
    nonProductive,
    ['SYN01 - Local Store', 1, 1, 100, 40],
    ['Local, Advisor', null, null, null, 40],
    ['SYN02 - Other Store', 1, 1, 100, 90],
    ['Foreign, Advisor', null, null, null, 90],
  ];
  const result = parse(rows);
  const otherStore = parse(rows, bmw);
  assert.equal(result.storeCode, 'SYN01');
  assert.equal(otherStore.storeCode, 'SYN02');
  assert.equal(otherStore.store.clockHours, 700);
  assert.equal(otherStore.technicians.length, 1);
  assert.equal(otherStore.technicians[0].name, 'Foreign, Technician');
  assert.equal(otherStore.advisors['9901'].asmHours, 90);
  assert.equal(result.store.clockHours, 100);
  assert.equal(result.groups.length, 1);
  assert.equal(result.technicians.length, 1);
  assert.equal(result.technicians[0].name, 'Local, Technician');
  assert.equal(result.advisors['9901'].asmHours, 40);
});

test('Efficiency retains local technician rows with numeric display prefixes', () => {
  const result = parse([
    ['Efficiency Tracking Report'],
    ['Date Range: 2026-10-01 - 2026-10-31'],
    productive,
    ['SYN01 - Local Store', 1, 80, 81, 100, 110, 110, 120],
    ['Master Technician', null, null, null, 100, 110],
    ['9001 - Local, Technician', null, null, null, 100, 110],
    nonProductive,
    ['SYN01 - Local Store', 1, 1, 100, 40],
    ['Local, Advisor', null, null, null, 40],
  ]);
  assert.equal(result.technicians.length, 1);
  assert.equal(result.technicians[0].name, '9001 - Local, Technician');
  assert.equal(result.advisors['9901'].asmHours, 40);
});
