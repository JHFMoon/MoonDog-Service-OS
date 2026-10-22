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

function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function element(){const classes=[];return{dataset:{},children:[],classes,classList:{add(name){classes.push(name);}},append(...items){this.children.push(...items);},appendChild(item){this.children.push(item);}};}

test("advisor restore redraw preserves an unrelated settings edit during autosave debounce",async()=>{
  const write=deferred();
  const advisor={number:"101",name:"Synthetic Advisor",active:false,removed:true,setupRequired:true,participation:{openRo:true}};
  const model={settings:{advisors:{"101":advisor},updatedAt:"before"}};
  const pendingInput={value:"persisted store name"};
  let wholeSettingsRenders=0;
  const ui={advisorSettingsList:{children:[],replaceChildren(){this.children=[];},append(item){this.children.push(item);}}};
  const document={createElement:()=>element(),createTextNode:value=>({textContent:value})};
  const context={SETTINGS_PATH:["settings.json"],model,ui,document,advisorShownInSection:()=>true,now:()=>"synthetic-now",
    writeJson:()=>write.promise,renderAll:()=>{},addHistory:async()=>{},
    renderSettings:()=>{wholeSettingsRenders++;pendingInput.value=model.settings.store?.name||"";}};
  const production=Function("context",`with(context){ return (async()=>{ ${advisorRender} ${lifecycle} return {updateAdvisorLifecycle,markAdvisorSetupReviewed}; })(); }`);
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
    writeJson:async()=>{throw new Error("synthetic write denied");},renderAll:()=>{},renderSetup:()=>{},addHistory:async()=>{}};
  const {markAdvisorSetupReviewed}=await production(context);
  await assert.rejects(markAdvisorSetupReviewed("101"),/synthetic write denied/);
  assert.equal(advisor.setupRequired,true,"failed durable writes must retain the review requirement");
  assert.equal(model.settings.updatedAt,"before","failed writes must roll back the in-memory revision");
  assert.equal(ui.settingsSaveStatus.dataset.saveState,"error");
  const row=ui.advisorSettingsList.children[0];
  assert.ok(row.children.some(child=>child.dataset?.advisorSetupReviewed==="101"),"the action must remain available for retry");
});
