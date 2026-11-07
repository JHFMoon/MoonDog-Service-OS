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
    _prefix: prefix, _state: state,
    isSameEntry: async other => other?._prefix === prefix && other?._state === state,
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
  return {...synthetic,app,verifiedPackage,trustedAllowlist,run};
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

test("unfinished prior update blocks another update without modifying the store", async () => {
  const fixture=await setup({includeScript:true});
  const backup="System Files/Workspace/backups/system-updates/MoonDog-Update-Backup-SYNTHETIC";
  fixture.state.dirs.add(backup);
  fixture.state.files.set(backup+"/journal.json",Buffer.from(JSON.stringify({
    status:"applying", inventory:[]
  })));
  const before=new Map([...fixture.state.files].map(([key,value])=>[key,Buffer.from(value)]));
  const result=await fixture.run();
  assert.equal(result.status,"recovery-required");
  assert.match(result.reason,/earlier application update needs recovery/);
  assert.equal(result.backupName,"MoonDog-Update-Backup-SYNTHETIC");
  assert.deepEqual(fixture.state.files,before);
});

test("corrupted prior update journal fails closed without creating a new update", async () => {
  const fixture=await setup({includeScript:true});
  const backup="System Files/Workspace/backups/system-updates/MoonDog-Update-Backup-CORRUPT";
  fixture.state.dirs.add(backup);
  fixture.state.files.set(backup+"/journal.json",Buffer.from("{bad-json"));
  const before=new Map([...fixture.state.files].map(([key,value])=>[key,Buffer.from(value)]));
  const result=await fixture.run();
  assert.equal(result.status,"stopped");
  assert.match(result.reason,/recovery journal is unreadable/);
  assert.deepEqual(fixture.state.files,before);
});

test("unrecognized existing update journal state blocks new updates", async () => {
  const fixture=await setup({includeScript:true});
  const backup="System Files/Workspace/backups/system-updates/MoonDog-Update-Backup-UNKNOWN";
  fixture.state.dirs.add(backup);
  fixture.state.files.set(backup+"/journal.json",
    Buffer.from(JSON.stringify({status:"unknown",inventory:[]})));
  const before=new Map([...fixture.state.files].map(([key,value])=>[key,Buffer.from(value)]));
  const result=await fixture.run();
  assert.equal(result.status,"stopped");
  assert.match(result.reason,/recovery journal is invalid/);
  assert.deepEqual(fixture.state.files,before);
});

const copyFiles = fixture => new Map([...fixture.state.files].map(([key,value])=>[key,Buffer.from(value)]));
const privateFiles = fixture => new Map([...fixture.state.files].filter(([key])=>
  key.startsWith('System Files/Workspace/data/') || key.startsWith('System Files/Workspace/originals/')));

test('corrupt application bytes are replaced while unknown software files and private originals survive', async()=>{
  const h=await setup({includeScript:true});
  h.state.files.set('System Files/assets/app.js',Buffer.from('damaged application'));
  h.state.files.set('System Files/assets/unknown.js',Buffer.from('unrelated original'));
  h.state.files.set('System Files/Workspace/originals/synthetic-source.txt',Buffer.from('protected synthetic original'));
  const before=privateFiles(h);
  const result=await h.run();
  assert.equal(result.status,'installed',result.reason);
  assert.equal(h.state.files.get('System Files/assets/app.js').toString(),'verified replacement application script');
  assert.equal(h.state.files.get('System Files/assets/unknown.js').toString(),'unrelated original');
  assert.deepEqual(privateFiles(h),before);
  const journal=JSON.parse(h.state.files.get('System Files/Workspace/backups/system-updates/'+result.backupName+'/journal.json'));
  assert.equal(journal.status,'verified');
  assert.equal(journal.structure.schemaVersion,1);
  assert.equal(journal.structure.requiredFileCount,3);
  assert.equal(journal.structure.packageSha256,h.verifiedPackage.sha256);
});

test('missing origin compatibility entry is rebuilt from verified HTML and rollback preserves its original absence',async()=>{
  const h=await setup();h.state.files.delete('index.html');
  const result=await h.run();
  assert.equal(result.status,'installed',result.reason);
  assert.equal(h.state.files.get('index.html').toString(),compat(h.next));
  const failed=await setup();failed.state.files.delete('index.html');
  failed.state.failOnce='System Files/assets/new.js';
  assert.equal((await failed.run()).status,'rolled-back');
  assert.equal(failed.state.files.has('index.html'),false);
});

