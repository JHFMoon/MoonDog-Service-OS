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
const distributionLauncher=Buffer.from(fs.readFileSync(path.join(__dirname,'..','scripts/build_distribution.py'),'utf8').match(/LAUNCHER = """([\s\S]*?)"""/)[1]);
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
  const state = { dirs, files, failOnce: null, failOpenKey: null, openFailures: 0, targetOpenAttempts: 0 };
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
          if (state.failOpenKey === key) {
            state.targetOpenAttempts++;
            if (state.openFailures-- > 0)
              throw Object.assign(new Error("synthetic synchronization stream lock"), {name:"NotReadableError"});
          }
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
      for (const file of files.keys()) if(file.startsWith(prefix) && !file.slice(prefix.length).includes("/"))
        yield [file.slice(prefix.length),{kind:"file"}];
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
  assert.equal(result.status,"recovery-required");
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
  assert.equal(result.status,"recovery-required");
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
  const shared=Buffer.from(JSON.stringify({records:[{ro:'SYNTHETIC-SHARED',advisor:'SYNTHETIC-ADVISOR',manualOverride:'preserve'}]}));
  first.state.files.set('System Files/Workspace/data/current-state.json',Buffer.from(shared));
  second.state.files.set('System Files/Workspace/data/current-state.json',Buffer.from(shared));
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
  const h=await setup({includeScript:true});h.trustedAllowlist.push('vendor/unsupported.js');
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

test('unavailable native folder identity cannot be treated as a verified selected installation',async()=>{
  const h=await setup();const original=h.root.getDirectoryHandle;
  h.root.getDirectoryHandle=async(...args)=>{const handle=await original(...args);delete handle.isSameEntry;return handle;};
  const before=copyFiles(h);const result=await h.run();
  assert.equal(result.status,'stopped');assert.deepEqual(h.state.files,before);
});

test('missing named launcher is restored byte-for-byte from reviewed software authority',async()=>{
  const h=await setup({includeScript:true});const before=privateFiles(h);
  const result=await h.run();assert.equal(result.status,'installed',result.reason);
  assert.deepEqual(h.state.files.get('00 - OPEN DASHBOARD.html'),
    distributionLauncher);
  assert.deepEqual(privateFiles(h),before);
});

test('unknown contents at the named launcher are preserved and block automatic software repair',async()=>{
  const h=await setup();h.state.files.set('00 - OPEN DASHBOARD.html',Buffer.from('unknown custom launcher'));
  const before=copyFiles(h);const result=await h.run();
  assert.equal(result.status,'stopped');assert.match(result.reason,/launcher is unrecognized/);
  assert.deepEqual(h.state.files,before);
});

test('restart rollback removes a newly repaired launcher when it was absent in the verified original inventory',async()=>{
  const h=await setup();const result=await h.run();assert.equal(result.status,'installed');
  const key='System Files/Workspace/backups/system-updates/'+result.backupName+'/journal.json';
  const record=JSON.parse(h.state.files.get(key));record.status='applying';h.state.files.set(key,Buffer.from(JSON.stringify(record)));
  const recovered=await context.MoonDogUpdateInstall.recover({appDirectoryHandle:h.app,
    workspaceDirectoryHandle:h.root,backupName:result.backupName,trustedAllowlist:h.trustedAllowlist,confirmed:true});
  assert.equal(recovered.status,'restored',recovered.reason);
  assert.equal(h.state.files.has('00 - OPEN DASHBOARD.html'),false);
  assert.equal(h.state.files.get('System Files/index.html').toString(),h.old);
});

test('transient synchronization stream-opening locks retry with a strict bound before writing bytes',async()=>{
  const h=await setup();const before=privateFiles(h);
  h.state.failOpenKey='System Files/assets/new.js';h.state.openFailures=2;
  const result=await h.run();assert.equal(result.status,'installed',result.reason);
  assert.equal(h.state.targetOpenAttempts,3);
  assert.equal(h.state.files.get('System Files/assets/new.js').toString(),'new');
  assert.deepEqual(privateFiles(h),before);
});

