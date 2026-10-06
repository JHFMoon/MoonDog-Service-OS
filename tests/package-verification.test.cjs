const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash, webcrypto } = require("node:crypto");

const source = fs.readFileSync(path.join(__dirname, "..", "updates", "verify.js"), "utf8");
const context = vm.createContext({ URL });
vm.runInContext(source, context);
const verify = context.MoonDogPackageVerification.verify;
const manifestUrl = "https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/updates/manifest.json";
const packageUrl = "https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/updates/packages/example.bundle";
const payload = Buffer.from("synthetic package bytes");
const sha256 = createHash("sha256").update(payload).digest("hex");
const metadata = {
  stable: { version: "1.0.0", minimumCompatibleVersion: "0.9.0",
    migrationRequired: false, packageUrl, sha256, releaseNotes: "Synthetic Stable package" },
  beta: { version: "1.1.0-beta.1", minimumCompatibleVersion: "1.0.0",
    migrationRequired: false, packageUrl, sha256, releaseNotes: "Synthetic Beta package" }
};

function packageResponse(bytes = payload, declaredLength = bytes.length) {
  return {
    ok: true,
    headers: { get: (name) => name === "content-length" ? String(declaredLength) : null },
    body: new ReadableStream({
      start(controller) { controller.enqueue(bytes); controller.close(); }
    })
  };
}

function fetcherFor(manifest, response = packageResponse()) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url === manifestUrl) return { ok: true, json: async () => manifest };
    if (url === packageUrl) return response;
    throw new Error("Unexpected URL");
  };
  return { fetcher, calls };
}

test("Current manifest verifies independent Stable and Beta packages in memory", async () => {
  const current = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "updates", "manifest.json"), "utf8"));
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "updates", "manifest.schema.json"), "utf8"));
  assert.deepEqual(Object.keys(current).sort(), contract.required.slice().sort());
  const betaBytes = fs.readFileSync(path.join(__dirname, "..", "updates", "packages", "moondog-0.10.7-beta.1.json"));
  const stableBytes = fs.readFileSync(path.join(__dirname, "..", "updates", "packages", "moondog-0.10.6.json"));
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url === manifestUrl) return { ok: true, json: async () => current };
    if (url === current.beta.packageUrl) return packageResponse(betaBytes);
    if (url === current.stable.packageUrl) return packageResponse(stableBytes);
    throw new Error("Unexpected URL");
  };
  const stable = await verify({ fetcher, subtle: webcrypto.subtle });
  assert.equal(stable.status, "verified");
  assert.equal(stable.version, "0.10.6");
  assert.deepEqual(Buffer.from(stable.bytes), stableBytes);
  const result = await verify({ channel: "beta", fetcher, subtle: webcrypto.subtle });
  assert.equal(result.status, "verified");
  assert.equal(result.version, current.beta.version);
  assert.equal(result.sha256, current.beta.sha256);
  assert.deepEqual(Buffer.from(result.bytes), betaBytes);
  assert.deepEqual(calls.map(call => call.url), [manifestUrl, current.stable.packageUrl, manifestUrl, current.beta.packageUrl]);
});

test("Matching SHA-256 returns only verified in-memory bytes", async () => {
  const { fetcher, calls } = fetcherFor(metadata);
  const result = await verify({ fetcher, subtle: webcrypto.subtle });
  assert.equal(result.status, "verified");
  assert.equal(result.sha256, sha256);
  assert.deepEqual(Buffer.from(result.bytes), payload);
  assert.equal(result.version, "1.0.0");
  assert.deepEqual(calls.map(call => call.url), [manifestUrl, packageUrl]);
  for (const call of calls) {
    assert.equal(call.options.credentials, "omit");
    assert.equal(call.options.referrerPolicy, "no-referrer");
    assert.equal(call.options.cache, "no-store");
  }
});

test("Beta package metadata identifies the beta version", async () => {
  const { fetcher } = fetcherFor(metadata);
  const result = await verify({ channel: "beta", fetcher, subtle: webcrypto.subtle });
  assert.equal(result.status, "verified");
  assert.equal(result.channel, "beta");
  assert.equal(result.version, "1.1.0-beta.1");
});

test("Hash mismatch rejects bytes", async () => {
  const { fetcher } = fetcherFor({ ...metadata, stable: { ...metadata.stable, sha256: "0".repeat(64) } });
  const result = await verify({ fetcher, subtle: webcrypto.subtle });
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "hash-mismatch");
  assert.equal(result.bytes, undefined);
});

test("Invalid source or hash is rejected before package fetch", async () => {
  for (const changed of [
    { packageUrl: "https://example.com/package.bundle" },
    { packageUrl: "http://github.com/JHFMoon/MoonDog-Service-OS/releases/download/test/a" },
    { sha256: "not-a-hash" },
    { sha256: null }
  ]) {
    const { fetcher, calls } = fetcherFor({ ...metadata, stable: { ...metadata.stable, ...changed } });
    const result = await verify({ fetcher, subtle: webcrypto.subtle });
    assert.equal(result.status, "rejected");
    assert.equal(result.reason, "invalid-metadata");
    assert.equal(calls.length, 1);
  }
});

test("Oversized package and network errors fail closed", async () => {
  const tooLarge = fetcherFor(metadata, packageResponse(payload, 64 * 1024 * 1024 + 1));
  const sizeResult = await verify({ fetcher: tooLarge.fetcher, subtle: webcrypto.subtle });
  assert.equal(sizeResult.status, "rejected");
  assert.equal(sizeResult.reason, "package-too-large");
  assert.equal(sizeResult.bytes, undefined);

  const offline = await verify({ fetcher: async () => { throw new Error("offline"); }, subtle: webcrypto.subtle });
  assert.equal(offline.status, "unavailable");
});
