"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const from=app.indexOf("  function syncSetupSaprOptions()");
const to=app.indexOf("  async function completeGuidedSetup()",from);
assert.ok(from>=0&&to>from,"One-page onboarding production functions are present");
const production=app.slice(from,to);

function harness(opts={}){
  const input=(value="")=>({value,textContent:"",disabled:false,focus(){this.focused=true;}});
  const select=(entries=[{textContent:"Select",value:""}])=>{
    const e=input("");e.options=entries;
    e.replaceChildren=function(...items){this.options=items;this.value=items[0]?.value||"";};
    e.add=function(option){this.options.push(option);};return e;
  };
  const ui={
    setupNav:{hidden:false},setupOverallStatus:input(),setupStoreState:input(),
    setupSaprState:input(),setupCompletionNote:input(),setupAdvisorSummary:input(),
    setupSettingsSummary:{innerHTML:""},
    setupStoreName:input(opts.name||""),setupStoreCode:input(opts.code||""),
    setupStoreBrand:input(opts.brand||""),setupStoreTimeZone:select(),
    storeTimeZone:select([{value:"America/Los_Angeles",textContent:"Pacific"},
      {value:"America/New_York",textContent:"Eastern"}]),
    storeName:input(),storeCode:input(),storeBrand:input(),
    setupStoreSave:input(),setupStoreFeedback:input(),
    setupSaprSource:select(),setupSaprImport:input(),
    setupSaprFeedback:input(),setupSaprRefresh:input(),completeSetup:input(),
    performanceSourceSelect:select()
  };
  ui.setupStoreTimeZone.value=opts.timeZone||"America/Los_Angeles";
  let snap=opts.sapr||null,writes=0,failWrite=Boolean(opts.failWrite),
      imports=[],history=[],renders=0;
  const model={root:opts.noFolder?null:{id:"synthetic-root"},
    settings:{schemaVersion:5,store:{name:opts.storedName||"",
      code:opts.storedCode||"",brand:"",timeZone:opts.storedZone||""},
      advisors:{},setup:{completedAt:"",reopened:false},keepUnrelated:{important:true},
      updatedAt:"before"}};
  const context={
    ui,model,writeAuthority:{canWrite:!opts.denied},
    DEFAULTS:{store:{timeZone:"America/Los_Angeles"}},
    now:()=> "2026-11-07T10:00:00.000Z",
    Option:class{constructor(textContent,value){this.textContent=textContent;this.value=value;}},
    verifiedSaprSnapshot:()=>snap,
    storeIdentityReady:()=>Boolean(model.settings.store.name&&model.settings.store.code&&model.settings.store.timeZone),
    setupRequiredReady:()=>Boolean(model.settings.store.name&&model.settings.store.code&&model.settings.store.timeZone&&snap),
    ensurePhase3Ui:()=>{},renderSetupGates:()=>{renders++;},
    persistSettingsSnapshot:async transform=>{
      const next=JSON.parse(JSON.stringify(model.settings));
      const after=transform(next);
      if(failWrite)throw Error("synthetic disk failure");
      writes++;if(typeof after==="function")after();
    },
    addHistory:async(...args)=>{history.push(args);},
    folderWatch:{busy:false},dailyImportBusy:false,appointmentImportBusy:false,
    postConnectionScanBusy:false,workspaceConnectionBusy:false,workspaceRecoveryBusy:false,
    folderWatchEnabled:()=>false,stopFolderWatch:()=>{},startFolderWatch:()=>{},
    importPerformanceFile:async(...args)=>{
      imports.push(args);
      if(opts.importFailure)throw Error("synthetic invalid SAPR");
      snap={periodEnd:"2026-11-06"};
    }
  };
  const fn=Function("context",
    "with(context){let setupIdentityDirty=false,setupIdentityRevision=0,setupSaprOptionsSignature='';"+
      production+
      "return {renderSetup,saveSetupStoreIdentity,syncSetupSaprOptions,importSetupSapr,setDirty:x=>{setupIdentityDirty=x;setupIdentityRevision++;}};}");
  const methods=fn(context);
  return {ui,model,context,methods,imports,history,setSapr:v=>{snap=v;},
    setFailure:x=>{failWrite=x;},writes:()=>writes,renders:()=>renders};
}
test("one page contains only two required foundations, with labeled fields and inline import",()=>{
  const start=app.indexOf("  // One-page onboarding:");
  const end=app.indexOf("  function syncSetupSaprOptions()",start);
  const html=app.slice(start,end);
  for(const id of ["setupStoreName","setupStoreCode","setupStoreTimeZone",
      "setupSaprSource","setupSaprRefresh","setupSaprImport","completeSetup"])
    assert.ok(html.includes("id=\\\""+id+"\\\""),"missing "+id);
  assert.ok(html.includes("Get MoonDog ready"));
  assert.ok(html.includes("Everything else can be adjusted later"));
  assert.ok(!html.includes("setupStep(10"),"no ten-step navigation");
  assert.ok(!html.includes("data-setup-view"),"no cross-screen setup jumps");
});
test("initial screen requires the store and valid SAPR, not optional sources",()=>{
  const h=harness();
  h.methods.renderSetup();
  assert.equal(h.ui.completeSetup.disabled,true);
  assert.equal(h.ui.setupStoreState.textContent,"Required");
  assert.equal(h.ui.setupSaprState.textContent,"Required");
  assert.match(h.ui.setupCompletionNote.textContent,/Save your dealership/);
});
test("one-page store save retains other settings and commits only after durable write",async()=>{
  const h=harness({name:"Synthetic Motors",code:"7007",brand:"Ford"});
  await h.methods.saveSetupStoreIdentity();
  assert.equal(h.model.settings.store.name,"Synthetic Motors");
  assert.equal(h.model.settings.store.code,"7007");
  assert.equal(h.model.settings.store.brand,"Ford");
  assert.equal(h.model.settings.store.timeZone,"America/Los_Angeles");
  assert.equal(h.model.settings.keepUnrelated.important,true);
  assert.equal(h.writes(),1);
  assert.equal(h.history.length,1);
  assert.match(h.ui.setupStoreFeedback.textContent,/saved and verified/);
});
test("invalid store number cannot write and indicates the exact field",async()=>{
  const h=harness({name:"Synthetic Motors",code:""});
  await h.methods.saveSetupStoreIdentity();
  assert.equal(h.writes(),0);
  assert.match(h.ui.setupStoreFeedback.textContent,/store number/);
  assert.equal(h.ui.setupStoreCode.focused,true);
});
test("invalid time zone cannot silently set store authority",async()=>{
  const h=harness({name:"Synthetic Motors",code:"7007",timeZone:"Mars/Olympus"});
  await h.methods.saveSetupStoreIdentity();
  assert.equal(h.writes(),0);
  assert.match(h.ui.setupStoreFeedback.textContent,/valid time zone/);
});
test("durable write failure preserves original store and typed inputs",async()=>{
  const h=harness({name:"Synthetic New",code:"555",storedName:"Old Synthetic",storedCode:"111",failWrite:true});
  await assert.rejects(h.methods.saveSetupStoreIdentity(),/synthetic disk failure/);
  assert.equal(h.model.settings.store.name,"Old Synthetic");
  assert.equal(h.ui.setupStoreName.value,"Synthetic New");
  assert.match(h.ui.setupStoreFeedback.textContent,/Could not save/);
});
test("no write permission blocks onboarding identity changes",async()=>{
  const h=harness({name:"Synthetic",code:"100",denied:true});
  await h.methods.saveSetupStoreIdentity();
  assert.equal(h.writes(),0);
  assert.match(h.ui.setupStoreFeedback.textContent,/Restore folder access/);
});
test("existing imported store identity cannot be silently changed",async()=>{
  const h=harness({name:"Other Store",code:"999",storedName:"Original Store",storedCode:"100",
    sapr:{periodEnd:"2026-11-06"}});
  await h.methods.saveSetupStoreIdentity();
  assert.equal(h.writes(),0);
  assert.equal(h.model.settings.store.code,"100");
  assert.match(h.ui.setupStoreFeedback.textContent,/verified store review/);
});
test("report selection stays on page and imports via guarded existing parser while keeping original",async()=>{
  const h=harness({storedName:"Synthetic Motors",storedCode:"7007",storedZone:"America/Los_Angeles"});
  h.ui.performanceSourceSelect.options=[
    {value:"",textContent:"Select XLSX"},
    {value:"SAPR-2026-11-06.xlsx",textContent:"SAPR-2026-11-06.xlsx"}];
  h.methods.syncSetupSaprOptions();
  h.ui.setupSaprSource.value="SAPR-2026-11-06.xlsx";
  await h.methods.importSetupSapr();
  assert.equal(h.imports.length,1);
  assert.deepEqual(h.imports[0],["SAPR-2026-11-06.xlsx",false,null,true]);
  assert.equal(h.context.dailyImportBusy,false);
  assert.match(h.ui.setupSaprFeedback.textContent,/imported and verified/);
  assert.equal(h.ui.completeSetup.disabled,false);
});
test("SAPR import stays blocked with no saved store identity",async()=>{
  const h=harness();
  h.ui.setupSaprSource.value="SAPR.xlsx";
  await h.methods.importSetupSapr();
  assert.equal(h.imports.length,0);
  assert.match(h.ui.setupSaprFeedback.textContent,/First save/);
});
test("SAPR invalid content never becomes verified setup",async()=>{
  const h=harness({storedName:"Synthetic Motors",storedCode:"7007",
    storedZone:"America/Los_Angeles",importFailure:true});
  h.ui.setupSaprSource.value="wrong.xlsx";
  await assert.rejects(h.methods.importSetupSapr(),/synthetic invalid SAPR/);
  assert.equal(h.ui.completeSetup.disabled,true);
  assert.equal(h.context.dailyImportBusy,false);
  assert.match(h.ui.setupSaprFeedback.textContent,/wasn't saved/);
});
test("dirty store edits block import and completion until saved",()=>{
  const h=harness({storedName:"Synthetic Motors",storedCode:"7007",
    storedZone:"America/Los_Angeles",sapr:{periodEnd:"2026-11-06"}});
  h.methods.setDirty(true);h.methods.renderSetup();
  assert.equal(h.ui.completeSetup.disabled,true);
  assert.equal(h.ui.setupSaprImport.disabled,true);
  assert.match(h.ui.setupCompletionNote.textContent,/Save your dealership changes/);
});
test("one-page render never overwrites unsaved store text",()=>{
  const h=harness({storedName:"Original Store",storedCode:"7007"});
  h.ui.setupStoreName.value="Unsaved user edit";
  h.methods.setDirty(true);h.methods.renderSetup();
  assert.equal(h.ui.setupStoreName.value,"Unsaved user edit");
});
test("existing production importer suppresses optional original deletion on setup import",()=>{
  assert.match(app,/keepOriginalOnSuccess = false/);
  assert.match(app,/!keepOriginalOnSuccess && !dailyPickedSources\.has\(name\)/);
});