test('missing private Workspace and interrupted Fresh marker never authorize repair writes',async()=>{
  for(const interrupted of [false,true]){
    const h=await setup();
    if(interrupted)h.state.files.set('System Files/MOONDOG_FRESH_RESET_PENDING.json',Buffer.from('{}'));
    else h.state.dirs.delete('System Files/Workspace');
    const before=copyFiles(h),dirs=new Set(h.state.dirs);
    const result=await h.run();
    assert.equal(result.status,'stopped');
    assert.deepEqual(h.state.files,before);assert.deepEqual(h.state.dirs,dirs);
  }
});

test('denied or read-only folder permission stops without any repair or empty data creation',async()=>{
  const h=await setup({includeScript:true});const before=copyFiles(h);
  h.root.queryPermission=async()=> 'denied';h.root.requestPermission=async()=> 'denied';
  assert.equal((await h.run()).status,'stopped');assert.deepEqual(h.state.files,before);
});

test('a mismatched application handle cannot update another selected installation',async()=>{
  const first=await setup(),second=await setup();
  const beforeA=copyFiles(first),beforeB=copyFiles(second);
  const expectedPlan=await context.MoonDogPackagePlan.dryRun({verifiedPackage:first.verifiedPackage,
    appDirectoryHandle:second.app,trustedAllowlist:first.trustedAllowlist});
  const result=await context.MoonDogUpdateInstall.apply({verifiedPackage:first.verifiedPackage,
    appDirectoryHandle:second.app,workspaceDirectoryHandle:first.root,
    trustedAllowlist:first.trustedAllowlist,expectedPlan,confirmed:true});
  assert.equal(result.status,'stopped');assert.match(result.reason,/selected installation/);
  assert.deepEqual(first.state.files,beforeA);assert.deepEqual(second.state.files,beforeB);
});

test('concurrent update attempt is rejected while the original operation retains its lock',async()=>{
  const h=await setup();let enter,release;
  const entered=new Promise(resolve=>enter=resolve), gate=new Promise(resolve=>release=resolve);
  const first=h.run(async event=>{if(event.phase==='health-check'){enter();await gate;}});
  await entered;
  const before=copyFiles(h),second=await h.run();
  assert.equal(second.status,'busy');assert.deepEqual(h.state.files,before);
  release();assert.equal((await first).status,'installed');
});

test('a browser tab lock denial fails closed without calling the write path',async()=>{
  const h=await setup(),before=copyFiles(h);
  context.navigator={locks:{request:async(name,options,callback)=>{
    assert.equal(name,'moondog-application-update-v1');assert.equal(options.ifAvailable,true);
    return callback(null);
  }}};
  try {assert.equal((await h.run()).status,'busy');assert.deepEqual(h.state.files,before);}
  finally {delete context.navigator;}
  assert.equal((await h.run()).status,'installed','a rejected lock never leaves the in-realm guard stuck');
});

test('copied rollback journal from a second synthetic dealership is refused before restoration',async()=>{
  const first=await setup({includeScript:true}),second=await setup({includeScript:true});
  const updateA=await first.run();assert.equal(updateA.status,'installed');
  assert.equal((await second.run()).status,'installed');
  const prefix='System Files/Workspace/backups/system-updates/'+updateA.backupName;
  for(const dir of first.state.dirs)if(dir.startsWith(prefix))second.state.dirs.add(dir);
  for(const [key,value]of first.state.files)if(key.startsWith(prefix+'/'))second.state.files.set(key,Buffer.from(value));
  const journal=prefix+'/journal.json';const record=JSON.parse(second.state.files.get(journal));
  record.status='applying';second.state.files.set(journal,Buffer.from(JSON.stringify(record)));
  const before=copyFiles(second);
  const result=await context.MoonDogUpdateInstall.recover({appDirectoryHandle:second.app,
    workspaceDirectoryHandle:second.root,backupName:updateA.backupName,
    trustedAllowlist:second.trustedAllowlist,confirmed:true});
  assert.equal(result.status,'recovery-required');assert.match(result.reason,/another or unverified installation/);
  assert.deepEqual(second.state.files,before);
});