test('persistent stream-opening lock exhausts three attempts and verifies rollback without resetting data',async()=>{
  const h=await setup();const before=privateFiles(h);
  h.state.failOpenKey='System Files/assets/new.js';h.state.openFailures=10;
  const result=await h.run();assert.equal(result.status,'rolled-back',result.reason);
  assert.equal(h.state.targetOpenAttempts,3);
  assert.equal(h.state.files.get('System Files/index.html').toString(),h.old);
  assert.equal(h.state.files.has('System Files/assets/new.js'),false);
  assert.deepEqual(privateFiles(h),before);
});

test('recognized clean-install software manifest permits entry-page repair without inventing private data',async()=>{
  const h=await setup({includeScript:true});const before=privateFiles(h);
  h.state.files.delete('System Files/index.html');h.state.files.delete('index.html');
  h.state.files.set('INSTALLATION-MANIFEST.json',Buffer.from(JSON.stringify({
    format:'service-operations-dashboard-clean-install',formatVersion:1,version:'0.10.17',
    applicationRoot:'System Files',workspaceRoot:'System Files/Workspace',
    launcher:'00 - OPEN DASHBOARD.html',workspaceProtectedFromUpdates:true,
    files:[{path:'System Files/index.html',sha256:digest(Buffer.from(h.old))}]
  })));
  const result=await h.run();assert.equal(result.status,'installed',result.reason);
  assert.equal(h.state.files.get('System Files/index.html').toString(),h.next);
  assert.equal(h.state.files.get('index.html').toString(),compat(h.next));
  assert.deepEqual(privateFiles(h),before);
});

async function pendingIdentityBound(h){
 const update=await h.run();assert.equal(update.status,'installed',update.reason);
 const prefix='System Files/Workspace/backups/system-updates/'+update.backupName;
 const record=JSON.parse(h.state.files.get(prefix+'/journal.json'));
 record.status='applying';h.state.files.set(prefix+'/journal.json',Buffer.from(JSON.stringify(record)));
 return {...update,prefix};
}

test('read-only recovery inspection verifies every saved software byte without changing files or asking permission',async()=>{
 const h=await setup({includeScript:true}),pending=await pendingIdentityBound(h);const before=copyFiles(h);let prompts=0;
 h.root.requestPermission=async()=>{prompts++;return 'granted';};
 const result=await context.MoonDogUpdateInstall.inspectRecovery({appDirectoryHandle:h.app,
  workspaceDirectoryHandle:h.root,backupName:pending.backupName,trustedAllowlist:h.trustedAllowlist});
 assert.equal(result.status,'recoverable',result.reason);assert.equal(prompts,0);assert.deepEqual(h.state.files,before);
 h.root.queryPermission=async()=> 'denied';
 assert.equal((await context.MoonDogUpdateInstall.inspectRecovery({appDirectoryHandle:h.app,
  workspaceDirectoryHandle:h.root,backupName:pending.backupName,trustedAllowlist:h.trustedAllowlist})).status,'recovery-required');
 assert.equal(prompts,0,'inspection never upgrades local permission');assert.deepEqual(h.state.files,before);
});

test('an authorized Beta update automatically reconciles one verified interrupted transaction before installing',async()=>{
 const h=await setup({includeScript:true}),pending=await pendingIdentityBound(h);const before=privateFiles(h);
 h.state.files.set('System Files/assets/new.js',Buffer.from('synthetic partial application write'));
 const progress=[],result=await h.run(event=>progress.push(event));
 assert.equal(result.status,'installed',result.reason);assert.notEqual(result.backupName,pending.backupName);
 assert.equal(JSON.parse(h.state.files.get(pending.prefix+'/journal.json')).status,'restored');
 assert.equal(h.state.files.get('System Files/assets/new.js').toString(),'new');assert.deepEqual(privateFiles(h),before);
 assert.ok(progress.some(event=>event.phase==='repair-recovery'&&event.label==='Repairing'));
 assert.equal(progress.filter(event=>event.phase==='complete').length,1,'Ready is only reported after the full new update');
});

