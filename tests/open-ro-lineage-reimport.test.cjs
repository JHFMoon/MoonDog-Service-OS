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
        status:"Being Repaired",
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
  assert.equal(result.management.status,"Being Repaired");
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
  const historyReplaceStart=app.indexOf("  async function replaceHistoryFromBackup(");
  const historyReplaceEnd=app.indexOf("  async function restoreSelectedBackup()",historyReplaceStart);
  const restoreStart=app.indexOf("  async function restoreSelectedBackup()");
  const restoreEnd=app.indexOf("  function latestImportSummary()",restoreStart);
  assert.ok(restoreSupportStart>=0&&restoreSupportEnd>restoreSupportStart&&historyReplaceStart>=0&&historyReplaceEnd>historyReplaceStart&&restoreEnd>restoreStart,
    "production restore preflight, verification, history replacement, and restore entry point exist");
  const restoreSupport=app.slice(restoreSupportStart,restoreSupportEnd);
  const historyReplaceSource=app.slice(historyReplaceStart,historyReplaceEnd);
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
      management:{status:"Being Repaired",owner:"Synthetic Parts Owner",nextAction:"Recheck synthetic delivery",
        reviewDate:"2026-10-27",communication:"Updated",note:"Synthetic backed-up plan",
        manualAnnotation:"Synthetic manager recovery marker",updatedAt:"2026-10-26T08:55:00.000Z"}
    }],
    closedRecords:[],source:{fileName:"synthetic-open-ro-backup.xlsx",importedAt:"2026-10-26T08:50:00.000Z"}
  };
  const liveState={
    schemaVersion:1,updatedAt:"2026-10-26T10:00:00.000Z",
    records:[{id:"synthetic-ro-301",ro:"SYN-301",sourceStatus:"Working",sourceFields:{"RO Number":"SYN-301","Source Status":"Working"},
      management:{status:"Being Repaired",owner:"Synthetic Parts Owner",nextAction:"Recheck synthetic delivery",reviewDate:"2026-10-27",communication:"Updated",note:"Synthetic backed-up plan",manualAnnotation:"Synthetic manager recovery marker",updatedAt:"2026-10-26T08:55:00.000Z"}}],
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
  vm.runInContext(restoreSupport+"\n"+historyReplaceSource+"\n"+restoreSource+"\nthis.runRestore=restoreSelectedBackup;",context);

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

  // Exercise the production edit dialog after verified restore and source reimport.
  // The report identity remains visible beside manager-owned workflow fields.
  const identityStart=app.indexOf("  function sourceFieldValue(");
  const identityEnd=app.indexOf("\n  function sourceAdvisorIdentity(",identityStart);
  const managerStatusStart=app.indexOf("  function statusForRecord(record){");
  const managerStatusEnd=app.indexOf("\n  function resolveStatusId(",managerStatusStart);
  const editStart=app.indexOf("  function openEdit(");
  const editEnd=app.indexOf("\n  const openEditWithoutCloseoutEvidence",editStart);
  assert.ok(identityStart>=0&&identityEnd>identityStart&&managerStatusStart>=0&&managerStatusEnd>managerStatusStart&&editStart>=0&&editEnd>editStart,
    "production source identity, management status, and RO edit dialog exist");

  const uiField=()=>({value:"",textContent:"",hidden:false,dataset:{},options:[],focus(){},append(){},replaceChildren(){},});
  const recordSummary={children:[],replaceChildren(){this.children=[];},append(item){this.children.push(item);}};
  const editUi={
    dialogTitle:uiField(),editPosition:uiField(),editClarification:uiField(),editValidation:uiField(),
    recordSummary,editStatus:uiField(),editOwner:uiField(),editNextAction:uiField(),editReviewDate:uiField(),
    editAdminBlocker:uiField(),editAdminTaskDate:uiField(),editAdminCloseDate:uiField(),
    editAdminChangeReason:uiField(),editCommunication:uiField(),editNote:uiField(),
    editCdkStatusIndicator:uiField(),
    editDialog:{open:false,showModal(){this.open=true;}}
  };
  const editContext=vm.createContext({
    model:{state:{records:[result]},openRoSaveInFlight:false},
    ui:editUi,
    document:{createElement:()=>uiField()},
    visibleFocusIds:()=>[],
    visibleRecordIds:()=>[result.id],
    clarificationFor:()=>"",
    statusById:()=>null,
    currentCdkReviewStatus:record=>record.cdkOperational?.status||"",
    selectableStatusesFor:()=>["Being Repaired"],
    populateSelect:(select,values)=>{select.options=values.map(value=>({value,dataset:{},remove(){}}));},
    updateStatusDetailEditor:()=>{},
    restoreSelectValue:(select,value)=>{select.value=value;},
    normalizeCommunication:value=>value,
    COMMUNICATION_STATUSES:[],
    technicianDirectory:()=>({}),
    normalizedPerson:value=>String(value??"").trim().toLowerCase(),
    sourceFieldValue:(fields,aliases)=>Object.entries(fields||{}).find(([key,value])=>aliases.map(v=>String(v).toLowerCase()).includes(key.toLowerCase())&&String(value??"").trim())?.[1]||"",
    ALIASES:{technician:["technician"],technicianCode:["technician code"]},
    resolveTechnicianName:()=>null,
    text:value=>String(value??""),
    requestAnimationFrame:callback=>callback()
  });
  vm.runInNewContext([
        const norm = (v) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const FRESH_MANAGEMENT_STATUSES = ["Awaiting Assignment", "Work in Progress", "Parts Estimate", "Pending Authorization", "Awaiting Technician Attention", "Being Repaired", "Ready for Review"];
    function canonicalReviewStatus(value){const key=norm(value);return FRESH_MANAGEMENT_STATUSES.find((item)=>norm(item)===key)||"";}
    function reviewedCanonicalStatus(record){return record?.management?.updatedAt?canonicalReviewStatus(statusById(record.management.statusId)?.name||record.management.status):"";}
    function cdkStatusIndicator(record){const current=canonicalReviewStatus(record?.cdkOperational?.status);if(record?.cdkOperational?.stale&&current)return{kind:"stale",text:"Last confirmed CDK: "+current+" · not confirmed by latest import"};const reviewed=reviewedCanonicalStatus(record);if(current&&reviewed&&current!==reviewed)return{kind:"delta",text:"CDK now: "+current};return null;}
    function renderCdkStatusIndicator(record){const indicator=cdkStatusIndicator(record);ui.editCdkStatusIndicator.hidden=!indicator;ui.editCdkStatusIndicator.className="cdk-status-indicator "+(indicator?.kind||"");ui.editCdkStatusIndicator.textContent=indicator?.text||"";},
    app.slice(identityStart,identityEnd),
    app.slice(managerStatusStart,managerStatusEnd),
    app.slice(editStart,editEnd),
    "this.openRecoveredRecord=openEdit;"
  ].join("\n"),editContext);
  assert.equal(editContext.openRecoveredRecord(result.id),true);
  assert.equal(editUi.editStatus.value,"Being Repaired",
    "the edit screen displays the recovered manager-authoritative status");
  assert.equal(editUi.editOwner.value,"Synthetic Parts Owner");
  assert.equal(editUi.editNextAction.value,"Recheck synthetic delivery");
  assert.equal(editUi.editReviewDate.value,"2026-10-27");
  assert.equal(editUi.editNote.value,"Synthetic backed-up plan");
  assert.equal(editUi.editCdkStatusIndicator.hidden,false,
    "the production indicator remains visible when the current report differs from the saved manager status");
  assert.equal(editUi.editCdkStatusIndicator.textContent,"CDK now: Ready for Review",
    "the production indicator displays the current report status separately from the saved manager status");
  assert.ok(editUi.recordSummary.children.some(item=>item.textContent==="Technician (reported source): Synthetic Technician Current"),
    "the edit screen retains the latest source-reported technician after recovery");
});
