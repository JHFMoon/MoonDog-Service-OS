const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash, webcrypto } = require("node:crypto");

const source = fs.readFileSync(path.join(__dirname, "..", "updates", "package-plan.js"), "utf8");
const context = vm.createContext({ TextDecoder, atob });
vm.runInContext(source, context);
const dryRun = context.MoonDogPackagePlan.dryRun;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const put = (filePath, text) => {
  const bytes = Buffer.from(text);
  return { path: filePath, action: "put", sha256: hash(bytes), contentBase64: bytes.toString("base64") };
};
const remove = (filePath, text) => ({ path: filePath, action: "delete", sha256: hash(Buffer.from(text)) });
const packageOf = files => ({
  formatVersion: 1, version: "1.1.0", approvedFiles: files.map(file => file.path), files
});
const verified = value => ({ status: "verified", version: "1.1.0", bytes: Buffer.from(JSON.stringify(value)) });

function folder(files, permission = "granted") {
  const calls = [];
  const directory = prefix => ({
    queryPermission: async options => { calls.push("permission:" + options.mode); return permission; },
    getDirectoryHandle: async (name, options) => {
      assert.equal(options.create, false);
      calls.push("directory:" + prefix + name);
      const next = prefix + name + "/";
      if (![...files.keys()].some(key => key.startsWith(next))) {
        throw Object.assign(new Error("missing"), { name: "NotFoundError" });
      }
      return directory(next);
    },
    getFileHandle: async (name, options) => {
      assert.equal(options.create, false);
      calls.push("file:" + prefix + name);
      const value = files.get(prefix + name);
      if (value === undefined) throw Object.assign(new Error("missing"), { name: "NotFoundError" });
      const bytes = Buffer.from(value);
      return { getFile: async () => ({ size: bytes.length,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }) };
    }
  });
  return { handle: directory(""), calls };
}

test("Format contract is JSON and the live manifest advertises the Beta package", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "updates", "package-format.schema.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "updates", "manifest.json"), "utf8"));
  assert.equal(schema.properties.formatVersion.const, 1);
  assert.deepEqual(schema.required, ["formatVersion", "version", "approvedFiles", "files"]);
  assert.match(manifest.stable.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.stable.packageUrl.endsWith(`/updates/packages/moondog-${manifest.stable.version}.json`));
  assert.match(manifest.stable.sha256, /^[0-9a-f]{64}$/);
  assert.match(manifest.beta.version, /^\d+\.\d+\.\d+-beta\.\d+$/);
  assert.ok(manifest.beta.packageUrl.endsWith(`/updates/packages/moondog-${manifest.beta.version}.json`));
  assert.match(manifest.beta.sha256, /^[0-9a-f]{64}$/);
});

test("Dry-run classifies add, replace, delete, and unchanged without writing", async () => {
  const entries = [put("index.html", "new"), put("assets/new.js", "added"),
    put("assets/same.css", "same"), remove("assets/old.js", "old"),
    remove("assets/gone.js", "gone")];
  const local = folder(new Map([
    ["index.html", "old"], ["assets/same.css", "same"], ["assets/old.js", "old"]
  ]));
  const result = await dryRun({ verifiedPackage: verified(packageOf(entries)),
    appDirectoryHandle: local.handle, trustedAllowlist: entries.map(entry => entry.path),
    subtle: webcrypto.subtle });
  assert.deepEqual(Object.keys(result), ["add", "replace", "delete", "unchanged", "rejected"]);
  assert.deepEqual(Array.from(result.add), ["assets/new.js"]);
  assert.deepEqual(Array.from(result.replace), ["index.html"]);
  assert.deepEqual(Array.from(result.delete), ["assets/old.js"]);
  assert.deepEqual(Array.from(result.unchanged), ["assets/same.css", "assets/gone.js"]);
  assert.equal(result.rejected.length, 0);
  assert.ok(local.calls.every(call => call.startsWith("permission:") ||
    call.startsWith("directory:") || call.startsWith("file:")));
});

test("Protected and unknown paths reject before local-folder reads", async () => {
  for (const target of ["data/store.json", "backups/system-updates/journal.json",
    "backups/other/backup.json", "BACKUPS/System-Updates/old.txt", "Files to Learn/notes.txt",
    "01 - DROP REPORTS HERE/report.csv", "settings.json", "assets/helper.exe",
    "assets/../settings.json", "assets/unknown.js"]) {
    const local = folder(new Map());
    const result = await dryRun({ verifiedPackage: verified(packageOf([put(target, "synthetic")])),
      appDirectoryHandle: local.handle, trustedAllowlist: ["assets/app.js", target === "assets/unknown.js" ? "assets/app.js" : target],
      subtle: webcrypto.subtle });
    assert.equal(result.rejected.length, 1, target);
    assert.equal(local.calls.length, 0, target);
  }
});

test("Per-file hash, delete preimage, list, and verification failures reject", async () => {
  const local = folder(new Map([["index.html", "changed"]]));
  const badContent = { ...put("index.html", "new"), sha256: "0".repeat(64) };
  const cases = [
    verified(packageOf([badContent])),
    verified({ ...packageOf([put("index.html", "new")]), approvedFiles: ["other.html"] }),
    verified({ ...packageOf([put("index.html", "new")]), version: "2.0.0" }),
    verified({ ...packageOf([put("index.html", "new")]), unexpected: true }),
    verified(packageOf([{ ...put("index.html", "new"), contentBase64: "not base64" }])),
    { status: "rejected", version: "1.1.0", bytes: Buffer.from("{}") }
  ];
  for (const item of cases) {
    const result = await dryRun({ verifiedPackage: item, appDirectoryHandle: local.handle,
      trustedAllowlist: ["index.html"], subtle: webcrypto.subtle });
    assert.equal(result.rejected.length, 1);
    assert.equal(result.add.length + result.replace.length + result.delete.length + result.unchanged.length, 0);
  }
  assert.equal(local.calls.length, 0);

  const deletion = await dryRun({ verifiedPackage: verified(packageOf([remove("index.html", "old")])),
    appDirectoryHandle: local.handle, trustedAllowlist: ["index.html"], subtle: webcrypto.subtle });
  assert.equal(deletion.rejected[0].reason, "current-hash-mismatch");
  assert.equal(deletion.delete.length, 0);
});

test("Missing read permission rejects without prompting or writing", async () => {
  const local = folder(new Map(), "prompt");
  const result = await dryRun({ verifiedPackage: verified(packageOf([put("index.html", "new")])),
    appDirectoryHandle: local.handle, trustedAllowlist: ["index.html"], subtle: webcrypto.subtle });
  assert.equal(result.rejected[0].reason, "permission-required");
  assert.deepEqual(local.calls, ["permission:read"]);
});
