"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function slice(start,end){const a=app.indexOf(start),b=app.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return app.slice(a,b);}
const advisorRender=slice("  function renderAdvisorSettings(","  function renderSettings(");
const settingsRender=slice("  function renderSettings(","  function readSettingsInputs(");
const lifecycle=slice("  async function updateAdvisorLifecycle(","  async function reconcileSaprAdvisors(");
const settingsPersistence=slice("let settingsAutosaveTimer=null; let settingsWriteChain=Promise.resolve();","  async function saveSettingsAutosave()");
function production(context){const factory=Function("context",`with(context){ return (async()=>{ ${settingsPersistence} ${advisorRender} ${lifecycle} return {updateAdvisorLifecycle,markAdvisorSetupReviewed,persistSettingsSnapshot,renderAdvisorSettings}; })(); }`);return factory(context);}

function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function element(){const classes=[];return{dataset:{},children:[],classes,textContent:"",classList:{add(name){classes.push(name);}},append(...items){this.children.push(...items);},appendChild(item){this.children.push(item);}};}

test("advisor restore redraw preserves an unrelated settings edit during autosave debounce",async()=>{
  const write=deferred();
  const advisor={number:"101",name:"Synthetic Advisor",active:false,removed:true,setupRequired:true,participation:{openRo:true}};
  const model={settings:{advisors:{"101":advisor},updatedAt:"before"}};
  const pendingInput={value:"persisted store name"};
  let wholeSettingsRenders=0;
  const ui={advisorSettingsList:{children:[],replaceChildren(){this.children=[];},append(item){this.children.push(item);}}};
  const document={createElement:()=>element(),createTextNode:value=>({textContent:value})};
  const context={SETTINGS_PATH:["settings.json"],model,ui,document,advisorShownInSection:()=>true,now:()=>"synthetic-now",
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
  const advisor={number:"101",name:"Synthetic Advisor",displayName:"Synthetic Advisor",active:false,removed:true,setupRequired:true,participation:{openRo:true}};
  const model={settings:{advisors:{"101":advisor},store:{name:"Synthetic"},updatedAt:"before"},root:{}};
  const writes=[];
  const ui={advisorSettingsList:{children:[],replaceChildren(){this.children=[];},append(item){this.children.push(item);}},settingsSaveStatus:{dataset:{},textContent:""}};
  const context={SETTINGS_PATH:["settings.json"],model,ui,document:{createElement:()=>element(),createTextNode:value=>({textContent:value})},
    writeAuthority:{canWrite:true},advisorShownInSection:()=>true,validAdvisorIdentity:()=>true,advisorDisplayName:(code,source)=>source.displayName||source.name,
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
