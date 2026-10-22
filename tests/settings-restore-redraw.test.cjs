"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function slice(start,end){const a=app.indexOf(start),b=app.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return app.slice(a,b);}
const advisorRender=slice("  function renderAdvisorSettings(","  function renderSettings(");
const settingsRender=slice("  function renderSettings(","  function readSettingsInputs(");
const lifecycle=slice("  async function updateAdvisorLifecycle(","  function ensurePhase2SettingsUi(");
const settingsPersistence=slice("let settingsAutosaveTimer=null; let settingsAutosaveRevision=0; let settingsWriteChain=Promise.resolve();","  async function updateAdvisorLifecycle(");
const worksheetOrderRender=slice("  function renderSupervisorWorksheetOrder()","  function renderPhase2Settings()");
const localFuture=slice("  async function updateLocalFuture(","  async function recordRefreshLearning(");
const guidedSetup=slice("  async function completeGuidedSetup()","  function openSetupIfRequired(");
const meetingSave=slice("  async function saveMeetingVoice(pin) {","  function renderAdvisorSettings(");
function production(context){const factory=Function("context",`with(context){ return (async()=>{ ${settingsPersistence} ${advisorRender} ${worksheetOrderRender} ${lifecycle} ${localFuture} ${meetingSave} ${guidedSetup} return {updateAdvisorLifecycle,markAdvisorSetupReviewed,persistSettingsSnapshot,renderAdvisorSettings,renderSupervisorWorksheetOrder,updateLocalFuture,reconcileSaprAdvisors,saveSettingsAutosave,queueSettingsAutosave,saveMeetingVoice,completeGuidedSetup,reopenGuidedSetup}; })(); }`);return factory(context);}

function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function element(){const classes=[];return{dataset:{},children:[],classes,textContent:"",classList:{add(name){classes.push(name);}},append(...items){this.children.push(...items);},appendChild(item){this.children.push(item);}};}

test("advisor restore redraw preserves an unrelated settings edit during autosave debounce",async()=>{
  const write=deferred();
  const advisor={number:"101",name:"Synthetic Advisor",active:false,removed:true,setupRequired:true,participation:{openRo:true,supervisorWorkbook:true}};
  const model={settings:{advisors:{"101":advisor},updatedAt:"before"}};
  const pendingInput={value:"persisted store name"};
  let wholeSettingsRenders=0;
  const ui={advisorSettingsList:{children:[],replaceChildren(){this.children=[];},append(item){this.children.push(item);}},worksheetOrderSettings:{children:[],replaceChildren(){this.children=[];},append(item){this.children.push(item);}}};
  const document={createElement:()=>element(),createTextNode:value=>({textContent:value})};
  const context={SETTINGS_PATH:["settings.json"],model,ui,document,ensurePhase2SettingsUi:()=>{},supervisorAdvisorCodes:()=>["101"],advisorShownInSection:()=>true,now:()=>"synthetic-now",
    writeJson:()=>write.promise,writeAuthority:{canWrite:true},renderAll:()=>{},renderSetup:()=>{},validAdvisorIdentity:()=>true,advisorDisplayName:(code,source)=>source.displayName||source.name,addHistory:async()=>{},
    renderSettings:()=>{wholeSettingsRenders++;pendingInput.value=model.settings.store?.name||"";}};
  const {updateAdvisorLifecycle:update}=await production(context);
  const restoring=update("101","restore");
  pendingInput.value="synthetic edit made while restore write is pending";
  write.resolve();
  await restoring;
  assert.equal(wholeSettingsRenders,0,"advisor lifecycle must not rebuild every settings input");
  assert.equal(pendingInput.value,"synthetic edit made while restore write is pending");
  assert.equal(advisor.removed,false);
  assert.equal(ui.advisorSettingsList.children.length,1);
  const row=ui.advisorSettingsList.children[0];
  assert.ok(row.classes.includes("setup-attention"));
  assert.ok(row.children.some(child=>child.dataset?.advisorSetupReviewed==="101"&&child.textContent==="Mark setup reviewed"));
  assert.equal(ui.worksheetOrderSettings.children.length,1,"restoring a workbook participant refreshes worksheet ordering");
  assert.equal(ui.worksheetOrderSettings.children[0].children[0].textContent,"Synthetic Advisor · 101");
  assert.equal(ui.worksheetOrderSettings.children[0].children[1].children.length,2,"restored worksheet has current ordering controls");
});