test('automatic reconciliation refuses tampered originals before changing any application file',async()=>{
 const h=await setup({includeScript:true}),pending=await pendingIdentityBound(h);
 h.state.files.set(pending.prefix+'/index.html',Buffer.from('tampered saved original'));
 const before=copyFiles(h),result=await h.run();assert.equal(result.status,'recovery-required');
 assert.match(result.reason,/Backup verification failed/);assert.deepEqual(h.state.files,before);
});

test('multiple unfinished journals, a Stable update, and a changed preview cannot authorize automatic restore',async()=>{
 for(const mode of ['multiple','stable','preview']){
  const h=await setup({includeScript:true}),pending=await pendingIdentityBound(h);
  if(mode==='multiple'){
   const other=pending.prefix+'-SECOND';h.state.dirs.add(other);
   h.state.files.set(other+'/journal.json',Buffer.from(h.state.files.get(pending.prefix+'/journal.json')));
  }
  if(mode==='stable')h.verifiedPackage.channel='stable';
  const before=copyFiles(h);
  const result=mode==='preview'?await context.MoonDogUpdateInstall.apply({verifiedPackage:h.verifiedPackage,
   appDirectoryHandle:h.app,workspaceDirectoryHandle:h.root,trustedAllowlist:h.trustedAllowlist,
   expectedPlan:{},confirmed:true}):await h.run();
  assert.equal(result.status,mode==='preview'?'rejected':'recovery-required');assert.deepEqual(h.state.files,before);
 }
});

test('failed interrupted recovery retains its journal and never starts a second application transaction',async()=>{
 const h=await setup({includeScript:true}),pending=await pendingIdentityBound(h);
 const before=privateFiles(h),beforeDirs=new Set(h.state.dirs);h.state.failOnce='System Files/index.html';
 const result=await h.run();assert.equal(result.status,'recovery-required');
 assert.equal(JSON.parse(h.state.files.get(pending.prefix+'/journal.json')).status,'applying');
 assert.deepEqual(h.state.dirs,beforeDirs);assert.deepEqual(privateFiles(h),before);
});

test('both exact reviewed launcher layouts survive repeated updates without being rewritten',async()=>{
 for(const original of [distributionLauncher,fs.readFileSync(path.join(__dirname,'..','00 - OPEN DASHBOARD.html'))]){
  const h=await setup({includeScript:true});h.state.files.set('00 - OPEN DASHBOARD.html',Buffer.from(original));
  assert.equal((await h.run()).status,'installed');assert.deepEqual(h.state.files.get('00 - OPEN DASHBOARD.html'),original);
  assert.equal((await h.run()).status,'installed');assert.deepEqual(h.state.files.get('00 - OPEN DASHBOARD.html'),original);
 }
});

const recoveryCarriers=['arrivals','assign-next','clarity','daily-ops','developer-center','meeting','operational','performance'].map(name=>'assets/'+name+'.css');
function reviewedRecoverySoftware(){
 return JSON.parse(recoveryCarriers.map((name,index)=>fs.readFileSync(path.join(__dirname,'..',name),'utf8')
  .split('/* BEGIN MOONDOG REVIEWED SOFTWARE DATA '+(index+1)+'/8\n')[1].split('\nEND MOONDOG REVIEWED SOFTWARE DATA */')[0]).join(''));
}
function addRecoveryCarriers(h,data){
 const pkg=JSON.parse(h.verifiedPackage.bytes);const serialized=data&&JSON.stringify(data);
 const width=serialized&&Math.ceil(serialized.length/8);
 recoveryCarriers.forEach((name,index)=>{
  let bytes=fs.readFileSync(path.join(__dirname,'..',name));
  if(data){const begin='/* BEGIN MOONDOG REVIEWED SOFTWARE DATA '+(index+1)+'/8\n',end='\nEND MOONDOG REVIEWED SOFTWARE DATA */';
   const text=bytes.toString();bytes=Buffer.from(text.slice(0,text.indexOf(begin)+begin.length)+serialized.slice(index*width,(index+1)*width)+text.slice(text.indexOf(end)));}
  pkg.files.push({path:name,action:'put',sha256:digest(bytes),contentBase64:bytes.toString('base64')});
  pkg.approvedFiles.push(name);h.trustedAllowlist.push(name);
 });
 h.verifiedPackage.bytes=Buffer.from(JSON.stringify(pkg));h.verifiedPackage.sha256=digest(h.verifiedPackage.bytes);
}