test('tampered package and hash mismatch cannot change application or private data',async()=>{
  const h=await setup();h.verifiedPackage.bytes[0]=91;
  const before=copyFiles(h);
  const result=await context.MoonDogUpdateInstall.apply({verifiedPackage:h.verifiedPackage,
    appDirectoryHandle:h.app,workspaceDirectoryHandle:h.root,trustedAllowlist:h.trustedAllowlist,
    expectedPlan:{},confirmed:true});
  assert.equal(result.status,'rejected');
  assert.deepEqual(h.state.files,before);
});

test('missing required dependency outside the package cannot be reported as a successful repair',async()=>{
  const h=await setup({includeScript:true});h.trustedAllowlist.push('vendor/jszip.min.js');
  const before=copyFiles(h),dirs=new Set(h.state.dirs);
  const result=await h.run();assert.equal(result.status,'stopped');
  assert.match(result.reason,/outside this repair package is missing or damaged/);
  assert.deepEqual(h.state.files,before);assert.deepEqual(h.state.dirs,dirs);
});

test('local identity change during repair blocks further writes and retains recovery evidence',async()=>{
  const h=await setup();let changed=false;
  const result=await h.run(event=>{
    if(event.phase==='apply'&&!changed){
      changed=true;h.state.files.set('System Files/MOONDOG_UPDATE_IDENTITY.json',Buffer.from('{}'));
    }
  });
  assert.equal(result.status,'recovery-required');
  assert.equal(h.state.files.get('System Files/assets/old.js').toString(),'original');
  assert.deepEqual(privateFiles(h),new Map([['System Files/Workspace/data/current-state.json',Buffer.from('synthetic private data')]]));
  const journal=JSON.parse(h.state.files.get('System Files/Workspace/backups/system-updates/'+result.backupName+'/journal.json'));
  assert.equal(journal.status,'applying');
});

test('runtime dependency health uses the reviewed distribution dependency hashes',()=>{
  const code=fs.readFileSync(path.join(__dirname,'..','updates/install.js'),'utf8');
  const dependencies=JSON.parse(fs.readFileSync(path.join(__dirname,'..','distribution/dependencies.json'),'utf8')).runtimeLibraries;
  for(const [file,sha]of [
    [dependencies.jszip.destination,dependencies.jszip.outputSha256],
    [dependencies.sheetjs.destination,dependencies.sheetjs.outputSha256],
    [dependencies.pdfjs.mainDestination,dependencies.pdfjs.mainOutputSha256],
    [dependencies.pdfjs.workerDestination,dependencies.pdfjs.workerOutputSha256]]){
    assert.ok(code.includes(JSON.stringify(file)+': '+JSON.stringify(sha)),file+' must retain reviewed software authority');
  }
});

test('failed rollback retains a valid journal and a fresh runtime can recover the original application',async()=>{
  const h=await setup();h.state.failOnce='System Files/assets/new.js';let interrupted=false;
  const result=await h.run(event=>{
    if(event.phase==='rollback'&&!interrupted){interrupted=true;h.state.failOnce='System Files/assets/old.js';}
  });
  assert.equal(result.status,'recovery-required');
  const restarted=vm.createContext({TextDecoder,TextEncoder,atob,crypto:webcrypto,Uint8Array});
  for(const name of ['package-plan','apply-design-model','install'])
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..','updates',name+'.js'),'utf8'),restarted);
  const recovery=await restarted.MoonDogUpdateInstall.recover({appDirectoryHandle:h.app,
    workspaceDirectoryHandle:h.root,backupName:result.backupName,
    trustedAllowlist:h.trustedAllowlist,confirmed:true});
  assert.equal(recovery.status,'restored',recovery.reason);
  assert.equal(h.state.files.get('System Files/index.html').toString(),h.old);
  assert.equal(h.state.files.get('System Files/assets/old.js').toString(),'original');
  assert.equal(h.state.files.has('System Files/assets/new.js'),false);
  assert.equal(h.state.files.get('System Files/Workspace/data/current-state.json').toString(),'synthetic private data');
});