test("full settings render delegates advisor controls to the scoped redraw helper",()=>{
  assert.match(settingsRender,/renderAdvisorSettings\(\);/);
  assert.doesNotMatch(settingsRender,/advisorSettingsList\.replaceChildren\(\)/);
});

test("failed setup review save restores the pending action and permits retry",async()=>{
  const advisor={number:"101",name:"Synthetic Advisor",active:true,removed:false,setupRequired:true,participation:{openRo:true}};
  const model={settings:{advisors:{"101":advisor},updatedAt:"before"},root:{}};
  const ui={advisorSettingsList:{children:[],replaceChildren(){this.children=[];},append(item){this.children.push(item);}},settingsSaveStatus:{dataset:{},textContent:""}};
  const document={createElement:()=>element(),createTextNode:value=>({textContent:value})};
  const context={SETTINGS_PATH:["settings.json"],model,ui,document,writeAuthority:{canWrite:true},advisorShownInSection:()=>true,now:()=>"synthetic-now",
    writeJson:async()=>{throw new Error("synthetic write denied");},renderAll:()=>{},renderSetup:()=>{},validAdvisorIdentity:()=>true,advisorDisplayName:(code,source)=>source.displayName||source.name,addHistory:async()=>{}};
  const {markAdvisorSetupReviewed}=await production(context);
  await assert.rejects(markAdvisorSetupReviewed("101"),/synthetic write denied/);
  assert.equal(advisor.setupRequired,true,"failed durable writes must retain the review requirement");
  assert.equal(model.settings.updatedAt,"before","failed writes must roll back the in-memory revision");
  assert.equal(ui.settingsSaveStatus.dataset.saveState,"error");
  const row=ui.advisorSettingsList.children[0];
  assert.ok(row.children.some(child=>child.dataset?.advisorSetupReviewed==="101"),"the action must remain available for retry");
});

test("setup review and settings autosave serialize immutable snapshots",async()=>{
  const pending=deferred();
  const advisor={number:"101",name:"Synthetic Advisor",active:true,removed:false,setupRequired:true,participation:{openRo:true}};
  const model={settings:{advisors:{"101":advisor},store:{name:"Initial synthetic"},updatedAt:"before"},root:{}};
  const writes=[];
  const ui={advisorSettingsList:{children:[],replaceChildren(){this.children=[];},append(item){this.children.push(item);}},settingsSaveStatus:{dataset:{},textContent:""}};
  const document={createElement:()=>element(),createTextNode:value=>({textContent:value})};
  const context={SETTINGS_PATH:["settings.json"],model,ui,document,writeAuthority:{canWrite:true},advisorShownInSection:()=>true,now:()=>"synthetic-now",
    writeJson:async(_path,value)=>{writes.push(value);if(writes.length===1)await pending.promise;},renderAll:()=>{},renderSetup:()=>{},validAdvisorIdentity:()=>true,advisorDisplayName:(code,source)=>source.displayName||source.name,addHistory:async()=>{}};
  const {markAdvisorSetupReviewed,persistSettingsSnapshot}=await production(context);
  const reviewing=markAdvisorSetupReviewed("101");
  await Promise.resolve();
  model.settings.store.name="synthetic edit during first write";
  const nextSave=persistSettingsSnapshot();
  model.settings.store.name="later synthetic edit before second write";
  pending.resolve();
  await reviewing;
  await nextSave;
  assert.equal(advisor.setupRequired,false,"a successful durable review remains committed");
  assert.equal(writes.length,2);
  assert.equal(writes[0].advisors["101"].setupRequired,false);
  assert.equal(writes[0].store.name,"Initial synthetic","the in-flight write must retain its immutable snapshot");
  assert.equal(writes[1].advisors["101"].setupRequired,false);
  assert.equal(writes[1].store.name,"later synthetic edit before second write");
});

