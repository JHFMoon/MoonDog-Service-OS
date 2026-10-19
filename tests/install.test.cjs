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
const appHtml = title => '<!doctype html><html lang="en"><head><title>' + title + '</title></head><body>' + title + '</body></html>';
const compatibility = html => html.replace("<head>", '<head><base href="System Files/">');

function folder(name, files = {}, directories = []) {
  const store = { dirs: new Set(["", ...directories]), files: new Map(Object.entries(files).map(([key, value]) =>
    [key, Buffer.from(value)])), failOnce: null, failReadOnce: null, writes: [], readDelayMs: 0, activeReads: 0, peakReads: 0 };
  const handle = prefix => ({
    name: prefix.split("/").filter(Boolean).at(-1) || name,
    kind: "directory",
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
          if (store.failReadOnce === key) {
            store.failReadOnce = null;
            throw Object.assign(new Error("synthetic OneDrive read conflict"), { name: "NotReadableError" });
          }
          const value = store.files.get(key);
          if (!value) throw notFound();
          if (store.readDelayMs) {
            store.activeReads++;
            store.peakReads = Math.max(store.peakReads, store.activeReads);
            try { await new Promise(resolve => setTimeout(resolve, store.readDelayMs)); }
            finally { store.activeReads--; }
          }
          return { arrayBuffer: async () => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength), size: value.length };
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
    entries: async function* () {
      for (const key of store.dirs) {
        if (key.startsWith(prefix) && key !== prefix && !key.slice(prefix.length).includes("/")) {
          yield [key.slice(prefix.length), handle(key + "/")];
        }
      }
    },
    removeEntry: async part => {
      const key = prefix + part;
      if (!store.files.delete(key)) throw notFound();
      store.writes.push(key);
    }
  });
  return { root: handle(""), handle, store };
}

async function fixture() {
  const oldHtml = appHtml("old"), newHtml = appHtml("new");
  const workspace = folder("Dashboard Interface", {
    "index.html": compatibility(oldHtml),
    "System Files/index.html": oldHtml,
    "System Files/assets/old.js": "retired",
    "System Files/Workspace/data/current-state.json": "synthetic private state"
  }, ["System Files", "System Files/assets", "System Files/Workspace", "System Files/Workspace/data",
      "System Files/Workspace/backups", "System Files/Workspace/backups/system-updates"]);
  const app = await workspace.root.getDirectoryHandle("System Files", { create: false });
  const files = [
    { path: "index.html", action: "put", sha256: hash(Buffer.from(newHtml)), contentBase64: Buffer.from(newHtml).toString("base64") },
    { path: "assets/new.js", action: "put", sha256: hash(Buffer.from("added")), contentBase64: Buffer.from("added").toString("base64") },
    { path: "assets/old.js", action: "delete", sha256: hash(Buffer.from("retired")) }
  ];
  const bytes = Buffer.from(JSON.stringify({ formatVersion: 1, version: "1.1.0",
    approvedFiles: files.map(file => file.path), files }));
  const verifiedPackage = { status: "verified", version: "1.1.0", channel: "beta",
    migrationRequired: false,
    bytes, sha256: hash(bytes) };
  const trustedAllowlist = ["index.html", "assets/new.js", "assets/old.js"];
  const expectedPlan = await context.MoonDogPackagePlan.dryRun({ verifiedPackage,
    appDirectoryHandle: app, trustedAllowlist, subtle: webcrypto.subtle });
  assert.equal(expectedPlan.rejected.length, 0);
  return { workspace, app, verifiedPackage, trustedAllowlist, expectedPlan, oldHtml, newHtml };
}
const apply = (setup, extra = {}) => context.MoonDogUpdateInstall.apply({
  verifiedPackage: setup.verifiedPackage, appDirectoryHandle: setup.app,
  workspaceDirectoryHandle: setup.workspace.root, trustedAllowlist: setup.trustedAllowlist,
  expectedPlan: setup.expectedPlan, confirmed: true, ...extra
});

