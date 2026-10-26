"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function extract(startText,endText,label){
  const start=app.indexOf(startText),end=app.indexOf(endText,start+startText.length);
  assert.ok(start>=0&&end>start,"production "+label+" exists");
  return app.slice(start,end);
}
const lockSource=extract("  const sourceLocations = new Map();","  const dailyPickedSources = new Map();","shared source-operation lock");
const ownerSource=extract("  function defaultManagementFor(raw){","  function pruneClosedRecords(","manager source authority helpers");
const reconciliation=extract("  function pruneClosedRecords(","  async function importCdkRepairOrdersDocx(","complete-source Open RO reconciliation");
const saveSource=extract("  async function saveRecord(","  async function closeRo(","Open RO save");

const copy=value=>JSON.parse(JSON.stringify(value));
function harness(){
  const initial={
    updatedAt:"2026-10-26T10:00:00.000Z",
    records:[{
      id:"synthetic-ro-101",ro:"SYN-101",advisor:"Synthetic Advisor",
      sourceStatus:"Waiting Parts",
      sourceFields:{"RO Number":"SYN-101","Source Status":"Waiting Parts"},
      management:{
        status:"Waiting Parts",owner:"Synthetic Previous Owner",
        nextAction:"Check synthetic part",reviewDate:"2026-10-27",
        communication:"Updated",note:"Synthetic prior plan",
        manualAnnotation:"Synthetic annotation",
        ownerAssignmentSource:"manager-confirmed"
      }
    }],
    closedRecords:[],
    source:{fileName:"synthetic-open-ro-before.xlsx",importedAt:"2026-10-26T10:00:00.000Z"}
  };
  let durable=copy(initial);
  let lockTail=Promise.resolve();
  const lockRequests=[];
  let signalPrepared,releaseImport;
  const prepared=new Promise(resolve=>{signalPrepared=resolve;});
  const importGate=new Promise(resolve=>{releaseImport=resolve;});
  const locks={
    request(_name,_options,operation){
      const run=lockTail.then(operation,operation);
      lockTail=run.then(()=>undefined,()=>undefined);
      lockRequests.push(run);
      return run;
    }
  };
  const model={state:copy(initial),root:{synthetic:true},selectedId:"synthetic-ro-101",editOrigin:"table"};
  const ui={
    editNextAction:{value:"Complete synthetic inspection"},
    editReviewDate:{value:"2026-10-28"},
    editStatus:{value:"Being Repaired"},
    editStatusDetail:{value:""},editStatusDetailOther:{value:""},
    editCommunication:{value:"Updated"},
    editOwner:{value:"Synthetic New Owner",dataset:{ownerAssignmentExplicit:"true"}},
    editNote:{value:"Synthetic manager update"},
    editAdminBlocker:{value:""},editAdminTaskDate:{value:""},
    editAdminCloseDate:{value:""},editAdminChangeReason:{value:""},
    editValidation:{hidden:true,textContent:""},
    editDialog:{close(){}}
  };
  const context=vm.createContext({
    model,ui,VERSION:"synthetic",STATE_PATH:["data","current-state.json"],
    RECOVERY_PATH:["data","recovery.json"],navigator:{locks},globalThis:null,
    CLOSED_RO_RETENTION_DAYS:365,COMMUNICATION_STATUSES:["","Updated","Attempted / no response","Needs update","Not needed"],
    canonicalCdkStatus:value=>value||"",defaultManagementFor:()=>({}),
    now:()=>"2026-10-26T10:05:00.000Z",localDateKey:()=>"2026-10-26",
    readJson:async filePath=>{
      if(filePath.join("/")==="data/current-state.json")return copy(durable);
      return null;
    },
    persistState:async value=>{durable=copy(value);},
    writeAuthority:{requireWrite(){}},
    resolveStatusId:()=> "synthetic-being-repaired",
    canonicalReviewStatus:value=>value,
    statusDetailsFor:()=>[],
    normalizedStatusDetail:()=>"",
    statusAllowedForSave:()=>true,
    editValidationError(message){ui.editValidation.hidden=false;ui.editValidation.textContent=message;throw Error(message);},
    visibleRecordIds:()=>["synthetic-ro-101"],visibleFocusIds:()=>["synthetic-ro-101"],
    dailySaveAdditions:null,
    saveState:async(_label)=>{model.state.updatedAt="2026-10-26T10:05:00.000Z";durable=copy(model.state);},
    finishSavedOpenRo:async()=>true,
    recordDiagnostic(){},status(){},renderAll(){},openEdit(){},
    Promise,Map,Set,Object,Array,String,Boolean,JSON,Error,Date,console,
    setTimeout,clearTimeout
  });
  context.globalThis=context;
  vm.runInContext(lockSource+ownerSource+reconciliation+saveSource+
    "\nthis.withLock=withSupervisorWorkbookLock;this.mergeSource=mergeCompleteOpenRoRecords;this.save=saveRecord;",context);
  return{context,model,prepared,releaseImport:()=>releaseImport(),signalPrepared:()=>signalPrepared(),lockRequests,durable:()=>copy(durable),importGate};
}

test("an Open RO save waits for an in-flight complete-source refresh and applies the manager edit to its fresh record",async()=>{
  const h=harness();
  const incoming=[{
    id:"synthetic-ro-101",ro:"SYN-101",advisor:"Synthetic Advisor",
    sourceStatus:"Ready for Review",
    sourceFields:{"RO Number":"SYN-101","Source Status":"Ready for Review","Synthetic Source Revision":"new"},
    cdkOperational:{status:"Ready for Review"}
  }];
  const importing=h.context.withLock(async()=>{
    const merged=h.context.mergeSource(incoming,"2026-10-26T10:04:00.000Z","cdk-repair-orders");
    const next={...h.model.state,updatedAt:"2026-10-26T10:04:00.000Z",
      source:{fileName:"synthetic-open-ro-after.xlsx",importedAt:"2026-10-26T10:04:00.000Z"},
      records:merged.records,closedRecords:merged.closedRecords};
    h.signalPrepared();
    await h.importGate;
    await h.context.persistState(next);
    h.model.state=copy(next);
  });
  await h.prepared;

  const saving=h.context.save({preventDefault(){}});
  await new Promise(resolve=>setTimeout(resolve,0));
  h.releaseImport();
  await importing;
  assert.equal(await saving,true);

  const saved=h.durable();
  assert.equal(saved.source.fileName,"synthetic-open-ro-after.xlsx",
    "the complete-source import remains the durable source authority");
  assert.equal(saved.records[0].sourceFields["Synthetic Source Revision"],"new",
    "fresh imported source fields survive the manager save");
  assert.equal(saved.records[0].management.owner,"Synthetic New Owner",
    "the save applies the manager's edit after it waits for source reconciliation");
  assert.equal(saved.records[0].management.nextAction,"Complete synthetic inspection");
  assert.equal(saved.records[0].management.reviewDate,"2026-10-28");
  assert.equal(saved.records[0].management.manualAnnotation,"Synthetic annotation");
});