test("failed review write cannot be committed by an autosave queued before the review",async()=>{
  const first=deferred();
  const advisor={number:"101",name:"Synthetic Advisor",active:true,removed:false,setupRequired:true,participation:{openRo:true}};
  const model={settings:{advisors:{"101":advisor},store:{name:"Synthetic"},updatedAt:"before"},root:{}};
  const writes=[];
  const ui={advisorSettingsList:{children:[],replaceChildren(){this.children=[];},append(item){this.children.push(item);}},settingsSaveStatus:{dataset:{},textContent:""}};
  const document={createElement:()=>element(),createTextNode:value=>({textContent:value})};
  const context={SETTINGS_PATH:["settings.json"],model,ui,document,writeAuthority:{canWrite:true},advisorShownInSection:()=>true,validAdvisorIdentity:()=>true,
    advisorDisplayName:(code,source)=>source.displayName||source.name,now:()=>"synthetic-now",renderAll:()=>{},renderSetup:()=>{},addHistory:async()=>{},
    writeJson:async(_path,value)=>{writes.push(JSON.parse(JSON.stringify(value)));if(writes.length===1)await first.promise;if(writes.length===3)throw new Error("synthetic review write denied");}};
  const {markAdvisorSetupReviewed,persistSettingsSnapshot}=await production(context);
  const inFlight=persistSettingsSnapshot();
  await Promise.resolve();
  const queuedAutosave=persistSettingsSnapshot();
  const review=markAdvisorSetupReviewed("101");
  first.resolve();
  await inFlight;
  await queuedAutosave;
  await assert.rejects(review,/synthetic review write denied/);
  assert.equal(writes.length,3);
  assert.equal(writes[1].advisors["101"].setupRequired,true,"autosave requested before review must not capture optimistic review state");
  assert.equal(writes[2].advisors["101"].setupRequired,false,"the failed review attempt itself is isolated");
  assert.equal(advisor.setupRequired,true,"failed write must keep the review action available");
  assert.ok(ui.advisorSettingsList.children[0].children.some(child=>child.dataset?.advisorSetupReviewed==="101"));
});

test("local settings updates serialize after an in-flight advisor review",async()=>{
  const pending=deferred();
  const advisor={number:"101",name:"Synthetic Advisor",active:true,removed:false,setupRequired:true,participation:{openRo:true}};
  const model={settings:{advisors:{"101":advisor},future:{sourceLocation:"old synthetic path"},updatedAt:"before"},root:{}};
  const writes=[];
  let persisted=null;
  const ui={settingsSaveStatus:{dataset:{},textContent:""},advisorSettingsList:{children:[],replaceChildren(){this.children=[];},append(item){this.children.push(item);}}};
  const document={createElement:()=>element(),createTextNode:value=>({textContent:value})};
  const context={SETTINGS_PATH:["settings.json"],model,ui,document,advisorShownInSection:()=>true,validAdvisorIdentity:()=>true,
    advisorDisplayName:(code,source)=>source.displayName||source.name,writeAuthority:{canWrite:true,requireWrite(){}},now:()=> "synthetic-now",
    writeJson:async(_path,value)=>{const snapshot=JSON.parse(JSON.stringify(value));writes.push(snapshot);if(writes.length===1)await pending.promise;persisted=snapshot;},
    addHistory:async()=>{},renderAdvisorSettings:()=>{},renderSetup:()=>{},renderAll:()=>{}};
  const {markAdvisorSetupReviewed,updateLocalFuture}=await production(context);
  const review=markAdvisorSetupReviewed("101");
  await Promise.resolve();
  const futureSave=updateLocalFuture(future=>{future.sourceLocation="new synthetic path";});
  pending.resolve();
  await Promise.all([review,futureSave]);
  assert.equal(writes.length,2,"private settings writes must share one serialized queue");
  assert.equal(writes[0].advisors["101"].setupRequired,false);
  assert.equal(writes[1].advisors["101"].setupRequired,false,"later settings save must preserve the committed advisor review");
  assert.equal(writes[1].future.sourceLocation,"new synthetic path");
  assert.equal(persisted.future.sourceLocation,"new synthetic path","the later queued snapshot must be the durable final write");
  assert.equal(model.settings.future.sourceLocation,"new synthetic path");
  assert.equal(model.settings.advisors["101"].setupRequired,false);
});
test("scoped advisor redraw keeps configured display names and excludes invalid identities",async()=>{
  const valid={number:"101",name:"Raw Source Name",displayName:"Configured Display",active:true,removed:false,setupRequired:false,participation:{openRo:true}};
  const invalid={number:"summary",name:"Summary Total",displayName:"Should stay hidden",active:true,removed:false,setupRequired:true,participation:{openRo:true}};
  const model={settings:{advisors:{"101":valid,"summary":invalid}}};
  const ui={advisorSettingsList:{children:[],replaceChildren(){this.children=[];},append(item){this.children.push(item);}}};
  const context={SETTINGS_PATH:["settings.json"],model,ui,document:{createElement:()=>element(),createTextNode:value=>({textContent:value})},
    advisorShownInSection:()=>true,validAdvisorIdentity:(code,name)=>/^[0-9]+$/.test(code)&&!/^(?:0+|summary|total)/i.test(name||""),
    advisorDisplayName:(code,source)=>source.displayName||source.name,now:()=>"synthetic-now",writeJson:async()=>{},renderAll:()=>{},renderSetup:()=>{},addHistory:async()=>{}};
  const {renderAdvisorSettings}=await production(context);
  renderAdvisorSettings();
  const row=ui.advisorSettingsList.children[0];
  assert.equal(ui.advisorSettingsList.children.length,1);
  assert.equal(row.children[0].children[0].textContent,"Configured Display");
  assert.equal(row.dataset.advisorSetting,"101");
});