test('reviewed software carriers remain inert CSS and consumable by legacy Base64 validators',()=>{
 const legacy=vm.createContext({});
 for(const name of recoveryCarriers){
  const text=fs.readFileSync(path.join(__dirname,'..',name),'utf8');
  const fragment=text.slice(text.indexOf('/* BEGIN MOONDOG REVIEWED SOFTWARE DATA')+2,text.indexOf('END MOONDOG REVIEWED SOFTWARE DATA */'));
  assert.equal(fragment.includes('*/'),false,name);
  // Execute the old repeated-group validator in its own realm: a large entry
  // overflowed this exact expression before the carrier representation.
  legacy.value=Buffer.from(text).toString('base64');
  assert.equal(vm.runInContext('/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)',legacy),true,name);
 }
});

test('embedded recovery software and notices match reviewed distribution authority exactly',()=>{
 const data=reviewedRecoverySoftware();assert.equal(Object.keys(data).length,8);
 const dependencies=JSON.parse(fs.readFileSync(path.join(__dirname,'..','distribution/dependencies.json'),'utf8')).runtimeLibraries;
 const expected={
  [dependencies.jszip.destination]:dependencies.jszip.outputSha256,
  [dependencies.sheetjs.destination]:dependencies.sheetjs.outputSha256,
  [dependencies.pdfjs.mainDestination]:dependencies.pdfjs.mainOutputSha256,
  [dependencies.pdfjs.workerDestination]:dependencies.pdfjs.workerOutputSha256
 };
 for(const [name,payload]of Object.entries(data)){
  const bytes=Buffer.from(payload.contentBase64,'base64');assert.equal(digest(bytes),payload.sha256,name);
  if(payload.required)assert.equal(payload.sha256,expected[name],name);
  else assert.deepEqual(bytes,fs.readFileSync(path.join(__dirname,'..',name)),name);
 }
});

test('a missing vendor directory and all required libraries are rebuilt from reviewed bytes with private data unchanged',async()=>{
 const h=await setup({includeScript:true}),data=reviewedRecoverySoftware(),before=privateFiles(h);
 h.trustedAllowlist.push(...Object.keys(data));addRecoveryCarriers(h);
 const result=await h.run();assert.equal(result.status,'installed',result.reason);
 for(const [name,payload]of Object.entries(data))assert.equal(digest(h.state.files.get('System Files/'+name)),payload.sha256,name);
 assert.ok(h.state.dirs.has('System Files/vendor'));assert.deepEqual(privateFiles(h),before);
 assert.equal(JSON.parse(h.state.files.get('System Files/Workspace/backups/system-updates/'+result.backupName+'/journal.json')).structure.dependencyRepairs,8);
 assert.equal((await h.run()).status,'installed','repeated repairs remain idempotent');
});

