const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

function section(app, first, last) {
  const start = app.indexOf(first);
  const end = app.indexOf(last, start + first.length);
  assert.ok(start >= 0 && end > start, first);
  return app.slice(start, end);
}

const snapshotPaths = {
  STATE_PATH: ['data', 'current-state.json'],
  APPOINTMENTS_PATH: ['data', 'appointments.json'],
  PERFORMANCE_PATH: ['data', 'advisor-performance.json'],
  OPERATIONAL_METRICS_PATH: ['data', 'operational-metrics.json'],
  MEETING_CYCLE_PATH: ['data', 'meeting-cycle.json'],
  ASSIGN_NEXT_PATH: ['data', 'assign-next.json'],
  AUTO_IMPORT_PATH: ['data', 'auto-import.json'],
  RECOVERY_PATH: ['data', 'recovery.json'],
};

async function hydrateWorkspace(app, files, model) {
  const hydration = section(app, '    const connectionReadSpecs = [', '    const rawSettings = pendingSettings;');
  const validate = section(app, '  function validateConnectedWorkbookSnapshot(', '  // A queued maintenance task');
  const context = vm.createContext({
    ...snapshotPaths, model, pendingSettings: {}, pendingAdapter: null,
    newWorkspaceSnapshot: () => ({}),
    readJson: async (parts, fallback) => {
      const saved = files.get(parts.join('/'));
      return saved === undefined ? fallback : JSON.parse(saved);
    },
  });
  await vm.runInContext(validate + '\n(async () => {\n' + hydration + '})()', context);
  return model;
}

// The archive adapter stores member bytes in memory. Production backup creation,
// hashing, validation, ownership checks and hydration run unchanged.
class SyntheticArchive {
  constructor() { this.members = new Map(); }
  file(path, data) {
    if (arguments.length === 2) {
      const bytes = Buffer.from(data);
      this.members.set(path, bytes.toString('base64'));
      return this;
    }
    const stored = this.members.get(path);
    if (stored === undefined) return null;
    return { async: async kind => {
      const bytes = Buffer.from(stored, 'base64');
      return kind === 'string' ? bytes.toString('utf8') : new Uint8Array(bytes);
    }};
  }
  async generateAsync() { return Buffer.from(JSON.stringify([...this.members])); }
  static async loadAsync(bytes) {
    const zip = new SyntheticArchive();
    zip.members = new Map(JSON.parse(Buffer.from(bytes).toString('utf8')));
    return zip;
  }
}

function backupFunctions(app, model, date) {
  const archive = section(app, '  const BACKUP_FILES=', '\n') + '\n' +
    section(app, '  function validateDurableObject(', '\n  async function createBackupBytes(') +
    section(app, '  async function createBackupBytes(', '\n  function backupFileName(') +
    section(app, '  function verifyBackupStoreOwnership(', '\n  async function restoreSelectedBackup(');
  const context = vm.createContext({
    model, JSZip: SyntheticArchive, VERSION: 'synthetic', BUILD_DATE: date,
    DEFAULTS: { schemaVersion: 4 }, now: () => '2026-11-04T16:00:00Z',
    utf8: value => new TextEncoder().encode(value), decodeUtf8: value => new TextDecoder().decode(value),
    sha256: async bytes => crypto.createHash('sha256').update(bytes).digest('hex'),
    directoryFiles: async () => [],
  });
  return vm.runInContext(archive +
    '\n({ createBackupBytes, validateBackupBytes, verifyBackupStoreOwnership })', context);
}

module.exports = { hydrateWorkspace, backupFunctions };
