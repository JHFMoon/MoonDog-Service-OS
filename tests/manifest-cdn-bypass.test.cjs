"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash, webcrypto } = require("node:crypto");

test("Live browser package verification refreshes manifest cache key but not immutable package URL", async () => {
  const payload = Buffer.from("Local synthetic Beta verification bytes");
  const packageUrl = "https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/updates/packages/example.json";
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const manifest = {
    beta: { version: "0.10.18-beta.50", minimumCompatibleVersion: "0.10.9",
      migrationRequired: false, packageUrl, sha256 }
  };
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(url);
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "omit");
    assert.equal(options.referrerPolicy, "no-referrer");
    if (url.includes("/main/updates/manifest.json?check="))
      return { ok: true, json: async () => manifest };
    assert.equal(url, packageUrl, "Verified package download keeps the unchanged trusted URL");
    let sent = false;
    return { ok: true, headers: { get: () => String(payload.length) },
      body: { getReader: () => ({
        read: async () => sent ? { done: true } :
          (sent = true, { done: false, value: payload })
      }) } };
  };
  const context = vm.createContext({ URL, fetch: fetcher, crypto: webcrypto });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "updates", "verify.js"), "utf8"), context);
  const result = await context.MoonDogPackageVerification.verify({ channel: "beta" });
  assert.equal(result.status, "verified");
  assert.equal(result.version, manifest.beta.version);
  assert.equal(result.sha256, sha256);
  assert.equal(calls.length, 2);
  const parsed = new URL(calls[0]);
  assert.equal(parsed.pathname, "/JHFMoon/MoonDog-Service-OS/main/updates/manifest.json");
  assert.equal(parsed.searchParams.size, 1);
  assert.ok(Number(parsed.searchParams.get("check")) > 0);
  assert.equal(calls[1], packageUrl);
});
