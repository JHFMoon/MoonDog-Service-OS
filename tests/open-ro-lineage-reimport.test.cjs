"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf("  function defaultManagementFor(");
const end=app.indexOf("  async function importCdkRepairOrdersDocx(",start);
assert.ok(start>=0&&end>start,"production complete-source Open RO merge exists");

function productionMerge(state){
  const context={
    model:{state},
    CLOSED_RO_RETENTION_DAYS:730,
    canonicalCdkStatus:value=>value==="Review"?"Ready for Review":value==="Working"?"Being Repaired":""
  };
  const helpers=vm.runInNewContext(app.slice(start,end)+"\n({mergeCompleteOpenRoRecords})",context);
  return helpers.mergeCompleteOpenRoRecords;
}
const copy=value=>JSON.parse(JSON.stringify(value));

test("verified manager edit survives durable reload and complete-source reimport without taking over source fields",()=>{
  const manualState={
    schemaVersion:1,
    updatedAt:"2026-10-26T10:00:00.000Z",
    records:[{
      id:"synthetic-ro-201",
      ro:"SYN-201",
      sourceStatus:"Working",
      advisor:"Synthetic Advisor A",
      technician:"Synthetic Technician A",
      sourceFields:{
        "RO Number":"SYN-201",
        "Source Status":"Working",
        "Advisor":"Synthetic Advisor A",
        "Technician":"Synthetic Technician A"
      },
      management:{
        status:"Waiting Parts",
        owner:"Synthetic Manager Owner",
        nextAction:"Recheck synthetic part ETA",
        reviewDate:"2026-10-27",
        communication:"Updated",
        note:"Synthetic follow-up after verified save",
        manualAnnotation:"Synthetic manager annotation",
        updatedAt:"2026-10-26T10:00:00.000Z"
      }
    }],
    closedRecords:[],
    source:{fileName:"synthetic-open-ro.xlsx",importedAt:"2026-10-26T09:55:00.000Z"}
  };
  // This is the JSON snapshot produced by the verified save/read-back path
  // covered in open-ro-edit-save-roundtrip.test.cjs.
  const durable=JSON.stringify(manualState);
  const afterReload=JSON.parse(durable);
  const merge=productionMerge(afterReload);

  const incoming={
    id:"synthetic-ro-201",
    ro:"SYN-201",
    sourceStatus:"Review",
    advisor:"Synthetic Advisor B",
    technician:"Synthetic Technician B",
    sourceFields:{
      "RO Number":"SYN-201",
      "Source Status":"Review",
      "Advisor":"Synthetic Advisor B",
      "Technician":"Synthetic Technician B",
      "Reported Hours":"2.5"
    },
    management:{
      status:"DO NOT IMPORT",
      owner:"DO NOT IMPORT",
      nextAction:"DO NOT IMPORT",
      reviewDate:"2030-01-01",
      note:"DO NOT IMPORT"
    }
  };
  const merged=merge([incoming],"2026-10-26T11:00:00.000Z","open-ro-xlsx");
  const result=copy(merged.records[0]);

  assert.equal(merged.records.length,1);
  assert.deepEqual(result.management,manualState.records[0].management,
    "reimport retains every saved manager-authoritative field after JSON reload");
  assert.deepEqual(result.sourceFields,incoming.sourceFields,
    "the newer validated report refreshes source-owned fields independently");
  assert.equal(result.sourceStatus,"Review");
  assert.equal(result.advisor,"Synthetic Advisor B");
  assert.equal(result.technician,"Synthetic Technician B");
  assert.equal(result.cdkOperational.status,"Ready for Review",
    "current CDK status follows the new report while manager workflow status remains authoritative");
  assert.equal(result.management.status,"Waiting Parts");
  assert.equal(result.management.owner,"Synthetic Manager Owner");
  assert.equal(result.management.reviewDate,"2026-10-27");

  const reloadedAgain=JSON.parse(JSON.stringify({records:merged.records,closedRecords:merged.closedRecords}));
  const repeatedMerge=productionMerge(reloadedAgain);
  const latestIncoming={...incoming,advisor:"Synthetic Advisor C",
    sourceFields:{...incoming.sourceFields,Advisor:"Synthetic Advisor C"}};
  const next=copy(repeatedMerge([latestIncoming],
    "2026-10-26T12:00:00.000Z","open-ro-xlsx").records[0]);
  assert.deepEqual(next.management,manualState.records[0].management,
    "a second durable reload and reimport cannot replace the manager's saved plan");
  assert.equal(next.sourceFields.Advisor,"Synthetic Advisor C",
    "source provenance continues to follow the latest accepted report");
});


test("verified backup restore keeps manager-owned RO lineage authoritative through the next source reimport",async()=>{
  const restoreSupportStart=app.indexOf("  function sameRestoreValue(");
  const restoreSupportEnd=app.indexOf("  async function inspectInterruptedRestore(",restoreSupportStart);
  const restoreStart=app.indexOf("  async function restoreSelectedBackup()");
  const restoreEnd=app.indexOf("  function latestImportSummary()",restoreStart);
  assert.ok(restoreSupportStart>=0&&restoreSupportEnd>restoreSupportStart&&restoreEnd>restoreStart,
    "production restore preflight, verification, history replacement, and restore entry point exist");
  const restoreSupport=app.slice(restoreSupportStart,restoreSupportEnd);
  const restoreSource=app.slice(restoreStart,restoreEnd);
  const nodeCrypto=require("node:crypto");
  const canonicalPaths=[
    "data/current-state.json","data/settings.json","data/appointments.json",
    "data/advisor-performance.json","data/assign-next.json","data/auto-import.json",
    "data/operational-metrics.json","data/meeting-cycle.json"
  ];
  const encode=value=>new TextEncoder().encode(JSON.stringify(value)+"\n");
  const hash=async bytes=>nodeCrypto.createHash("sha256").update(bytes).digest("hex");
  const manualState={
    schemaVersion:1,updatedAt:"2026-10-26T09:00:00.000Z",
    records:[{
      id:"synthetic-ro-301",ro:"SYN-301",sourceStatus:"Working",
      advisor:"Synthetic Advisor Backup",technician:"Synthetic Technician Backup",
      sourceFields:{"RO Number":"SYN-301","Source Status":"Working","Advisor":"Synthetic Advisor Backup","Technician":"Synthetic Technician Backup"},
      management:{status:"Waiting Parts",owner:"Synthetic Parts Owner",nextAction:"Recheck synthetic delivery",
        reviewDate:"2026-10-27",communication:"Updated",note:"Synthetic backed-up plan",
        manualAnnotation:"Synthetic manager recovery marker",updatedAt:"2026-10-26T08:55:00.000Z"}
    }],
    closedRecords:[],source:{fileName:"synthetic-open-ro-backup.xlsx",importedAt:"2026-10-26T08:50:00.000Z"}
  };
  const liveState={
    schemaVersion:1,updatedAt:"2026-10-26T10:00:00.000Z",
    records:[{id:"synthetic-ro-301",ro:"SYN-301",sourceStatus:"Working",sourceFields:{"RO Number":"SYN-301","Source Status":"Working"},
      management:{status:"Waiting Parts",owner:"Synthetic Parts Owner",nextAction:"Recheck synthetic delivery",reviewDate:"2026-10-27",communication:"Updated",note:"Synthetic backed-up plan",manualAnnotation:"Synthetic manager recovery marker",updatedAt:"2026-10-26T08:55:00.000Z"}}],
    closedRecords:[],source:{fileName:"synthetic-open-ro-live.xlsx",importedAt:"2026-10-26T09:58:00.000Z"}
  };
  const valuesFor=state=>({
    "data/current-state.json":copy(state),
    "data/settings.json":{schemaVersion:4,store:{name:"Synthetic Store"},advisors:{}},
    "data/appointments.json":{days:{}},
    "data/advisor-performance.json":{snapshots:{}},
    "data/assign-next.json":{days:{}},
    "data/auto-import.json":{seen:{}},
    "data/operational-metrics.json":{vir:{snapshots:{}},menu:{snapshots:{}},csi:{surveys:{},imports:[]}},
    "data/meeting-cycle.json":{}
  });
  const makeBackup=async(values,createdAt)=>{
    const payloads=new Map(),entries=[];
    for(const path of canonicalPaths){
      const bytes=encode(values[path]);
      payloads.set(path,bytes);
      entries.push({path,size:bytes.byteLength,sha256:await hash(bytes)});
    }
    return{
      manifest:{createdAt,appVersion:"synthetic",entries},
      values:copy(values),
      zip:{file:name=>({async:async()=>new Uint8Array(payloads.get(name.startsWith("payload/")?name.slice(8):name)||[])})}
    };
  };
  const selected=await makeBackup(valuesFor(manualState),"2026-10-26T08:45:00.000Z");
  const files=new Map();
  for(const[path,value]of Object.entries(valuesFor(liveState)))files.set(path,encode(value));
  files.set("backups/synthetic-selected.zip",new TextEncoder().encode("selected"));
  files.set("backups/synthetic-safety.zip",new TextEncoder().encode("safety"));
  const safety=await makeBackup(Object.fromEntries([...files.entries()]
    .filter(([path])=>canonicalPaths.includes(path))
    .map(([path,bytes])=>[path,JSON.parse(new TextDecoder().decode(bytes))])),
    "2026-10-26T10:00:00.000Z");
  const histories=[];
  const events=[];
  const model={
    state:copy(liveState),settings:{},appointments:{},performance:{},assignNext:{},autoImport:{},
    operationalMetrics:{},meetingCycle:{},recovery:{status:"Ready",lastRestore:null},root:{}
  };
  const historyDirectory={kind:"directory",async *entries(){}};
  const directory=async path=>path.join("/")==="data/history"?historyDirectory:historyDirectory;
  const readFileBytes=async path=>{
    const key=path.join("/");
    if(!files.has(key))throw Object.assign(new Error("Synthetic file missing"),{name:"NotFoundError"});
    return new Uint8Array(files.get(key));
  };
  const writeBytes=async(path,bytes)=>{files.set(path.join("/"),new Uint8Array(bytes));events.push("write:"+path.join("/"));};
  const writeJson=async(path,value)=>writeBytes(path,encode(value));
  const readJson=async(path,fallback=null)=>{
    try{return JSON.parse(new TextDecoder().decode(await readFileBytes(path)));}
    catch(error){if(error.name==="NotFoundError")return fallback;throw error;}
  };
  const directoryFiles=async()=>histories.map(file=>({name:file.name,bytes:new Uint8Array(file.bytes)}));
  const validateBackupBytes=async bytes=>{
    const tag=new TextDecoder().decode(bytes);
    if(tag==="selected")return selected;
    if(tag==="safety")return safety;
    throw new Error("Synthetic backup token is invalid");
  };
  const context=vm.createContext({
    BACKUP_FILES:Object.fromEntries(canonicalPaths.map(path=>[path,()=>null])),
    RECOVERY_PATH:["data","recovery.json"],model,ui:{restoreBackupSelect:{value:"synthetic-selected.zip"}},
    confirm:()=>true,renderRecovery:()=>{},renderAll:()=>{},renderSettings:()=>{},
    scanRecoveryBackups:async()=>{},status:()=>{},recordDiagnostic:()=>{},
    addHistory:async(type,message,details)=>events.push("history:"+type+":"+details.openRos),
    now:()=>"2026-10-26T10:05:00.000Z",
    crypto:nodeCrypto.webcrypto,
    TextEncoder,TextDecoder,Uint8Array,Date,
    readFileBytes,writeBytes,writeJson,readJson,directory,directoryFiles,
    decodeUtf8:bytes=>new TextDecoder().decode(bytes),
    sha256:hash,validateBackupBytes,
    writeValidatedBackup:async()=>({name:"synthetic-safety.zip",path:"backups/synthetic-safety.zip"}),
    writeAuthority:{beginRestore:async()=>{},endRestore:()=>{},disable:()=>{},journaledDelete:async()=>{}},
    maintenanceIO:{remove:async path=>{files.delete(path);events.push("remove:"+path);}},
    physicalWorkspacePath:path=>["System Files","Workspace",...path],
    status:()=>{},console
  });
  vm.runInContext(restoreSupport+"\n"+restoreSource+"\nthis.runRestore=restoreSelectedBackup;",context);

  await context.runRestore();
  const restored=JSON.parse(JSON.stringify(model.state));
  assert.deepEqual(restored.records[0].management,manualState.records[0].management,
    "the real verified restore path rehydrates all manager-owned fields from the selected backup");
  assert.equal(restored.source.fileName,"synthetic-open-ro-backup.xlsx");
  assert.equal(files.has("data/restore-in-progress.json"),false,
    "the restore marker is removed only after verified completion");
  assert.ok(events.some(event=>event.startsWith("history:full-restore-complete:1")),
    "a verified restore records its audit after durable read-back");

  const merge=productionMerge(model.state);
  const incoming={
    id:"synthetic-ro-301",ro:"SYN-301",sourceStatus:"Review",
    advisor:"Synthetic Advisor Current",technician:"Synthetic Technician Current",
    sourceFields:{"RO Number":"SYN-301","Source Status":"Review","Advisor":"Synthetic Advisor Current","Technician":"Synthetic Technician Current"},
    management:{status:"DO NOT IMPORT",owner:"DO NOT IMPORT",nextAction:"DO NOT IMPORT",reviewDate:"2030-01-01",note:"DO NOT IMPORT"}
  };
  const result=copy(merge([incoming],"2026-10-26T10:10:00.000Z","cdk-repair-orders").records[0]);
  assert.deepEqual(result.management,manualState.records[0].management,
    "the first complete-source reimport after recovery retains the selected backup's manager authority");
  assert.deepEqual(result.sourceFields,incoming.sourceFields,
    "the fresh source replaces source-owned fields after recovery");
  assert.equal(result.cdkOperational.status,"Ready for Review");
});
