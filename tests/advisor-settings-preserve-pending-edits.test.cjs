"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const css=fs.readFileSync(path.join(__dirname,"..","assets","product-settings.css"),"utf8");
function section(first,last){
  const start=app.indexOf(first),end=app.indexOf(last,start+first.length);
  assert.ok(start>=0&&end>start,"Production boundary exists: "+first);
  return app.slice(start,end);
}
const snapshotWrite=section("  function persistSettingsSnapshot(","  async function saveSettingsAutosave(");
const advisorRenderer=section("  function renderAdvisorSettings() {","  function renderSettings() {");
const lifecycle=section("  async function updateAdvisorLifecycle(","  async function markAdvisorSetupReviewed(");
const setupReview=section("  async function markAdvisorSetupReviewed(","  async function reconcileSaprAdvisors(");
const renderAll=section("  function renderAll() {","  const renderAllWithCanonicalSourceLabels=renderAll;");

function fakeNode(tag="div"){
  return {tagName:tag,dataset:{},children:[],className:"",textContent:"",
    classList:{add(){},remove(){}},
    append(...items){this.children.push(...items);},
    replaceChildren(...items){this.children=[...items];}
  };
}
function containsReviewedAction(node){
  return Boolean(node?.dataset?.advisorSetupReviewed)||Boolean(node?.children?.some(containsReviewedAction));
}
function settingsContext(settings,overrides={}){
  const calls=[];
  const model={root:{name:"Synthetic Workspace"},settings};
  const ui={settingsSaveStatus:{dataset:{},textContent:""},advisorSettingsList:fakeNode("div")};
  const context=vm.createContext({
    model,ui,document:{createElement:tag=>fakeNode(tag),createTextNode:text=>({textContent:text})},
    validAdvisorIdentity:()=>true,advisorDisplayName:(_code,advisor)=>advisor.name,
    advisorShownInSection:(code,key)=>model.settings.advisors[code]?.participation?.[key]!==false,
    calls,SETTINGS_PATH:["data","settings.json"],
    settingsWriteChain:Promise.resolve(),settingsAutosaveRevision:0,
    structuredClone,now:()=>"2026-10-23T04:00:00.000Z",
    writeAuthority:{canWrite:true},
    writeJson:async(_path,snapshot)=>{calls.push(["write",structuredClone(snapshot)]);},
    addHistory:async(...args)=>calls.push(["history",...args]),
    renderAdvisorSettings:()=>calls.push(["renderAdvisorSettings"]),
    renderSupervisorWorksheetOrder:()=>calls.push(["renderSupervisorWorksheetOrder"]),
    renderAll:()=>calls.push(["renderAll"]),
    renderSetup:()=>calls.push(["renderSetup"]),
    renderSettings:()=>calls.push(["renderSettings"]),
    ...overrides
  });
  vm.runInContext(snapshotWrite+"\n"+advisorRenderer+"\n"+lifecycle+"\n"+setupReview+
    "\nconst originalRenderAdvisorSettings=renderAdvisorSettings;renderAdvisorSettings=function(){calls.push(['renderAdvisorSettings']);return originalRenderAdvisorSettings();};"+
    "\nthis.updateAdvisorLifecycle=updateAdvisorLifecycle;this.markAdvisorSetupReviewed=markAdvisorSetupReviewed;",context);
  return {context,model,ui,calls};
}

test("restoring an advisor preserves unrelated pending Settings input",async()=>{
  const settings={updatedAt:"before",store:{name:"Saved store"},advisors:{
    "103":{number:"103",name:"Synthetic advisor",removed:true,setupRequired:false}
  }};
  const pendingStoreName={value:"Unsaved synthetic edit"};
  const {context,model,calls}=settingsContext(settings,{
    renderSettings:()=>{calls.push(["renderSettings"]);pendingStoreName.value=model.settings.store.name;}
  });
  const renderAllSource=renderAll;
  assert.doesNotMatch(renderAllSource,/renderSettings\s*\(/,
    "The production global refresh must not rebuild the Settings form");
  await context.updateAdvisorLifecycle("103","restore");
  assert.equal(model.settings.advisors["103"].removed,false);
  assert.equal(pendingStoreName.value,"Unsaved synthetic edit",
    "A targeted advisor refresh cannot replace an unrelated unsaved field");
  assert.equal(calls.some(([name])=>name==="renderSettings"),false);
  assert.ok(calls.some(([name])=>name==="renderAdvisorSettings"));
  assert.ok(calls.some(([name])=>name==="renderAll"));
});

test("failed advisor setup review restores the action and allows a successful retry",async()=>{
  const settings={updatedAt:"before",advisors:{
    "101":{number:"101",name:"Synthetic advisor",removed:false,setupRequired:true}
  }};
  let deny=true;
  const {context,model,ui,calls}=settingsContext(settings,{
    writeJson:async(_path,snapshot)=>{
      calls.push(["write",structuredClone(snapshot)]);
      if(deny)throw new Error("Synthetic disk denial");
    }
  });
  await assert.rejects(()=>context.markAdvisorSetupReviewed("101"),/Synthetic disk denial/);
  assert.equal(model.settings.advisors["101"].setupRequired,true,
    "Failed durable write leaves setup review pending");
  assert.ok(calls.some(([name])=>name==="renderAdvisorSettings"),
    "Failure redraws the advisor list");
  assert.ok(calls.some(([name])=>name==="renderSetup"),
    "Failure refreshes setup attention state");
  assert.equal(ui.settingsSaveStatus.dataset.saveState,"error");
  assert.ok(containsReviewedAction(ui.advisorSettingsList),
    "Failed write leaves the durable setup-review action available");

  deny=false;
  await context.markAdvisorSetupReviewed("101");
  assert.equal(model.settings.advisors["101"].setupRequired,false);
  assert.equal(containsReviewedAction(ui.advisorSettingsList),false,
    "Successful retry removes the review action from the rendered advisor row");
  assert.equal(ui.settingsSaveStatus.dataset.saveState,"saved");
  assert.match(ui.settingsSaveStatus.textContent,/review saved/i);
});

test("advisor participation styling remains full width and responsive",()=>{
  assert.match(css,/#view-settings #settings-advisors\{grid-column:1\/-1/);
  assert.match(css,/#view-settings #settings-advisors \.advisor-participation label\{/);
  assert.match(css,/@media\(max-width:740px\)/);
  new vm.Script(app);
});