test('damaged approved vendor software is replaced while unknown vendor files and existing notices survive',async()=>{
 const h=await setup(),data=reviewedRecoverySoftware();h.trustedAllowlist.push(...Object.keys(data));addRecoveryCarriers(h);
 h.state.dirs.add('System Files/vendor');
 h.state.files.set('System Files/vendor/pdf.min.js',Buffer.from('synthetic damaged library'));
 h.state.files.set('System Files/vendor/unknown.js',Buffer.from('unknown preserved component'));
 h.state.files.set('System Files/vendor/THIRD_PARTY_NOTICES.md',Buffer.from('existing annotated notice'));
 const result=await h.run();assert.equal(result.status,'installed',result.reason);
 assert.equal(digest(h.state.files.get('System Files/vendor/pdf.min.js')),data['vendor/pdf.min.js'].sha256);
 assert.equal(h.state.files.get('System Files/vendor/unknown.js').toString(),'unknown preserved component');
 assert.equal(h.state.files.get('System Files/vendor/THIRD_PARTY_NOTICES.md').toString(),'existing annotated notice');
});

test('corrupt embedded repair bytes fail closed before backups or application mutations',async()=>{
 const h=await setup(),data=reviewedRecoverySoftware();h.trustedAllowlist.push('vendor/jszip.min.js');
 data['vendor/jszip.min.js'].contentBase64=Buffer.from('tampered software recovery data').toString('base64');
 addRecoveryCarriers(h,data);
 const expectedPlan=await context.MoonDogPackagePlan.dryRun({verifiedPackage:h.verifiedPackage,
  appDirectoryHandle:h.app,trustedAllowlist:h.trustedAllowlist});
 const before=copyFiles(h),dirs=new Set(h.state.dirs);
 const result=await context.MoonDogUpdateInstall.apply({verifiedPackage:h.verifiedPackage,
  appDirectoryHandle:h.app,workspaceDirectoryHandle:h.root,trustedAllowlist:h.trustedAllowlist,expectedPlan,confirmed:true});
 assert.equal(result.status,'stopped');assert.match(result.reason,/recovery bytes failed verification/);
 assert.deepEqual(h.state.files,before);assert.deepEqual(h.state.dirs,dirs);
});

test('a missing or unrecognized recovery journal blocks the next update even when legacy listing omits it',async()=>{
 for(const suffix of ['ORPHAN','unknown copy']){
  const h=await setup(),name='MoonDog-Update-Backup-'+suffix;
  h.state.dirs.add('System Files/Workspace/backups/system-updates/'+name);
  const before=copyFiles(h),dirs=new Set(h.state.dirs);const result=await h.run();
  assert.equal(result.status,'recovery-required');assert.match(result.reason,/local recovery review/);
  assert.deepEqual(h.state.files,before);assert.deepEqual(h.state.dirs,dirs);
 }
});

test('pre-update diagnosis counts unknown application components without reading or altering them',async()=>{
 const h=await setup();h.state.files.set('System Files/assets/unknown.js',Buffer.from('unrelated original'));
 h.state.dirs.add('System Files/assets/unknown-directory');
 const result=await h.run();assert.equal(result.status,'installed',result.reason);
 const receipt=JSON.parse(h.state.files.get('System Files/Workspace/backups/system-updates/'+result.backupName+'/journal.json'));
 assert.equal(receipt.structure.diagnosis.unknownPreserved,2);
 assert.equal(h.state.files.get('System Files/assets/unknown.js').toString(),'unrelated original');
});

test('a failed vendor repair restores corrupt original bytes and removes partial new dependencies safely',async()=>{
 const h=await setup(),data=reviewedRecoverySoftware();h.trustedAllowlist.push(...Object.keys(data));addRecoveryCarriers(h);
 h.state.dirs.add('System Files/vendor');const original=Buffer.from('synthetic original damaged library');
 h.state.files.set('System Files/vendor/jszip.min.js',Buffer.from(original));
 h.state.failOnce='System Files/vendor/pdf.min.js';const before=privateFiles(h);
 const result=await h.run();assert.equal(result.status,'rolled-back',result.reason);
 assert.deepEqual(h.state.files.get('System Files/vendor/jszip.min.js'),original);
 assert.equal(h.state.files.has('System Files/vendor/xlsx.full.min.js'),false);
 assert.deepEqual(privateFiles(h),before);
 assert.equal((await h.run()).status,'installed','a new authorized attempt repairs after the identified transient failure');
});