test("confirmation is required before backup creation or application writes", async () => {
  const setup = await fixture();
  const result = await context.MoonDogUpdateInstall.apply({ verifiedPackage: setup.verifiedPackage,
    appDirectoryHandle: setup.app, workspaceDirectoryHandle: setup.workspace.root,
    trustedAllowlist: setup.trustedAllowlist, expectedPlan: setup.expectedPlan });
  assert.equal(result.status, "confirmation-required");
  assert.deepEqual(setup.workspace.store.writes, []);
});

test("verified workspace backup precedes approved writes and preserves protected state", async () => {
  const setup = await fixture();
  setup.workspace.store.files.set("System Files/Workspace/backups/full.zip", Buffer.from("existing full backup"));
  const result = await apply(setup);
  assert.equal(result.status, "installed");
  assert.equal(setup.workspace.store.files.get("System Files/index.html").toString(), setup.newHtml);
  assert.equal(setup.workspace.store.files.get("index.html").toString(), compatibility(setup.newHtml));
  assert.equal(setup.workspace.store.files.get("System Files/assets/new.js").toString(), "added");
  assert.equal(setup.workspace.store.files.has("System Files/assets/old.js"), false);
  assert.equal(setup.workspace.store.files.get("System Files/Workspace/data/current-state.json").toString(), "synthetic private state");
  const base = "System Files/Workspace/backups/system-updates/" + result.backupName + "/";
  assert.ok(setup.workspace.store.writes.includes(base + "journal.json"));
  const journal = JSON.parse(setup.workspace.store.files.get(base + "journal.json").toString());
  assert.deepEqual(journal.verifiedUpdate, {
    version: "1.1.0", channel: "beta", sha256: setup.verifiedPackage.sha256,
    verifiedAt: journal.verifiedUpdate.verifiedAt
  });
  assert.ok(Number.isFinite(Date.parse(journal.verifiedUpdate.verifiedAt)));
  assert.equal(setup.workspace.store.files.get(base + "index.html").toString(), setup.oldHtml);
  assert.equal(setup.workspace.store.files.get(base + "origin-compatibility/index.html").toString(), compatibility(setup.oldHtml));
});

test("removed operational editing designation does not block verified application-only updates", async () => {
  const setup = await fixture();
  context.MoonDogWriteAuthority = { canWrite: false, validate: async () => false };
  let result;
  try { result = await apply(setup); }
  finally { delete context.MoonDogWriteAuthority; }
  assert.equal(result.status, "installed");
  assert.equal(setup.workspace.store.files.get("System Files/index.html").toString(), setup.newHtml);
  assert.equal(setup.workspace.store.files.get("System Files/Workspace/data/current-state.json").toString(), "synthetic private state");
});

test("denied browser folder write permission stops before mutating application or Workspace", async () => {
  const setup = await fixture();
  setup.app.queryPermission = async () => "denied";
  setup.app.requestPermission = async () => "denied";
  const result = await apply(setup);
  assert.notEqual(result.status, "installed");
  assert.match(String(result.reason || ""), /permission|approved file preview|rejected/i);
  assert.equal(setup.workspace.store.files.get("System Files/index.html").toString(), setup.oldHtml);
  assert.equal(setup.workspace.store.files.get("System Files/Workspace/data/current-state.json").toString(), "synthetic private state");
  assert.deepEqual(setup.workspace.store.writes, []);
});

