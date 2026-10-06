const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'updates/manifest.json'), 'utf8'));

assert.match(html, /<title>Service Operations Hub<\/title>/);
assert.match(app, /const SOURCE_ADAPTER_BOOTSTRAP_PATH = \["data", "source-adapter-bootstrap\.json"\]/);
assert.match(app, /const LEGACY_ADVISORS = \{\};/);
assert.match(app, /const PRERO_ADVISORS = \{\};/);
assert.match(app, /const VIR_NAME_CODES = \{\};/);
assert.match(app, /const CSI_ADVISOR_CODES = \{\};/);
assert.match(app, /const ARRIVAL_ADVISOR_NAMES = \{\};/);
assert.match(app, /function reportStoreCode\(family\)/);
assert.match(app, /function unassignedAdvisorCode\(\)|const unassignedAdvisorCode =/);
assert.match(app, /grossMinimum:\s*null/);
assert.match(app, /grossStretch:\s*null/);
assert.match(app, /storeGrossTarget:\s*null/);
assert.match(app, /cpElr:\s*null/);
assert.match(app, /cpHoursPerRo:\s*null/);
assert.doesNotMatch(app, /\$(?:75|100|800)K/i);
assert.doesNotMatch(app, /(?:grossMinimum|grossStretch|storeGrossTarget|dealerNps|menuPresentation|menuPenetration|mediaViewed|texting|cpElr|cpHoursPerRo)\s*:\s*-?\d/);
assert.match(html, /Local Performance Targets/);
assert.match(html, /never supplied by the public GitHub source/);

for (const channel of ['stable', 'beta']) {
  const release = manifest[channel];
  const filename = `moondog-${release.version}.json`;
  const update = JSON.parse(fs.readFileSync(path.join(root, 'updates/packages', filename), 'utf8'));
  assert.equal(release.migrationRequired, false);
  for (const file of update.approvedFiles) {
    assert.ok(file === 'index.html' || /^assets\/[^/]+\.(?:js|css)$/.test(file), `Unknown application path: ${file}`);
    assert.doesNotMatch(file, /(?:^|\/)(?:data|backups?|history|reports|imports|exports)(?:\/|$)/i);
  }
}

console.log('PASS public source uses protected local configuration and application-only packages');
