const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "updates", "apply-design-model.js"), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const model = context.MoonDogApplyDesignModel;
const bytes = text => Buffer.from(text);

test("protected operational paths and traversal cannot be targets", () => {
  for (const target of [
    "data/current-state.json", "history/old.json", "backups/app.js",
    "Files to Learn/notes.txt", "01 - DROP REPORTS HERE/report.txt",
    "report-inbox/new.txt", "settings.json", "assets/local-state.json",
    "customers/list.json", "assets/report.XLSX", ".env.local"
  ]) {
    assert.equal(model.isProtected(target), true, target);
  }
  for (const target of ["../data/file.json", "/app.js", "C:\\data\\file.json", "assets/../settings.json"] ) {
    assert.throws(() => model.canonicalPath(target), undefined, target);
  }
  assert.equal(model.isProtected("assets/app.js"), false);
});

test("all app-file backups precede the first write", () => {
  const result = model.simulate({
    installedFiles: new Map([["index.html", bytes("old page")], ["assets/app.js", bytes("old code")],
      ["assets/style.css", bytes("old style")]]),
    trustedAllowlist: ["index.html", "assets/app.js", "assets/style.css"],
    entries: [{ path: "index.html", bytes: bytes("new page") },
      { path: "assets/app.js", bytes: bytes("new code") }]
  });
  assert.equal(result.status, "applied-in-memory");
  assert.deepEqual(Array.from(result.events, event => event.step),
    ["backup", "backup", "backup", "write", "write"]);
  assert.equal(Buffer.from(result.backup.get("index.html")).toString(), "old page");
  assert.equal(Buffer.from(result.backup.get("assets/style.css")).toString(), "old style");
  assert.equal(Buffer.from(result.files.get("index.html")).toString(), "new page");
});

test("a failure restores old bytes and removes newly created app files", () => {
  const original = new Map([["index.html", bytes("old page")], ["data/keep.json", bytes("private state")]]);
  const result = model.simulate({
    installedFiles: original,
    trustedAllowlist: ["index.html", "assets/new.js"],
    entries: [{ path: "index.html", bytes: bytes("new page") },
      { path: "assets/new.js", bytes: bytes("new code") }],
    failAfterWrite: "assets/new.js"
  });
  assert.equal(result.status, "restored-in-memory");
  assert.equal(Buffer.from(result.files.get("index.html")).toString(), "old page");
  assert.equal(result.files.has("assets/new.js"), false);
  assert.equal(Buffer.from(result.files.get("data/keep.json")).toString(), "private state");
  assert.equal(Buffer.from(result.backup.get("index.html")).toString(), "old page");
  assert.equal(result.backup.get("assets/new.js"), null);
  assert.deepEqual(Array.from(result.events, event => event.step),
    ["backup", "backup", "write", "write", "restore", "restore"]);
});

test("a package cannot authorize forbidden, unlisted, or duplicate files", () => {
  for (const target of ["data/store.json", "settings.json", "assets/private.csv",
    "assets/helper.exe", "scripts/refresh.ps1"]) {
    assert.throws(() => model.plan([{ path: target, bytes: bytes("x") }], [target]));
  }
  assert.throws(() => model.plan([{ path: "assets/unlisted.js", bytes: bytes("x") }], ["index.html"]));
  assert.throws(() => model.plan([
    { path: "Index.html", bytes: bytes("a") },
    { path: "index.html", bytes: bytes("b") }
  ], ["index.html"]));
});
