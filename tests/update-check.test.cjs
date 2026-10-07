const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "updates", "check.js"), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const check = context.MoonDogUpdateCheck.check;

const manifest = {
  stable: { version: "1.2.0", minimumCompatibleVersion: "1.0.0",
    migrationRequired: false, packageUrl: null, sha256: null, releaseNotes: "Stable test" },
  beta: { version: "1.3.0-beta.2", minimumCompatibleVersion: "1.2.0",
    migrationRequired: false, packageUrl: null, sha256: null, releaseNotes: "Beta test" }
};

function fetchManifest(value = manifest) {
  return async () => ({ ok: true, json: async () => value });
}

test("Stable is the default; Beta requires opt-in", async () => {
  const stable = await check({ currentVersion: "1.1.0", fetcher: fetchManifest() });
  assert.equal(stable.status, "newer-version");
  assert.equal(stable.channel, "stable");
  assert.equal(stable.version, "1.2.0");

  const beta = await check({ currentVersion: "1.2.0", channel: "beta", fetcher: fetchManifest() });
  assert.equal(beta.status, "newer-version");
  assert.equal(beta.channel, "beta");
  assert.equal(beta.version, "1.3.0-beta.2");

  const noBeta = await check({ currentVersion: "1.2.0", channel: "beta",
    fetcher: fetchManifest({ ...manifest, beta: { ...manifest.beta, version: "1.1.0-beta.1" } }) });
  assert.equal(noBeta.status, "up-to-date");
});

test("Compares versions and reports incompatibility without applying", async () => {
  const current = await check({ currentVersion: "1.2.0", fetcher: fetchManifest() });
  assert.equal(current.status, "up-to-date");

  const incompatible = await check({ currentVersion: "0.9.0", fetcher: fetchManifest() });
  assert.equal(incompatible.status, "incompatible");
  assert.equal(incompatible.minimumCompatibleVersion, "1.0.0");

  const incompatibleBeta = await check({ currentVersion: "1.1.0", channel: "beta",
    fetcher: fetchManifest() });
  assert.equal(incompatibleBeta.status, "incompatible");
  assert.equal(incompatibleBeta.minimumCompatibleVersion, "1.2.0");

  const prerelease = await check({ currentVersion: "1.3.0-beta.1", channel: "beta",
    fetcher: fetchManifest() });
  assert.equal(prerelease.status, "newer-version");
});

test("live Beta allows a direct update from the validated 0.10.9 layout", async () => {
  const activeManifest=JSON.parse(fs.readFileSync(path.join(__dirname, "..", "updates", "manifest.json"), "utf8"));
  assert.equal(activeManifest.beta.migrationRequired, false);
  const fromLocal=await check({currentVersion:"0.10.9",channel:"beta",manual:true,
    fetcher:fetchManifest(activeManifest)});
  assert.equal(fromLocal.status,"newer-version");
  assert.equal(fromLocal.version,activeManifest.beta.version);
  assert.equal(fromLocal.packageUrl,activeManifest.beta.packageUrl);

  const unsupported=await check({currentVersion:"0.10.8",channel:"beta",manual:true,
    fetcher:fetchManifest(activeManifest)});
  assert.equal(unsupported.status,"incompatible");
  assert.equal(unsupported.minimumCompatibleVersion,"0.10.9");
});

test("current Beta can select the verified Stable package as a channel downgrade", async () => {
  const ready = { ...manifest, stable: { ...manifest.stable, packageUrl: "https://example.test/stable.json", sha256: "a".repeat(64) } };
  const result = await check({ currentVersion: "1.3.0-beta.2", channel: "stable", fetcher: fetchManifest(ready) });
  assert.equal(result.status, "channel-switch");
  assert.equal(result.channel, "stable");
  assert.equal(result.version, "1.2.0");
  assert.equal(result.sha256, "a".repeat(64));
  assert.equal(result.packageUrl, "https://example.test/stable.json");
  assert.equal((await check({ currentVersion: "1.3.0-beta.1", channel: "stable",
    fetcher: fetchManifest(ready) })).status, "channel-switch");
  assert.equal((await check({ currentVersion: "1.3.0-beta.2", channel: "stable", fetcher: fetchManifest() })).status, "silent");
  assert.equal((await check({ currentVersion: "1.3.0-beta.2", channel: "stable", manual: true,
    fetcher: fetchManifest({ ...ready, beta: { ...ready.beta, migrationRequired: true } }) })).status, "unavailable");
});

test("a new-version offer carries the checked package identity", async () => {
  const ready = { ...manifest, beta: { ...manifest.beta,
    packageUrl: "https://example.test/beta.json", sha256: "b".repeat(64) } };
  const result = await check({ currentVersion: "1.2.0", channel: "beta", fetcher: fetchManifest(ready) });
  assert.equal(result.status, "newer-version");
  assert.equal(result.packageUrl, ready.beta.packageUrl);
  assert.equal(result.sha256, ready.beta.sha256);
});

test("Uses only the fixed public manifest URL and sends no credentials", async () => {
  let calls = 0;
  const fetcher = async (url, options) => {
    calls += 1;
    assert.equal(url, "https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/updates/manifest.json");
    assert.equal(options.credentials, "omit");
    assert.equal(options.referrerPolicy, "no-referrer");
    assert.equal(options.cache, "no-store");
    return { ok: true, json: async () => manifest };
  };
  await check({ currentVersion: "1.0.0", fetcher });
  assert.equal(calls, 1);
});

test("Automatic failures are silent; manual failures are visible", async () => {
  const offline = async () => { throw new Error("offline"); };
  const automatic = await check({ currentVersion: "1.0.0", fetcher: offline });
  const manual = await check({ currentVersion: "1.0.0", manual: true, fetcher: offline });
  assert.equal(automatic.status, "silent");
  assert.equal(manual.status, "unavailable");

  const invalid = await check({ currentVersion: "bad", manual: true, fetcher: offline });
  assert.equal(invalid.status, "invalid-input");
});
