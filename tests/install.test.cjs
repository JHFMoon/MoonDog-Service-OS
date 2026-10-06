const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash, webcrypto } = require("node:crypto");

const context = vm.createContext({ TextDecoder, TextEncoder, atob, crypto: webcrypto, Uint8Array });
for (const name of ["package-plan", "apply-design-model", "install"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "updates", name + ".js"), "utf8"), context);
}
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const notFound = () => Object.assign(new Error("missing"), { name: "NotFoundError" });

function folder(name, files = {}) {
  const store = { dirs: new Set(["", "assets"]), files: new Map(Object.entries(files).map(([key, value]) =>
    [key, Buffer.from(value)])), failOnce: null, writes: [] };
  const handle = prefix => ({
    name: prefix.split("/").filter(Boolean).at(-1) || name,
    resolve: async other => other._store === store ? [] : null,
    _store: store,
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
    getDirectoryHandle: async (part, options = {}) => {
      const key = prefix + part;
      if (!store.dirs.has(key)) {
        if (!options.create) throw notFound();
        store.dirs.add(key);
      }
      return handle(key + "/");
    },
    getFileHandle: async (part, options = {}) => {
      const key = prefix + part;
      if (!store.files.has(key) && !options.create) throw notFound();
      return {
        getFile: async () => {
          const value = store.files.get(key);
          if (!value) throw notFound();
          return { arrayBuffer: async () => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
            size: value.length };
        },
        createWritable: async () => {
          let data;
          return { write: async bytes => { data = Buffer.from(bytes); },
            close: async () => {
              if (store.failOnce === key) { store.failOnce = null; throw new Error("forced write failure"); }
              store.files.set(key, data); store.writes.push(key);
            }, abort: async () => {} };
        }
      };
    },
    removeEntry: async part => {
      const key = prefix + part;
      if (!store.files.delete(key)) throw notFound();
      store.writes.push(key);
    }
  });
  return { root: handle(""), store };
}

async function fixture() {
  const app = folder("MoonDog-Test", { "index.html": "old", "assets/old.js": "retired",
    "data/current-state.json": "synthetic private state" });
  const backups = folder("External-Backups");
  const files = [
    { path: "index.html", action: "put", sha256: hash(Buffer.from("new")), contentBase64: Buffer.from("new").toString("base64") },
    { path: "assets/new.js", action: "put", sha256: hash(Buffer.from("added")), contentBase64: Buffer.from("added").toString("base64") },
    { path: "assets/old.js", action: "delete", sha256: hash(Buffer.from("retired")) }
  ];
  const verifiedPackage = { status: "verified", version: "1.1.0",
    bytes: Buffer.from(JSON.stringify({ formatVersion: 1, version: "1.1.0",
      approvedFiles: files.map(file => file.path), files })) };
  verifiedPackage.sha256 = hash(verifiedPackage.bytes);
  const trustedAllowlist = ["index.html", "assets/new.js", "assets/old.js"];
  const expectedPlan = await context.MoonDogPackagePlan.dryRun({ verifiedPackage,
    appDirectoryHandle: app.root, trustedAllowlist, subtle: webcrypto.subtle });
  assert.equal(expectedPlan.rejected.length, 0);
  return { app, backups, verifiedPackage, trustedAllowlist, expectedPlan };
}

test("confirmation and separate backup folder are required before application writes", async () => {
  const setup = await fixture();
  const options = { verifiedPackage: setup.verifiedPackage, appDirectoryHandle: setup.app.root,
    backupDirectoryHandle: setup.backups.root, trustedAllowlist: setup.trustedAllowlist,
    expectedPlan: setup.expectedPlan };
  assert.equal((await context.MoonDogUpdateInstall.apply(options)).status, "confirmation-required");
  assert.deepEqual(setup.app.store.writes, []);
  const sameFolder = await context.MoonDogUpdateInstall.apply({ ...options,
    backupDirectoryHandle: setup.app.root, confirmed: true });
  assert.equal(sameFolder.status, "stopped");
  assert.deepEqual(setup.app.store.writes, []);
});

test("verified backup precedes approved writes; protected state survives successful install", async () => {
  const setup = await fixture();
  const result = await context.MoonDogUpdateInstall.apply({ verifiedPackage: setup.verifiedPackage,
    appDirectoryHandle: setup.app.root, backupDirectoryHandle: setup.backups.root,
    trustedAllowlist: setup.trustedAllowlist, expectedPlan: setup.expectedPlan, confirmed: true });
  assert.equal(result.status, "installed");
  assert.equal(setup.app.store.files.get("index.html").toString(), "new");
  assert.equal(setup.app.store.files.get("assets/new.js").toString(), "added");
  assert.equal(setup.app.store.files.has("assets/old.js"), false);
  assert.equal(setup.app.store.files.get("data/current-state.json").toString(), "synthetic private state");
  assert.ok(setup.backups.store.writes.includes(result.backupName + "/journal.json"));
  assert.equal(setup.backups.store.files.get(result.backupName + "/index.html").toString(), "old");
});

