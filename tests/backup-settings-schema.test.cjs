"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto");
const source=fs.readFileSync(path.join(__dirname,"../assets/app.js"),"utf8");
function segment(start,end){
  const from=source.indexOf(start),to=source.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,start);
  return source.slice(from,to);
}
// In-memory archive adapter: these tests exercise production state validation
// and backup read-back, without installing another ZIP implementation in CI.
class Archive {
  constructor(){this.parts={};}
  file(name,bytes){
    if(arguments.length===2){this.parts[name]=Buffer.from(bytes);return this;}
    const part=this.parts[name];
    return part?{async:async type=>type==="string"?part.toString():new Uint8Array(part)}:null;
  }
  async generateAsync(){return Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(this.parts).map(([name,bytes])=>[name,bytes.toString("base64")]))));}
  static async loadAsync(bytes){const archive=new Archive();for(const [name,encoded]of Object.entries(JSON.parse(Buffer.from(bytes).toString())))archive.parts[name]=Buffer.from(encoded,"base64");return archive;}
}
function harness(){
  const context=vm.createContext({JSZip:Archive,TextEncoder,TextDecoder,Uint8Array,
    crypto:crypto.webcrypto,FRESH_MANAGEMENT_STATUSES:[],statusRecord:()=>{},LEGACY_ADVISORS:{},SETUP_SOURCE_DEFAULTS:{},
    now:()=>"2026-10-19T12:00:00.000Z",VERSION:"synthetic",BUILD_DATE:"2026-10-19"});
  vm.runInContext(segment("  const DEFAULTS =", "  const supervisorAdvisorCodes =")+"\nthis.defaults=DEFAULTS;",context);
  context.model={settings:structuredClone(context.defaults),state:{records:[{id:"synthetic-ro",management:{nextAction:"Preserve synthetic manager action"}}]},
    appointments:{days:{}},performance:{snapshots:{}},assignNext:{days:{}},autoImport:{seen:{}},operationalMetrics:{csi:{}},meetingCycle:{metrics:{}}};
  vm.runInContext(segment("  const BACKUP_FILES=", "  function failedReportArchivePath("),context);
  context.directoryFiles=async()=>[];
  return context;
}

test("backup validator accepts current settings and existing schema-four backups",()=>{
  const context=harness();
  context.validateDurableObject("data/settings.json",context.model.settings);
  context.validateDurableObject("data/settings.json",{...context.model.settings,schemaVersion:4});
});

test("backup validator still rejects unsupported or missing settings versions",()=>{
  const context=harness();
  for(const schemaVersion of [undefined,null,0,3,context.defaults.schemaVersion+1,"invalid"])
    assert.throws(()=>context.validateDurableObject("data/settings.json",{schemaVersion}),/Settings schema is not compatible/);
});

test("current-settings whole-state backup validates and preserves operational values",async()=>{
  const context=harness(),before=JSON.stringify(context.model);
  const backup=await context.createBackupBytes("Synthetic current-settings backup");
  const restored=await context.validateBackupBytes(backup.bytes);
  assert.equal(restored.manifest.settingsSchema,context.defaults.schemaVersion);
  assert.equal(restored.manifest.entries.length,8);
  assert.equal(restored.values["data/settings.json"].schemaVersion,context.defaults.schemaVersion);
  assert.equal(JSON.stringify(restored.values["data/current-state.json"]),JSON.stringify(context.model.state));
  assert.equal(JSON.stringify(context.model),before,"backup generation must not mutate operational state");
});
