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
function element(){return{dataset:{},children:[],append(...items){this.children.push(...items);},appendChild(item){this.children.push(item);}};}

test("advisor restore redraw preserves an unrelated settings edit during autosave debounce",async()=>{
  const write=deferred();
  const advisor={number:"101",name:"Synthetic Advisor",active:false,removed:true,participation:{openRo:true}};
  const model={settings:{advisors:{"101":advisor},updatedAt:"before"}};
  const pendingInput={value:"persisted store name"};
  let wholeSettingsRenders=0;
  const ui={advisorSettingsList:{children:[],replaceChildren(){this.children=[];},append(item){this.children.push(item);}}};
  const document={createElement:()=>element(),createTextNode:value=>({textContent:value})};
  const context={model,ui,document,advisorShownInSection:()=>true,now:()=>"synthetic-now",
    writeJson:()=>write.promise,renderAll:()=>{},addHistory:async()=>{},
    renderSettings:()=>{wholeSettingsRenders++;pendingInput.value=model.settings.store?.name||"";}};
  const production=Function("context",`with(context){ return (async()=>{ ${advisorRender} ${lifecycle} return updateAdvisorLifecycle; })(); }`);
  const update=await production(context);
  const restoring=update("101","restore");
  pendingInput.value="synthetic edit made while restore write is pending";
  write.resolve();
  await restoring;
  assert.equal(wholeSettingsRenders,0,"advisor lifecycle must not rebuild every settings input");
  assert.equal(pendingInput.value,"synthetic edit made while restore write is pending");
  assert.equal(advisor.removed,false);
  assert.equal(ui.advisorSettingsList.children.length,1);
});

test("full settings render delegates advisor controls to the scoped redraw helper",()=>{
  assert.match(settingsRender,/renderAdvisorSettings\(\);/);
  assert.doesNotMatch(settingsRender,/advisorSettingsList\.replaceChildren\(\)/);
});