test("forced write failure restores exact pre-update files and absence", async () => {
  const setup = await fixture();
  setup.app.store.failOnce = "assets/new.js";
  const result = await context.MoonDogUpdateInstall.apply({ verifiedPackage: setup.verifiedPackage,
    appDirectoryHandle: setup.app.root, backupDirectoryHandle: setup.backups.root,
    trustedAllowlist: setup.trustedAllowlist, expectedPlan: setup.expectedPlan, confirmed: true });
  assert.equal(result.status, "rolled-back");
  assert.equal(setup.app.store.files.get("index.html").toString(), "old");
  assert.equal(setup.app.store.files.get("assets/old.js").toString(), "retired");
  assert.equal(setup.app.store.files.has("assets/new.js"), false);
  assert.equal(setup.app.store.files.get("data/current-state.json").toString(), "synthetic private state");
});

test("protected and unknown package files reject before backup or application writes", async () => {
  const setup = await fixture();
  const malicious = { formatVersion: 1, version: "1.1.0", approvedFiles: ["data/current-state.json"],
    files: [{ path: "data/current-state.json", action: "delete", sha256: hash(Buffer.from("synthetic private state")) }] };
  const result = await context.MoonDogUpdateInstall.apply({ verifiedPackage: { status: "verified", version: "1.1.0",
    bytes: Buffer.from(JSON.stringify(malicious)), sha256: hash(Buffer.from(JSON.stringify(malicious))) }, appDirectoryHandle: setup.app.root,
    backupDirectoryHandle: setup.backups.root, trustedAllowlist: setup.trustedAllowlist,
    expectedPlan: setup.expectedPlan, confirmed: true });
  assert.equal(result.status, "rejected");
  assert.deepEqual(setup.app.store.writes, []);
  assert.deepEqual(setup.backups.store.writes, []);
});

test("an interrupted update can be restored from its verified backup journal", async () => {
  const setup = await fixture();
  const result = await context.MoonDogUpdateInstall.apply({ verifiedPackage: setup.verifiedPackage,
    appDirectoryHandle: setup.app.root, backupDirectoryHandle: setup.backups.root,
    trustedAllowlist: setup.trustedAllowlist, expectedPlan: setup.expectedPlan, confirmed: true });
  assert.equal(result.status, "installed");
  const backup = await setup.backups.root.getDirectoryHandle(result.backupName, { create: false });
  const journalPath = result.backupName + "/journal.json";
  const record = JSON.parse(setup.backups.store.files.get(journalPath).toString());
  record.status = "applying";
  setup.backups.store.files.set(journalPath, Buffer.from(JSON.stringify(record)));
  const recovery = await context.MoonDogUpdateInstall.recover({ appDirectoryHandle: setup.app.root,
    backupDirectoryHandle: backup, trustedAllowlist: setup.trustedAllowlist, confirmed: true });
  assert.equal(recovery.status, "restored");
  assert.equal(setup.app.store.files.get("index.html").toString(), "old");
  assert.equal(setup.app.store.files.get("assets/old.js").toString(), "retired");
  assert.equal(setup.app.store.files.has("assets/new.js"), false);
  assert.equal(setup.app.store.files.get("data/current-state.json").toString(), "synthetic private state");
});

test("published Beta package changes only the approved CSS and rolls back on failure", async () => {
  const packageBytes = fs.readFileSync(path.join(__dirname, "..", "updates", "packages", "moondog-0.10.7-beta.1.json"));
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "updates", "manifest.json"), "utf8"));
  const content = JSON.parse(packageBytes);
  const marker = Buffer.from("\n/* MoonDog controlled Beta update test 0.10.7-beta.1; no style changes. */\n");
  const updated = Buffer.from(content.files[0].contentBase64, "base64");
  assert.equal(hash(packageBytes), manifest.beta.sha256);
  assert.equal(hash(updated), content.files[0].sha256);
  assert.deepEqual(updated.subarray(-marker.length), marker);
  const original = updated.subarray(0, -marker.length);
  const trustedAllowlist = ["assets/product-settings.css"];
  const verifiedPackage = { status: "verified", version: manifest.beta.version,
    sha256: manifest.beta.sha256, bytes: packageBytes, migrationRequired: false };
  for (const fail of [false, true]) {
    const app = folder("MoonDog-Test", { "assets/product-settings.css": original,
      "data/current-state.json": "synthetic private state" });
    const backups = folder("External-Backups");
    const expectedPlan = await context.MoonDogPackagePlan.dryRun({ verifiedPackage,
      appDirectoryHandle: app.root, trustedAllowlist, subtle: webcrypto.subtle });
    assert.deepEqual(Array.from(expectedPlan.replace), trustedAllowlist);
    assert.equal(expectedPlan.rejected.length, 0);
    if (fail) app.store.failOnce = "assets/product-settings.css";
    const result = await context.MoonDogUpdateInstall.apply({ verifiedPackage,
      appDirectoryHandle: app.root, backupDirectoryHandle: backups.root,
      trustedAllowlist, expectedPlan, confirmed: true });
    assert.equal(result.status, fail ? "rolled-back" : "installed");
    assert.deepEqual(app.store.files.get("assets/product-settings.css"), fail ? original : updated);
    assert.equal(app.store.files.get("data/current-state.json").toString(), "synthetic private state");
    assert.deepEqual(backups.store.files.get(result.backupName + "/assets/product-settings.css"), original);
  }
});