test("advisor restore serializes after an in-flight setup review",async()=>{
  const pending=deferred();
  const advisor={number:"101",name:"Synthetic Advisor",displayName:"Synthetic Advisor",active:false,removed:true,setupRequired:true,participation:{openRo:true,supervisorWorkbook:true}};
  const model={settings:{advisors:{"101":advisor},store:{name:"Synthetic"},updatedAt:"before"},root:{}};
  const writes=[];
  const ui={advisorSettingsList:{children:[],replaceChildren(){this.children=[];},append(item){this.children.push(item);}},worksheetOrderSettings:{children:[],replaceChildren(){this.children=[];},append(item){this.children.push(item);}},settingsSaveStatus:{dataset:{},textContent:""}};
  const context={SETTINGS_PATH:["settings.json"],model,ui,document:{createElement:()=>element(),createTextNode:value=>({textContent:value})},
    writeAuthority:{canWrite:true},ensurePhase2SettingsUi:()=>{},supervisorAdvisorCodes:()=>["101"],advisorShownInSection:()=>true,validAdvisorIdentity:()=>true,advisorDisplayName:(code,source)=>source.displayName||source.name,
    now:()=>"synthetic-now",renderAll:()=>{},renderSetup:()=>{},addHistory:async()=>{},
    writeJson:async(_path,value)=>{writes.push(JSON.parse(JSON.stringify(value)));if(writes.length===1)await pending.promise;}};
  const {markAdvisorSetupReviewed,updateAdvisorLifecycle}=await production(context);
  const review=markAdvisorSetupReviewed("101");
  await Promise.resolve();
  const restore=updateAdvisorLifecycle("101","restore");
  pending.resolve();
  await Promise.all([review,restore]);
  assert.equal(writes.length,2);
  assert.equal(writes[0].advisors["101"].setupRequired,false);
  assert.equal(writes[0].advisors["101"].removed,true);
  assert.equal(writes[1].advisors["101"].setupRequired,false,"restore snapshot must preserve the committed setup review");
  assert.equal(writes[1].advisors["101"].removed,false);
  assert.equal(advisor.setupRequired,false);
  assert.equal(advisor.removed,false);
});