test("a package targeting protected or unknown paths is rejected", async () => {
  const setup = await fixture();
  for (const target of ["backups/system-updates/journal.json", "Workspace/data/current-state.json", "../index.html"]) {
    const file = { path: target, action: "put", sha256: hash(Buffer.from("bad")),
      contentBase64: Buffer.from("bad").toString("base64") };
    const bytes = Buffer.from(JSON.stringify({ formatVersion: 1, version: "1.1.0", approvedFiles: [target], files: [file] }));
    const result = await context.MoonDogUpdateInstall.apply({ verifiedPackage: {
      status: "verified", version: "1.1.0", migrationRequired: false, bytes, sha256: hash(bytes) },
      appDirectoryHandle: setup.app, workspaceDirectoryHandle: setup.workspace.root,
      trustedAllowlist: setup.trustedAllowlist, expectedPlan: setup.expectedPlan, confirmed: true });
    assert.equal(result.status, "rejected", target);
  }
});

test("forced write failure restores app and root compatibility bytes exactly", async () => {
  const setup = await fixture();
  setup.workspace.store.failOnce = "System Files/assets/new.js";
  const result = await apply(setup);
  assert.equal(result.status, "rolled-back");
  assert.equal(setup.workspace.store.files.get("System Files/index.html").toString(), setup.oldHtml);
  assert.equal(setup.workspace.store.files.get("index.html").toString(), compatibility(setup.oldHtml));
  assert.equal(setup.workspace.store.files.get("System Files/assets/old.js").toString(), "retired");
  assert.equal(setup.workspace.store.files.has("System Files/assets/new.js"), false);
  assert.equal(setup.workspace.store.files.get("System Files/Workspace/data/current-state.json").toString(), "synthetic private state");
});

test("an interrupted update can be restored from its verified workspace journal", async () => {
  const setup = await fixture();
  const result = await apply(setup);
  assert.equal(result.status, "installed");
  const journalPath = "System Files/Workspace/backups/system-updates/" + result.backupName + "/journal.json";
  const record = JSON.parse(setup.workspace.store.files.get(journalPath).toString());
  record.status = "applying";
  setup.workspace.store.files.set(journalPath, Buffer.from(JSON.stringify(record)));
  assert.deepEqual(Array.from(await context.MoonDogUpdateInstall.listBackups(setup.workspace.root)), [result.backupName]);
  const recovery = await context.MoonDogUpdateInstall.recover({ appDirectoryHandle: setup.app,
    workspaceDirectoryHandle: setup.workspace.root, backupName: result.backupName,
    trustedAllowlist: setup.trustedAllowlist, confirmed: true });
  assert.equal(recovery.status, "restored");
  assert.equal(setup.workspace.store.files.get("System Files/index.html").toString(), setup.oldHtml);
  assert.equal(setup.workspace.store.files.get("index.html").toString(), compatibility(setup.oldHtml));
  assert.equal(setup.workspace.store.files.get("System Files/assets/old.js").toString(), "retired");
});

