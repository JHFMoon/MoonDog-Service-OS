const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');

test('local installer restricts active content and preserves the official ZIP authority', () => {
 const site = join(__dirname, '../distribution/site');
 const html = readFileSync(join(site, 'local-install.html'), 'utf8');
 const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
 assert.ok(policy, 'a document policy must be present');
 assert.ok(html.indexOf(policy) < html.indexOf('<style>'));
 const directives = Object.fromEntries(policy.split(';').map(value => value.trim().split(/\s+/))
  .map(([name, ...sources]) => [name, sources]));
 for (const name of ['default-src', 'base-uri', 'object-src', 'form-action']) {
  assert.deepEqual(directives[name], ["'none'"]);
 }
 for (const name of ['script-src', 'connect-src']) {
  assert.deepEqual(directives[name], ["'self'"]);
 }
 assert.deepEqual(html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g), [
  '<script src="./fresh-install-writer.js"></script>',
  '<script type="module" src="./local-install.mjs"></script>'
 ]);
 const module = readFileSync(join(site, 'local-install.mjs'), 'utf8');
 assert.ok(module.includes("from './web-preview/modules/verified_site_package.mjs'"));
 assert.ok(module.includes("'https://github.com/JHFMoon/MoonDog-Service-OS/releases/latest/download/Service-Operations-Dashboard.zip'"));
});
