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
const editorState=extract("  let editDraftDirty = false;","  function editValidationError(","Open RO editor state");
const finishSource=extract("  async function finishSavedOpenRo(","  async function saveRecord(","Open RO save completion");
const saveSource=extract("  async function saveRecord(","  async function closeRo(","Open RO save");
const wrapperSource=extract("  const saveBeforeDaily = saveRecord;","  // Paste & Learn uses an ephemeral preview token; only a separately\n  // confirmed commit writes, and it never performs complete-snapshot closure.","Open RO save wrapper");

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
    },{
      id:"synthetic-ro-202",ro:"SYN-202",advisor:"Synthetic Second Advisor",
      sourceStatus:"Waiting Parts",
      sourceFields:{"RO Number":"SYN-202","Source Status":"Waiting Parts"},
      management:{status:"Waiting Parts",owner:"Synthetic Second Owner",nextAction:"Review synthetic second RO",reviewDate:"2026-10-29",communication:"Updated",note:"Synthetic second note"}
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
    editAdminWorkStatus:{value:"unverified"},editAdminPickupStatus:{value:""},
    editAdminPickupContactDate:{value:""},editAdminPickupDate:{value:""},
    editAdminWarrantyStatus:{value:""},editAdminEvidence:{value:""},
    editAdminCoachingStatus:{value:""},editAdminCoachingAction:{value:""},
    editValidation:{hidden:true,textContent:""},
    editDialog:{open:true,closed:0,close(){this.closed++;this.open=false;}}
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
    dailyNotify:()=>{},
    saveState:async(_label)=>{model.state.updatedAt="2026-10-26T10:05:00.000Z";durable=copy(model.state);},
    recordDiagnostic(){},status(){},renderAll(){},
    addHistory:async()=>{},markSupervisorWorkbookStale:async()=>{},
    Promise,Map,Set,Object,Array,String,Boolean,JSON,Error,Date,console,
    setTimeout,clearTimeout
  });
  context.globalThis=context;
  vm.runInContext(lockSource+ownerSource+reconciliation+editorState+finishSource+saveSource+wrapperSource+
    "\nthis.withLock=withSupervisorWorkbookLock;this.mergeSource=mergeCompleteOpenRoRecords;this.save=saveRecord;this.openEditor=openEdit;this.closeEditor=closeEditDialog;this.confirmNav=confirmEditNavigation;this.markDraftDirty=markEditDraftDirty;this.isDirty=()=>editDraftDirty;this.isSaving=()=>model.openRoSaveInFlight;",context);
  return{context,model,ui,prepared,releaseImport:()=>releaseImport(),signalPrepared:()=>signalPrepared(),lockRequests,durable:()=>copy(durable),importGate};
}

test("the production save wrapper preserves submitted RO data while queued behind source refresh",async()=>{
  const h=harness();
  const incoming=[{
    id:"synthetic-ro-101",ro:"SYN-101",advisor:"Synthetic Advisor",
    sourceStatus:"Ready for Review",
    sourceFields:{"RO Number":"SYN-101","Source Status":"Ready for Review","Synthetic Source Revision":"new"},
    cdkOperational:{status:"Ready for Review"}
  },{
    id:"synthetic-ro-202",ro:"SYN-202",advisor:"Synthetic Second Advisor",
    sourceStatus:"Waiting Parts",
    sourceFields:{"RO Number":"SYN-202","Source Status":"Waiting Parts","Synthetic Source Revision":"new"},
    cdkOperational:{status:"Waiting Parts"}
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
  assert.equal(await h.context.save({preventDefault(){}}),false,
    "the production wrapper and underlying save reject a duplicate while the first save is queued");
  assert.equal(h.context.isSaving(),true);
  assert.equal(h.context.openEditor("synthetic-ro-202"),false,
    "switching to another RO is blocked while the submitted save waits for the lock");
  h.context.closeEditor();
  assert.equal(h.context.confirmNav("history"),false,
    "view navigation is blocked while the queued save is active");
  assert.equal(h.model.selectedId,"synthetic-ro-101");
  assert.equal(h.ui.editDialog.closed,0,"the queued save cannot be discarded by closing the editor");
  h.ui.editOwner.value="Synthetic Follow-up Owner";
  h.context.markDraftDirty();
  h.releaseImport();
  await importing;
  assert.equal(await saving,true);

  const saved=h.durable();
  assert.equal(saved.source.fileName,"synthetic-open-ro-after.xlsx",
    "the complete-source import remains the durable source authority");
  assert.equal(saved.records[0].sourceFields["Synthetic Source Revision"],"new",
    "fresh imported source fields survive the manager save");
  assert.equal(saved.records[0].management.owner,"Synthetic New Owner",
    "the save persists the owner value captured when the manager submitted");
  assert.equal(saved.records[0].management.nextAction,"Complete synthetic inspection");
  assert.equal(saved.records[0].management.reviewDate,"2026-10-28");
  assert.equal(saved.records[0].management.manualAnnotation,"Synthetic annotation");
  assert.equal(saved.records[1].management.owner,"Synthetic Second Owner",
    "the second RO remains unchanged during the queued save");
  assert.equal(h.ui.editOwner.value,"Synthetic Follow-up Owner",
    "post-submit edits remain in the editor for a later explicit save");
  assert.equal(h.context.isDirty(),true,"post-submit edits are still marked unsaved");
  assert.equal(h.ui.editDialog.open,true,"the editor remains open for the later draft");
});