test("Stable to Beta to Stable uses workspace backups and preserves protected data", async () => {
  const updates = path.join(__dirname, "..", "updates");
  const manifest = JSON.parse(fs.readFileSync(path.join(updates, "manifest.json"), "utf8"));
  const packages = Object.fromEntries(["stable", "beta"].map(channel => {
    const bytes = fs.readFileSync(path.join(updates, "packages", "moondog-" + manifest[channel].version + ".json"));
    assert.equal(hash(bytes), manifest[channel].sha256);
    return [channel, { status: "verified", channel, version: manifest[channel].version,
      sha256: manifest[channel].sha256, migrationRequired: false, bytes }];
  }));
  const decoded = value => Object.fromEntries(JSON.parse(value.bytes).files.filter(entry => entry.action === "put").map(entry =>
    [entry.path, Buffer.from(entry.contentBase64, "base64")]));
  const stableFiles = decoded(packages.stable), betaFiles = decoded(packages.beta);
  const initial = {};
  for (const [file, bytes] of Object.entries(stableFiles)) initial["System Files/" + file] = bytes;
  initial["index.html"] = compatibility(stableFiles["index.html"].toString());
  initial["System Files/Workspace/data/current-state.json"] = "synthetic private state";
  const dirs = ["System Files", "System Files/assets", "System Files/Workspace", "System Files/Workspace/data",
    "System Files/Workspace/backups", "System Files/Workspace/backups/system-updates"];
  const workspace = folder("Dashboard Interface", initial, dirs);
  const app = await workspace.root.getDirectoryHandle("System Files", { create: false });
  const allowlist = Object.keys(stableFiles);
  async function install(channel) {
    const verifiedPackage = packages[channel];
    const expectedPlan = await context.MoonDogPackagePlan.dryRun({ verifiedPackage,
      appDirectoryHandle: app, trustedAllowlist: allowlist, subtle: webcrypto.subtle });
    assert.equal(expectedPlan.rejected.length, 0);
    return context.MoonDogUpdateInstall.apply({ verifiedPackage, appDirectoryHandle: app,
      workspaceDirectoryHandle: workspace.root, trustedAllowlist: allowlist, expectedPlan, confirmed: true });
  }
  assert.equal((await install("beta")).status, "installed");
  for (const [file, bytes] of Object.entries(betaFiles)) assert.deepEqual(workspace.store.files.get("System Files/" + file), bytes);
  const returned = await install("stable");
  assert.equal(returned.status, "installed");
  assert.equal(returned.version, manifest.stable.version);
  for (const [file, bytes] of Object.entries(stableFiles)) assert.deepEqual(workspace.store.files.get("System Files/" + file), bytes);
  assert.equal(workspace.store.files.get("index.html").toString(), compatibility(stableFiles["index.html"].toString()));
  assert.equal(workspace.store.files.get("System Files/Workspace/data/current-state.json").toString(), "synthetic private state");
});

test("install progress reaches verified completion", async () => {
  const setup = await fixture(), events = [];
  const result = await apply(setup, { onProgress: async event => { events.push({ ...event }); } });
  assert.equal(result.status, "installed");
  for (const phase of ["verify-package", "permission", "plan", "inventory", "backup",
    "backup-verify", "apply", "verify-install", "complete"]) {
    assert.ok(events.some(event => event.phase === phase), "missing progress phase " + phase);
  }
  assert.equal(events.at(-1).phase, "complete");
  assert.equal(events.at(-1).percent, 100);
});

test("failed install reports rollback progress and restores exact files", async () => {
  const setup = await fixture(), events = [];
  setup.workspace.store.failOnce = "System Files/assets/new.js";
  const result = await apply(setup, { onProgress: event => events.push({ ...event }) });
  assert.equal(result.status, "rolled-back");
  assert.ok(events.some(event => event.phase === "rollback"));
  assert.equal(events.at(-1).phase, "rolled-back");
  assert.equal(setup.workspace.store.files.get("System Files/index.html").toString(), setup.oldHtml);
  assert.equal(setup.workspace.store.files.get("index.html").toString(), compatibility(setup.oldHtml));
});

test("tampered recovery backup is rejected without overwriting installed or protected bytes", async () => {
  const setup = await fixture();
  const completed = await apply(setup);
  assert.equal(completed.status, "installed");
  const prefix = "System Files/Workspace/backups/system-updates/" + completed.backupName + "/";
  const journalPath = prefix + "journal.json";
  const saved = JSON.parse(setup.workspace.store.files.get(journalPath).toString());
  saved.status = "applying"; // Simulate interruption after the application files were installed.
  setup.workspace.store.files.set(journalPath, Buffer.from(JSON.stringify(saved)));
  setup.workspace.store.files.set(prefix + "assets/old.js", Buffer.from("altered synthetic backup"));

  const result = await context.MoonDogUpdateInstall.recover({
    appDirectoryHandle: setup.app, workspaceDirectoryHandle: setup.workspace.root,
    backupName: completed.backupName, trustedAllowlist: setup.trustedAllowlist, confirmed: true
  });
  assert.equal(result.status, "recovery-required");
  assert.match(result.reason, /Backup verification failed/);
  assert.equal(setup.workspace.store.files.get("System Files/index.html").toString(), setup.newHtml);
  assert.equal(setup.workspace.store.files.get("index.html").toString(), compatibility(setup.newHtml));
  assert.equal(setup.workspace.store.files.get("System Files/assets/new.js").toString(), "added");
  assert.equal(setup.workspace.store.files.has("System Files/assets/old.js"), false);
  assert.equal(setup.workspace.store.files.get("System Files/Workspace/data/current-state.json").toString(), "synthetic private state");
  assert.equal(JSON.parse(setup.workspace.store.files.get(journalPath)).status, "applying",
    "incomplete recovery journal remains available for investigation");
});