test("SAPR roster reconciliation queues after advisor setup review",async()=>{
  const pending=deferred();
  const advisor={number:"101",name:"Synthetic Advisor",sourceName:"Synthetic Advisor",displayName:"Synthetic Advisor",active:false,removed:true,setupRequired:true,participation:{openRo:true}};
  const model={settings:{advisors:{"101":advisor},store:{name:"Synthetic"},updatedAt:"before"},root:{}};
  const writes=[];let persisted;
  const ui={advisorSettingsList:{children:[],replaceChildren(){this.children=[];},append(item){this.children.push(item);}},settingsSaveStatus:{dataset:{},textContent:""}};
  const context={SETTINGS_PATH:["settings.json"],model,ui,document:{createElement:()=>element(),createTextNode:value=>({textContent:value})},
    writeAuthority:{canWrite:true},validAdvisorIdentity:()=>true,advisorShownInSection:()=>true,advisorDisplayName:(code,source)=>source.displayName||source.name,LEGACY_ADVISORS:{},now:()=>"synthetic-now",renderAll:()=>{},renderSetup:()=>{},addHistory:async()=>{},
    writeJson:async(_path,value)=>{const snap=JSON.parse(JSON.stringify(value));writes.push(snap);if(writes.length===1)await pending.promise;persisted=snap;}};
  const {markAdvisorSetupReviewed,reconcileSaprAdvisors}=await production(context);
  const review=markAdvisorSetupReviewed("101");
  await Promise.resolve();
  const reconcile=reconcileSaprAdvisors({periodEnd:"2026-10-20",advisors:{"101":{name:"Synthetic Advisor"}}});
  pending.resolve();
  await Promise.all([review,reconcile]);
  assert.equal(writes.length,2);
  assert.equal(writes[0].advisors["101"].setupRequired,false);
  assert.equal(writes[1].advisors["101"].setupRequired,false,"queued SAPR write preserves the confirmed review");
  assert.equal(writes[1].advisors["101"].active,true);
  assert.equal(persisted.advisors["101"].setupRequired,false);
  assert.equal(persisted.advisors["101"].active,true);
});

test("older autosave completion cannot mark a newer pending edit Saved",async()=>{
  const pending=deferred();let timerId=0;
  const model={settings:{store:{name:"Initial"},updatedAt:"before"},root:{}};
  const ui={settingsSaveStatus:{dataset:{},textContent:""}};
  const context={SETTINGS_PATH:["settings.json"],model,ui,writeAuthority:{canWrite:true},now:()=>"synthetic-now",
    readSettingsInputs:()=>{},writeJson:()=>pending.promise,addHistory:async()=>{},renderAll:()=>{},
    clearTimeout:()=>{},setTimeout:()=>++timerId,run:fn=>fn()};
  const {saveSettingsAutosave,queueSettingsAutosave}=await production(context);
  const first=saveSettingsAutosave(0);
  await Promise.resolve();
  queueSettingsAutosave();
  pending.resolve();
  await first;
  assert.equal(ui.settingsSaveStatus.dataset.saveState,"saving");
  assert.equal(ui.settingsSaveStatus.textContent,"Saving…");
});

