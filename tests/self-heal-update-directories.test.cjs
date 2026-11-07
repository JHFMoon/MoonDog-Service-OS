// Focused production-path regression for #797. Synthetic data only.
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
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const missing = () => Object.assign(new Error("synthetic missing"), { name: "NotFoundError" });
const html = title => '<!doctype html><html lang="en"><head><title>' + title + '</title></head><body></body></html>';
const compat = text => text.replace("<head>", '<head><base href="System Files/">');
function memoryRoot() {
  const old = html("old"), next = html("new");
  const dirs = new Set(["", "System Files", "System Files/assets", "System Files/Workspace",
    "System Files/Workspace/data", "System Files/Workspace/backups", "System Files/Workspace/backups/system-updates"]);
  const files = new Map(Object.entries({
    "index.html": compat(old), "System Files/index.html": old,
    "System Files/assets/old.js": "original",
    "System Files/Workspace/data/current-state.json": "synthetic private data"
  }).map(([k,v]) => [k,Buffer.from(v)]));
  const state = { dirs, files, failOnce: null };
  function handle(prefix) { return {
    kind: "directory", name: prefix.split("/").filter(Boolean).at(-1) || "synthetic-installation",
    queryPermission: async () => "granted", requestPermission: async () => "granted",
    getDirectoryHandle: async (name, opt = {}) => {
      const key = prefix + name;
      if (!dirs.has(key)) { if (!opt.create) throw missing(); dirs.add(key); }
      return handle(key + "/");
    },
    getFileHandle: async (name, opt = {}) => {
      const key = prefix + name;
      if (!files.has(key) && !opt.create) throw missing();
      return {
        getFile: async () => {
          if (!files.has(key)) throw missing();
          const data = files.get(key);
          return { arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
        },
        createWritable: async () => {
          let data;
          return { write: async bytes => {data = Buffer.from(bytes);},
            close: async () => { if(state.failOnce === key) {state.failOnce = null; throw new Error("forced write failure");}
              files.set(key,data); },
            abort: async () => {} };
        }
      };
    },
    removeEntry: async name => {
      if (!files.delete(prefix + name)) throw missing();
    },
    entries: async function* () {
      for (const dir of dirs) if(dir.startsWith(prefix) && dir !== prefix &&
        !dir.slice(prefix.length).includes("/")) yield [dir.slice(prefix.length),handle(dir+"/")];
    }
  }; }
  const root = handle("");
  return { root, state, old, next };
}
async function setup({ includeScript = false, requireScript = false } = {}) {
  const synthetic = memoryRoot();
  const app = await synthetic.root.getDirectoryHandle("System Files");
  const entries = [
    {path:"index.html", action:"put", sha256:digest(Buffer.from(synthetic.next)),
      contentBase64:Buffer.from(synthetic.next).toString("base64")},
    {path:"assets/new.js", action:"put", sha256:digest(Buffer.from("new")),
      contentBase64:Buffer.from("new").toString("base64")},
    {path:"assets/old.js", action:"delete", sha256:digest(Buffer.from("original"))}
  ];
  if (includeScript) {
    const script=Buffer.from("verified replacement application script");
    entries.push({path:"assets/app.js",action:"put",sha256:digest(script),
      contentBase64:script.toString("base64")});
  }
  const bytes=Buffer.from(JSON.stringify({formatVersion:1,version:"1.1.0",
    approvedFiles:entries.map(x=>x.path), files:entries}));
  const verifiedPackage={status:"verified", version:"1.1.0",channel:"beta",
    migrationRequired:false,bytes,sha256:digest(bytes)};
  const trustedAllowlist=entries.map(x=>x.path);
  if (requireScript && !trustedAllowlist.includes("assets/app.js"))
    trustedAllowlist.push("assets/app.js");
  async function run(onProgress) {
    const expectedPlan=await context.MoonDogPackagePlan.dryRun({
      verifiedPackage,appDirectoryHandle:app,trustedAllowlist,subtle:webcrypto.subtle
    });
    assert.equal(expectedPlan.rejected.length,0);
    return context.MoonDogUpdateInstall.apply({
      verifiedPackage,appDirectoryHandle:app,workspaceDirectoryHandle:synthetic.root,
      trustedAllowlist,expectedPlan,confirmed:true,onProgress
    });
  }
  return {...synthetic,run};
}
test("approved missing application folder is reconstructed on verified update", async () => {
  const fixture=await setup();
  fixture.state.dirs.delete("System Files/assets");
  fixture.state.files.delete("System Files/assets/old.js");
  const result=await fixture.run();
  assert.equal(result.status,"installed",result.reason);
  assert.ok(fixture.state.dirs.has("System Files/assets"));
  assert.equal(fixture.state.files.get("System Files/assets/new.js").toString(),"new");
  assert.equal(fixture.state.files.get("System Files/Workspace/data/current-state.json").toString(),"synthetic private data");
});
test("rollback reconstructs vanished application folder while preserving Workspace", async () => {
  const fixture=await setup();
  fixture.state.failOnce="System Files/assets/new.js";
  let vanished=false;
  const result=await fixture.run(event => {
    if (event.phase==="apply" && !vanished) {
      vanished=true;
      fixture.state.dirs.delete("System Files/assets");
      fixture.state.files.delete("System Files/assets/old.js");
    }
  });
  assert.equal(result.status,"rolled-back",result.reason);
  assert.ok(fixture.state.dirs.has("System Files/assets"));
  assert.equal(fixture.state.files.get("System Files/assets/old.js").toString(),"original");
  assert.equal(fixture.state.files.has("System Files/assets/new.js"),false);
  assert.equal(fixture.state.files.get("System Files/Workspace/data/current-state.json").toString(),"synthetic private data");
});

test("verified package restores a missing approved app.js but never invents a missing entry page", async () => {
  const fixture=await setup({includeScript:true});
  assert.equal(fixture.state.files.has("System Files/assets/app.js"),false);
  const result=await fixture.run();
  assert.equal(result.status,"installed",result.reason);
  assert.equal(fixture.state.files.get("System Files/assets/app.js").toString(),
    "verified replacement application script");
  assert.equal(fixture.state.files.get("System Files/Workspace/data/current-state.json").toString(),
    "synthetic private data");

  const unrecognized=await setup({includeScript:true});
  unrecognized.state.files.delete("System Files/index.html");
  const rejected=await unrecognized.run();
  assert.notEqual(rejected.status,"installed");
  assert.match(String(rejected.reason),/index\.html/);
  assert.equal(unrecognized.state.files.has("System Files/assets/app.js"),false);
  assert.equal(unrecognized.state.files.get("System Files/Workspace/data/current-state.json").toString(),
    "synthetic private data");
});

test("a repaired installation cannot mutate a separate synthetic store", async () => {
  const first=await setup({includeScript:true});
  const second=await setup({includeScript:true});
  first.state.dirs.delete("System Files/assets");
  first.state.files.delete("System Files/assets/old.js");
  const otherFiles=new Map([...second.state.files].map(([key,value])=>[key,Buffer.from(value)]));
  const otherDirs=new Set(second.state.dirs);
  const result=await first.run();
  assert.equal(result.status,"installed",result.reason);
  assert.deepEqual(second.state.dirs,otherDirs);
  assert.deepEqual(second.state.files,otherFiles);
  assert.equal(first.state.files.get("System Files/Workspace/data/current-state.json").toString(),
    "synthetic private data");
});

test("repeat verified update is safe and preserves store-specific bytes", async () => {
  const fixture=await setup({includeScript:true});
  fixture.state.dirs.delete("System Files/assets");
  fixture.state.files.delete("System Files/assets/old.js");
  assert.equal((await fixture.run()).status,"installed");
  const originals=new Map([...fixture.state.files].filter(([key])=>
    key==="System Files/Workspace/data/current-state.json"
  ).map(([key,value])=>[key,Buffer.from(value)]));
  const second=await fixture.run();
  assert.equal(second.status,"installed",second.reason);
  assert.deepEqual(
    new Map([...fixture.state.files].filter(([key])=>originals.has(key))),
    originals);
  assert.equal(fixture.state.files.get("System Files/assets/new.js").toString(),"new");
  assert.equal(fixture.state.files.get("System Files/assets/app.js").toString(),
    "verified replacement application script");
});

test("missing required app.js fails closed if verified package cannot replace it", async () => {
  const fixture=await setup({requireScript:true});
  const before=new Map([...fixture.state.files].map(([key,value])=>[key,Buffer.from(value)]));
  const result=await fixture.run();
  assert.equal(result.status,"stopped");
  assert.match(result.reason,/Required application script is missing/);
  assert.deepEqual(fixture.state.files,before,
    "failed repair must not modify application or private Workspace files");
});
