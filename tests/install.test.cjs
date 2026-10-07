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
    [key, Buffer.from(value)])), failOnce: null, writes: [] };
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
          const value = store.files.get(key);
          if (!value) throw notFound();
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
  const verifiedPackage = { status: "verified", version: "1.1.0", migrationRequired: false,
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
  assert.equal(setup.workspace.store.files.get(base + "index.html").toString(), setup.oldHtml);
  assert.equal(setup.workspace.store.files.get(base + "origin-compatibility/index.html").toString(), compatibility(setup.oldHtml));
});

test("editing authority fails closed before an update can mutate files", async () => {
  const setup = await fixture();
  context.MoonDogWriteAuthority = { canWrite: false, validate: async () => false };
  const result = await apply(setup);
  delete context.MoonDogWriteAuthority;
  assert.equal(result.status, "read-only");
  assert.equal(setup.workspace.store.files.get("System Files/index.html").toString(), setup.oldHtml);
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