test("large recovery inventory reads bounded batches without modifying protected backups", async () => {
  const setup = await fixture();
  const base = "System Files/Workspace/backups/system-updates/";
  const expected = [];
  for (let i = 0; i < 70; i++) {
    const name = "MoonDog-Update-Backup-20261018-" + String(i).padStart(3, "0");
    setup.workspace.store.dirs.add(base + name);
    const status = i % 3 === 0 ? "applying" : i % 3 === 1 ? "prepared" : "restored";
    if (i !== 11) {
      setup.workspace.store.files.set(base + name + "/journal.json",
        Buffer.from(i === 25 ? "{invalid json" : JSON.stringify({ status })));
    }
    if (status !== "restored" && i !== 11 && i !== 25) expected.push(name);
  }
  setup.workspace.store.dirs.add(base + "Unrelated-Backup-20261018");
  const originalDirs = setup.workspace.store.dirs.size;
  const originalFiles = setup.workspace.store.files.size;
  setup.workspace.store.readDelayMs = 2;
  const result = await context.MoonDogUpdateInstall.listBackups(setup.workspace.root);
  assert.deepEqual(Array.from(result), expected.sort().reverse());
  assert.ok(setup.workspace.store.peakReads >= 2, "must avoid sequential OneDrive journal reads");
  assert.ok(setup.workspace.store.peakReads <= 6, "must bound simultaneous journal reads");
  assert.equal(setup.workspace.store.activeReads, 0);
  assert.equal(setup.workspace.store.dirs.size, originalDirs, "listing never deletes backup folders");
  assert.equal(setup.workspace.store.files.size, originalFiles, "listing never deletes journal bytes");
  assert.deepEqual(setup.workspace.store.writes, [], "listing must never mutate Workspace");
});

test("recovery inventory surfaces transient OneDrive read failures instead of hiding unfinished backups", async () => {
  const setup = await fixture();
  const dir = "System Files/Workspace/backups/system-updates/";
  const name = "MoonDog-Update-Backup-20261018-synthetic-lock";
  const validName = "MoonDog-Update-Backup-20261018-known-incomplete";
  const journal = dir + name + "/journal.json";
  setup.workspace.store.dirs.add(dir + name);
  setup.workspace.store.dirs.add(dir + validName);
  setup.workspace.store.files.set(journal, Buffer.from(JSON.stringify({ status: "applying" })));
  setup.workspace.store.files.set(dir + validName + "/journal.json",
    Buffer.from(JSON.stringify({ status: "prepared" })));
  setup.workspace.store.failReadOnce = journal;

  await assert.rejects(
    context.MoonDogUpdateInstall.listBackups(setup.workspace.root),
    error => error?.name === "NotReadableError",
    "a temporary OneDrive conflict must be reported rather than interpreted as no recovery needed"
  );
  assert.deepEqual(
    Array.from(await context.MoonDogUpdateInstall.listBackups(setup.workspace.root)),
    [name, validName].sort().reverse(), "a retry finds every incomplete backup without hidden entries"
  );
  assert.equal(setup.workspace.store.files.get(journal).toString(),
    JSON.stringify({ status: "applying" }), "the journal remains intact");
  assert.deepEqual(setup.workspace.store.writes, [], "inventory never mutates backups or protected files");
});