test("meeting content writes serialize with setup review and retain the reviewed snapshot",async()=>{
  const first=deferred();
  const snapshots=[];
  let writeCount=0;
  const advisor={number:"101",name:"Synthetic Advisor",active:true,removed:false,setupRequired:true,participation:{openRo:true}};
  const model={root:{},settings:{advisors:{"101":advisor},meetingVoiceMode:"automatic",updatedAt:"before"}};
  const ui={advisorSettingsList:{children:[],replaceChildren(){this.children=[];},append(item){this.children.push(item);}},settingsSaveStatus:{dataset:{},textContent:""},meetingVoiceSurvey:{value:""},meetingVoiceExcerpt:{value:""},meetingVoiceWarning:{hidden:true}};
  const context={SETTINGS_PATH:["settings.json"],model,ui,document:{createElement:()=>element(),createTextNode:value=>({textContent:value})},
    ensurePhase2SettingsUi:()=>{},ensureCustomerVoiceSourceUi:()=>{},supervisorAdvisorCodes:()=>["101"],advisorShownInSection:()=>true,
    now:()=>"synthetic-now",writeJson:(_path,snapshot)=>{snapshots.push(structuredClone(snapshot));writeCount++;return writeCount===1?first.promise:Promise.resolve();},
    writeAuthority:{canWrite:true},renderAll:()=>{},renderSetup:()=>{},status:()=>{},validAdvisorIdentity:()=>true,
    advisorDisplayName:(code,source)=>source.displayName||source.name,addHistory:async()=>{},meetingVoiceDraft:()=>({mode:"team-message",method:"saved",source:"",excerpt:"",teamMessage:"Synthetic team note"})};
  const productionFunctions=await production(context);
  const review=productionFunctions.markAdvisorSetupReviewed("101");
  const meeting=productionFunctions.saveMeetingVoice(true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(snapshots.length,1,"meeting write waits behind the in-flight setup review");
  first.resolve();
  await Promise.all([review,meeting]);
  assert.equal(snapshots.length,2);
  assert.equal(snapshots[0].advisors["101"].setupRequired,false);
  assert.equal(snapshots[1].advisors["101"].setupRequired,false,"meeting save must preserve the completed review on disk");
  assert.equal(snapshots[1].meetingTeamMessage,"Synthetic team note");
  assert.equal(model.settings.advisors["101"].setupRequired,false);
});

test("meeting apply preserves newer draft edits typed during the durable write",async()=>{
  const pending=deferred();
  const writes=[];
  const model={root:{},settings:{
    meetingVoiceMode:"customer-quote",
    meetingCustomerVoiceSourceMethod:"pasted",
    meetingCustomerVoicePastedSource:"Synthetic source includes Submitted excerpt",
    meetingCustomerVoiceExcerpt:"Submitted excerpt",
    meetingTeamMessage:"Earlier synthetic team message",
    updatedAt:"before"
  }};
  const ui={meetingVoiceSurvey:{value:""},meetingVoicePastedSource:{value:"Synthetic source includes Submitted excerpt"},
    meetingVoiceExcerpt:{value:"Submitted excerpt"},meetingVoiceWarning:{hidden:true},settingsSaveStatus:{dataset:{},textContent:""}};
  const context={SETTINGS_PATH:["settings.json"],model,ui,document:{createElement:()=>element(),createTextNode:value=>({textContent:value})},
    ensureCustomerVoiceSourceUi:()=>{},writeAuthority:{canWrite:true},now:()=> "synthetic-after-write",
    meetingVoiceDraft:()=>({mode:"customer-quote",method:"pasted",source:"Synthetic source includes Submitted excerpt",excerpt:"Submitted excerpt",teamMessage:""}),
    writeJson:async(_path,snapshot)=>{writes.push(structuredClone(snapshot));if(writes.length===1)await pending.promise;},
    addHistory:async()=>{},renderAll:()=>{},status:()=>{}};
  const {saveMeetingVoice,persistSettingsSnapshot}=await production(context);
  const applying=saveMeetingVoice(true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(writes.length,1,"the submitted meeting content begins one durable write");
  model.settings.meetingTeamMessage="Newer synthetic team draft";
  model.settings.meetingCustomerVoiceExcerpt="Newer synthetic excerpt draft";
  pending.resolve();
  await applying;
  assert.equal(model.settings.meetingTeamMessage,"Newer synthetic team draft","completion must not overwrite a newer Team Message draft");
  assert.equal(model.settings.meetingCustomerVoiceExcerpt,"Newer synthetic excerpt draft","completion must not overwrite a newer excerpt draft");
  assert.equal(writes[0].meetingCustomerVoiceExcerpt,"Submitted excerpt","the original click remains the durable submitted snapshot");
  await persistSettingsSnapshot();
  assert.equal(writes.length,2);
  assert.equal(writes[1].meetingTeamMessage,"Newer synthetic team draft","the later save must capture current draft text");
  assert.equal(writes[1].meetingCustomerVoiceExcerpt,"Newer synthetic excerpt draft");
});

test("guided setup writes serialize with advisor setup review commits",async()=>{
  for(const actionName of ["completeGuidedSetup","reopenGuidedSetup"]){
    const first=deferred();
    const snapshots=[];
    let writeCount=0;
    const advisor={number:"101",name:"Synthetic Advisor",active:true,removed:false,setupRequired:true,participation:{openRo:true}};
    const model={root:{},settings:{advisors:{"101":advisor},setup:{completedAt:"synthetic-old",reopened:false},updatedAt:"before"}};
    const ui={advisorSettingsList:{children:[],replaceChildren(){this.children=[];},append(item){this.children.push(item);}},settingsSaveStatus:{dataset:{},textContent:""}};
    const context={SETTINGS_PATH:["settings.json"],model,ui,document:{createElement:()=>element(),createTextNode:value=>({textContent:value})},
      ensurePhase2SettingsUi:()=>{},supervisorAdvisorCodes:()=>["101"],advisorShownInSection:()=>true,now:()=>"synthetic-now",
      writeJson:(_path,snapshot)=>{snapshots.push(structuredClone(snapshot));writeCount++;return writeCount===1?first.promise:Promise.resolve();},
      writeAuthority:{canWrite:true},renderAll:()=>{},renderSetup:()=>{},navigateTo:()=>{},setupRequiredReady:()=>true,
      validAdvisorIdentity:()=>true,advisorDisplayName:(code,source)=>source.displayName||source.name,addHistory:async()=>{}};
    const productionFunctions=await production(context);
    const review=productionFunctions.markAdvisorSetupReviewed("101");
    await new Promise(resolve=>setImmediate(resolve));
    const setupAction=productionFunctions[actionName]();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(snapshots.length,1,"guided setup save waits behind the in-flight review");
    first.resolve();
    await Promise.all([review,setupAction]);
    assert.equal(snapshots.length,2);
    assert.equal(snapshots[1].advisors["101"].setupRequired,false,"guided setup save must retain the durable review");
    assert.equal(model.settings.advisors["101"].setupRequired,false);
    if(actionName==="completeGuidedSetup"){
      assert.equal(snapshots[1].setup.completedAt,"synthetic-old");
      assert.equal(snapshots[1].setup.reopened,false);
    }else{
      assert.equal(snapshots[1].setup.reopened,true);
    }
  }
});

test("guided setup completion preserves source expectations changed during its durable write",async()=>{
  const pending=deferred();
  const model={settings:{setup:{completedAt:"synthetic-old",reopened:true,sourceExpectations:{sor:"recommended"}},updatedAt:"before"},root:{}};
  const writes=[];
  const context={SETTINGS_PATH:["settings.json"],model,ui:{settingsSaveStatus:{dataset:{},textContent:""}},writeAuthority:{canWrite:true},
    setupRequiredReady:()=>true,now:()=>"synthetic-now",renderAll:()=>{},renderSetup:()=>{},navigateTo:()=>{},
    addHistory:async()=>{},writeJson:async(_path,snapshot)=>{writes.push(structuredClone(snapshot));if(writes.length===1)await pending.promise;}};
  const productionFunctions=await production(context);
  const completing=productionFunctions.completeGuidedSetup();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(writes.length,1,"completion begins one durable snapshot write");
  model.settings.setup.sourceExpectations.sor="not-used";
  const laterSave=productionFunctions.persistSettingsSnapshot();
  pending.resolve();
  await Promise.all([completing,laterSave]);
  assert.equal(model.settings.setup.sourceExpectations.sor,"not-used","completion must update only the fields it owns");
  assert.equal(writes[1].setup.sourceExpectations.sor,"not-used","the queued snapshot persists the concurrent source expectation");
  assert.equal(model.settings.setup.completedAt,"synthetic-old","re-completing setup preserves the original completion timestamp");
  assert.equal(model.settings.setup.reopened,false);
});

test("settings save completion does not overwrite a newer revision after delayed history",async()=>{
  const history=deferred();
  const model={settings:{schemaVersion:1,updatedAt:"before"},root:{}};
  const ui={settingsSaveStatus:{dataset:{},textContent:""}};
  let writes=0,renders=0;
  const context={SETTINGS_PATH:["settings.json"],model,ui,writeAuthority:{canWrite:true},readSettingsInputs:()=>{},now:()=>"synthetic-save-time",
    writeJson:async()=>{writes++;},addHistory:()=>history.promise,renderAll:()=>{renders++;},setTimeout:()=>1,clearTimeout:()=>{}};
  const {saveSettingsAutosave,queueSettingsAutosave}=await production(context);
  const firstSave=saveSettingsAutosave(0);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(writes,1,"the original snapshot reaches durable storage before history");
  queueSettingsAutosave();
  assert.equal(ui.settingsSaveStatus.dataset.saveState,"saving","newer edit is awaiting its own durable write");
  history.resolve();
  await firstSave;
  assert.equal(renders,0,"stale save completion must not redraw over the newer edit");
  assert.equal(ui.settingsSaveStatus.dataset.saveState,"saving","stale history completion must not report the newer revision as saved");
});
