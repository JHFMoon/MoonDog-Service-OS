const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createHash, webcrypto } = require("node:crypto");

const context = vm.createContext({ TextDecoder, atob, URL, Uint8Array });
for (const name of ["check", "verify", "package-plan", "apply-design-model"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "updates", name + ".js"), "utf8"), context);
}
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const bytesOf = text => Buffer.from(text, "utf8");
const put = (filePath, text) => {
  const bytes = bytesOf(text);
  return { path: filePath, action: "put", sha256: hash(bytes), contentBase64: bytes.toString("base64") };
};
const remove = (filePath, text) => ({ path: filePath, action: "delete", sha256: hash(bytesOf(text)) });
const missing = () => Object.assign(new Error("missing"), { name: "NotFoundError" });

function readOnlyFolder(root) {
  const directory = prefix => ({
    queryPermission: async () => "granted",
    getDirectoryHandle: async (name, options) => {
      assert.equal(options.create, false);
      const next = path.join(prefix, name);
      if (!fs.existsSync(path.join(root, next))) throw missing();
      return directory(next);
    },
    getFileHandle: async (name, options) => {
      assert.equal(options.create, false);
      const filePath = path.join(root, prefix, name);
      if (!fs.existsSync(filePath)) throw missing();
      return { getFile: async () => {
        const bytes = fs.readFileSync(filePath);
        return { size: bytes.length, arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
      } };
    }
  });
  return directory("");
}

test("synthetic folder: check, fetch, verify, plan, backup, apply, verify, fail, rollback", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "moondog-1h-"));
  const app = path.join(root, "MoonDog-Test-App");
  const backup = path.join(root, "backup");
  const allowlist = ["index.html", "assets/new.js", "assets/same.css", "assets/old.js"];
  const initial = new Map([
    ["index.html", bytesOf("old app")], ["assets/same.css", bytesOf("same")],
    ["assets/old.js", bytesOf("retired")],
    ["data/current-state.json", bytesOf("synthetic protected data")],
    ["Files to Learn/example.txt", bytesOf("synthetic protected note")],
    ["settings.json", bytesOf("synthetic protected settings")]
  ]);
  const file = relative => path.join(app, ...relative.split("/"));
  const write = (relative, bytes) => {
    fs.mkdirSync(path.dirname(file(relative)), { recursive: true });
    fs.writeFileSync(file(relative), bytes);
  };
  const snapshot = () => new Map([...initial.keys(), "assets/new.js"].map(name =>
    [name, fs.existsSync(file(name)) ? hash(fs.readFileSync(file(name))) : null]));
  try {
    for (const [name, bytes] of initial) write(name, bytes);
    const before = snapshot();
    const entries = [put("index.html", "new app"), put("assets/new.js", "new asset"),
      put("assets/same.css", "same"), remove("assets/old.js", "retired")];
    const packageBytes = bytesOf(JSON.stringify({ formatVersion: 1, version: "1.1.0",
      approvedFiles: entries.map(entry => entry.path), files: entries }));
    const packageUrl = "https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/test/synthetic-package.json";
    const manifest = { stable: { version: "1.1.0", minimumCompatibleVersion: "1.0.0",
      migrationRequired: false, packageUrl, sha256: hash(packageBytes), releaseNotes: "Synthetic test only" },
      beta: { version: "1.2.0-beta.1", minimumCompatibleVersion: "1.1.0",
        migrationRequired: false, packageUrl: null, sha256: null, releaseNotes: "No Beta test" } };
    const fetcher = async url => {
      if (url.endsWith("/updates/manifest.json")) return { ok: true, json: async () => manifest };
      assert.equal(url, packageUrl);
      return { ok: true, headers: { get: () => String(packageBytes.length) },
        body: { getReader: () => {
          let sent = false;
          return { read: async () => sent ? { done: true } :
            (sent = true, { done: false, value: packageBytes }) };
        } } };
    };
    const check = await context.MoonDogUpdateCheck.check({ currentVersion: "1.0.0", fetcher });
    assert.equal(check.status, "newer-version");
    assert.equal(check.channel, "stable");
    const verified = await context.MoonDogPackageVerification.verify({ fetcher, subtle: webcrypto.subtle });
    assert.equal(verified.status, "verified");
    assert.equal(verified.sha256, manifest.stable.sha256);
    const dryRun = await context.MoonDogPackagePlan.dryRun({ verifiedPackage: verified,
      appDirectoryHandle: readOnlyFolder(app), trustedAllowlist: allowlist, subtle: webcrypto.subtle });
    for (const [kind, expected] of Object.entries({ add: ["assets/new.js"], replace: ["index.html"],
      delete: ["assets/old.js"], unchanged: ["assets/same.css"], rejected: [] })) {
      assert.deepEqual(Array.from(dryRun[kind]), expected);
    }
    assert.deepEqual(snapshot(), before, "dry-run must leave the folder unchanged");

    const model = context.MoonDogApplyDesignModel;
    model.plan(entries.filter(entry => entry.action === "put").map(entry =>
      ({ path: entry.path, bytes: Buffer.from(entry.contentBase64, "base64") })), allowlist);
    for (const entry of entries) {
      assert.equal(model.isProtected(entry.path), false);
      assert.ok(allowlist.includes(entry.path));
    }
    const events = [];
    function apply(failAfter) {
      const originals = new Map();
      for (const name of allowlist) {
        const original = fs.existsSync(file(name)) ? fs.readFileSync(file(name)) : null;
        originals.set(name, original);
        if (original !== null) {
          const destination = path.join(backup, ...name.split("/"));
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.writeFileSync(destination, original);
        }
        events.push("backup:" + name);
      }
      try {
        for (const entry of entries) {
          if (entry.action === "put") write(entry.path, Buffer.from(entry.contentBase64, "base64"));
          else fs.rmSync(file(entry.path));
          events.push("apply:" + entry.path);
          if (entry.path === failAfter) throw new Error("forced failure");
        }
        for (const entry of entries) {
          const actual = fs.existsSync(file(entry.path)) ? hash(fs.readFileSync(file(entry.path))) : null;
          assert.equal(actual, entry.action === "put" ? entry.sha256 : null);
        }
        events.push("verified");
        return "applied";
      } catch (error) {
        for (const [name, original] of originals) {
          if (original === null) fs.rmSync(file(name), { force: true });
          else write(name, fs.readFileSync(path.join(backup, ...name.split("/"))));
          events.push("rollback:" + name);
        }
        assert.deepEqual(snapshot(), before, "rollback must restore exact original contents and presence");
        return error.message;
      }
    }
    assert.equal(apply(), "applied");
    assert.ok(events.indexOf("backup:assets/old.js") < events.indexOf("apply:index.html"));
    for (const protectedName of ["data/current-state.json", "Files to Learn/example.txt", "settings.json"]) {
      assert.equal(hash(fs.readFileSync(file(protectedName))), before.get(protectedName));
    }
    for (const [name, original] of initial) write(name, original);
    fs.rmSync(file("assets/new.js"));
    events.length = 0;
    assert.equal(apply("assets/new.js"), "forced failure");
    assert.ok(events.includes("rollback:assets/new.js"));
  } finally {
    const resolved = fs.realpathSync(root);
    const temp = fs.realpathSync(os.tmpdir());
    assert.ok(resolved.startsWith(temp + path.sep) && path.basename(resolved).startsWith("moondog-1h-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
