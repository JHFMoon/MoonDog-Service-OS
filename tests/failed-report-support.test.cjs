'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.js'), 'utf8');
const start = app.indexOf('  function failedReportArchivePath(');
const end = app.indexOf('  async function writeValidatedBackup(', start);
assert.ok(start >= 0 && end > start, 'failed-report export integrity helpers exist');

const digest = async bytes => crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const helpers = vm.runInNewContext(
  app.slice(start, end) + '\n({failedReportArchivePath,verifyFailedReportZip,removeVerifiedFailedSources})',
  {JSZip: {}, sha256: digest}
);
const {failedReportArchivePath, verifyFailedReportZip, removeVerifiedFailedSources} = helpers;
function zipLoader(manifest, files, extras = []) {
  const entries = new Map([['diagnostics.json', JSON.stringify(manifest)], ['README.txt', 'review locally'], ...files, ...extras]);
  return {
    loadAsync: async () => ({
      files: Object.fromEntries([...entries.keys()].map(name => [name, {}])),
      file(name) {
        if (!entries.has(name)) return null;
        const value = entries.get(name);
        return {async: async format => format === 'string' ? value : new Uint8Array(value)};
      }
    })
  };
}

test('failed report archive names are confined below the originals folder', () => {
  assert.equal(failedReportArchivePath(0, '../../secret.xlsx'), 'failed-originals/001-.._.._secret.xlsx');
  assert.match(failedReportArchivePath(1, 'report.xlsx'), /^failed-originals\/002-report\.xlsx$/);
});

test('real JSZip read-back verification checks diagnostics and exact original bytes', async () => {
  const original = new Uint8Array([0, 10, 13, 255, 65]);
  const source = {
    name: 'synthetic-report.xlsx', archivePath: 'failed-originals/001-synthetic-report.xlsx',
    size: original.byteLength, sha256: await digest(original), diagnostic: 'Synthetic parser failure.'
  };
  const manifest = {files: [{
    name: source.name, archivePath: source.archivePath, size: source.size,
    sha256: source.sha256, diagnostic: source.diagnostic
  }]};
  const zip = zipLoader(manifest, [[source.archivePath, original]]);
  const verified = await verifyFailedReportZip(new Uint8Array([1]), [source], zip, digest);
  assert.equal(verified.manifest.files.length, 1);

  await assert.rejects(
    verifyFailedReportZip(new Uint8Array([2]), [source], zipLoader(manifest, [[source.archivePath, new Uint8Array([0, 10, 13, 255, 66])]]), digest),
    /original-file verification failed/
  );
});

test('support ZIP rejects missing or mismatched per-file diagnostics', async () => {
  const source = {
    name: 'synthetic.csv', archivePath: 'failed-originals/001-synthetic.csv',
    size: 1, sha256: await digest(new Uint8Array([1])), diagnostic: 'Expected diagnostic.'
  };
  await assert.rejects(
    verifyFailedReportZip(new Uint8Array([1]), [source], zipLoader({files: []}, [[source.archivePath, new Uint8Array([1])]]), digest),
    /inventory does not match/
  );
  const validManifest = {files: [{
    name: source.name, archivePath: source.archivePath, size: source.size,
    sha256: source.sha256, diagnostic: source.diagnostic
  }]};
  await assert.rejects(
    verifyFailedReportZip(new Uint8Array([1]), [source], zipLoader(validManifest, [[source.archivePath, new Uint8Array([1])]], [['unrelated.txt', 'unexpected']]), digest),
    /files outside the verified originals/
  );
});

function syntheticFolder(contents) {
  const removed = [];
  return {
    removed,
    async removeEntry(name) {
      if (!contents.has(name)) throw new Error(`Missing ${name}`);
      contents.delete(name);
      removed.push(name);
    }
  };
}

function syntheticSource(name, bytes, lastModified = 100) {
  const contents = new Uint8Array(bytes);
  return {
    name, size: contents.byteLength, lastModified, sha256: null,
    handle: {getFile: async () => ({size: contents.byteLength, lastModified, arrayBuffer: async () => contents.slice().buffer})}
  };
}

test('failed-report deletion preflights every original before removing any', async () => {
  const first = syntheticSource('one.xlsx', [1, 2]);
  const second = syntheticSource('two.xlsx', [3, 4]);
  second.sha256 = await digest(new Uint8Array([9, 9]));
  const folder = syntheticFolder(new Map([['one.xlsx', true], ['two.xlsx', true]]));
  await assert.rejects(removeVerifiedFailedSources(folder, [first, second], digest), /changed before cleanup/);
  assert.deepEqual(folder.removed, []);
});

test('failed-report cleanup removes only the exact verified originals in its export set', async () => {
  const first = syntheticSource('one.xlsx', [1, 2]);
  const second = syntheticSource('two.xlsx', [3, 4]);
  first.sha256 = await digest(new Uint8Array([1, 2]));
  second.sha256 = await digest(new Uint8Array([3, 4]));
  const folder = syntheticFolder(new Map([['one.xlsx', true], ['two.xlsx', true], ['unrelated.xlsx', true]]));
  assert.equal(await removeVerifiedFailedSources(folder, [first, second], digest), 2);
  assert.deepEqual(folder.removed, ['one.xlsx', 'two.xlsx']);
});

test('failure inventory excludes unsupported successes and resolved imports', () => {
  const start = app.indexOf('  function pendingLearnedFailureRecords(');
  const end = app.indexOf('  async function scanFailedLearnedSources(', start);
  const currentModel = {
    autoImport: {seen: {
      unsupported: {storedAs: 'unsupported.txt', importFailed: false},
      resolved: {storedAs: 'resolved.xlsx', importFailed: false, failureResolvedAt: '2026-10-17T12:00:00Z'},
      prior: {storedAs: 'failed.xlsx', importFailed: true, failedAt: '2026-10-16T12:00:00Z', diagnostic: 'Prior reason'},
      latest: {storedAs: 'failed.xlsx', importFailed: true, failedAt: '2026-10-17T12:00:00Z', diagnostic: 'Latest reason'}
    }}
  };
  const inventory = vm.runInNewContext(`${app.slice(start, end)}\npendingLearnedFailureRecords()`, {model: currentModel});
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].name, 'failed.xlsx');
  assert.equal(inventory[0].metadata.diagnostic, 'Latest reason');
});

test('Imports-only warning uses an explicit local picker, verifies read-back before deletion, and never uploads', () => {
  const workflow = app.slice(
    app.indexOf('async function createFailedLearnedSupportPackage('),
    app.indexOf('function ensureFailedLearnedReportUi(', app.indexOf('async function createFailedLearnedSupportPackage('))
  );
  assert.ok(workflow.includes('window.showSaveFilePicker'));
  assert.ok(workflow.includes('await verifyFailedReportZip(savedBytes, sources, JSZip, sha256)'));
  assert.ok(workflow.indexOf('await verifyFailedReportZip(savedBytes') < workflow.indexOf('await removeVerifiedFailedSources('));
  assert.ok(workflow.includes('await sha256(savedBytes) !== archiveHash'));
  assert.doesNotMatch(workflow, /\bfetch\s*\(|XMLHttpRequest|sendBeacon/);
  assert.ok(app.includes('ensureFailedLearnedReportUi();'));
  assert.ok(app.includes('if (view === "imports") void refreshFailedLearnedReportNotice()'));
});
