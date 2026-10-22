"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "assets", "product-settings.css"), "utf8");
function section(first, last) {
  const start = app.indexOf(first), end = app.indexOf(last, start + first.length);
  assert.ok(start !== -1 && end > start, "Production settings boundary exists: " + first);
  return app.slice(start, end);
}

test("advisor scope changes do not silently mark new advisors reviewed; review button responds immediately", () => {
  const listeners = new Map(), calls = [];
  const synthetic = { number: "101", removed: false, setupRequired: true, participation: {
    openRo: true, assignNext: false, dailyWalk: false,
    advisorPerformance: true, advisorMeeting: false, supervisorWorkbook: false
  }};
  const model = { root: {name:"Synthetic workspace"}, settings: { advisors: { "101": synthetic } } };
  const status = { dataset: {}, textContent: "" };
  const ui = { "view-settings": {querySelectorAll: () => []}, settingsSaveStatus: status,
    advisorSettingsList: {addEventListener: (name, fn) => listeners.set(name, fn)} };
  const writeAuthority = {canWrite:true};
  const context = vm.createContext({ui, model, writeAuthority,
    meetingCycleInfo:()=>{}, meetingGrossGoal:()=>{},
    configuredMeetingCycleInfo:()=>{}, configuredMeetingGrossGoal:()=>{},
    queueSettingsAutosave:()=>calls.push("save"),
    renderAll:()=>calls.push("renderAll"),
    renderSetup:()=>calls.push("renderSetup"),
    advisorShownInSection: (code,key)=>model.settings.advisors[code].participation[key] !== false,
    run: fn => fn(),
    updateAdvisorLifecycle: async()=>calls.push("restore")
  });
  vm.runInContext(section("  function installProductizedRuntime(){", "  function configuredMeetingNextWin(") +
    "\nthis.installProductizedRuntime=installProductizedRuntime;", context);
  context.installProductizedRuntime();
  const input={dataset:{advisorCode:"101",advisorParticipation:"advisorMeeting"},checked:true};
  listeners.get("change")({target:{closest:()=>input}});
  assert.equal(synthetic.participation.advisorMeeting,true);
  assert.equal(synthetic.setupRequired,true,"A checkbox is not explicit setup review");
  assert.deepEqual(calls,["renderAll","save"]);
  writeAuthority.canWrite=false;
  input.checked=false;
  listeners.get("change")({target:{closest:()=>input}});
  assert.equal(synthetic.participation.advisorMeeting,true,"Read-only change never alters model");
  assert.equal(input.checked,true,"Read-only checkbox reverts to confirmed state");
  assert.equal(status.dataset.saveState,"error");
  writeAuthority.canWrite=true;
  let removed=false,attentionRemoved=false;
  const row={classList:{remove:klass=>{if(klass==="setup-attention")attentionRemoved=true;}}};
  const reviewed={dataset:{advisorSetupReviewed:"101"},
    closest:selector=>selector===".advisor-setting"?row:null, remove:()=>{removed=true;}};
  listeners.get("click")({target:{closest:selector=>selector==="button[data-advisor-setup-reviewed]"?reviewed:null}});
  assert.equal(synthetic.setupRequired,false);
  assert.equal(removed,true);
  assert.equal(attentionRemoved,true);
  assert.deepEqual(calls.slice(-2),["renderSetup","save"]);
});

test("legacy advisor restore redraws enabled controls after durable write, and failed write rolls back", async () => {
  const source=section("  async function updateAdvisorLifecycle(code, action)", "  async function reconcileSaprAdvisors(");
  const settings={updatedAt:"before", advisors:{"103":{number:"103",removed:true}}};
  const calls=[];let fail=false;
  const context=vm.createContext({
    model:{settings}, SETTINGS_PATH:["data","settings.json"], now:()=>"after",
    writeJson:async()=>{calls.push("write");if(fail)throw new Error("Synthetic disk denial");},
    renderSettings:()=>calls.push("renderSettings"),
    renderAll:()=>calls.push("renderAll"),
    addHistory:async()=>calls.push("history")
  });
  vm.runInContext(source+"\nthis.updateAdvisorLifecycle=updateAdvisorLifecycle;",context);
  await context.updateAdvisorLifecycle("103","restore");
  assert.equal(settings.advisors["103"].removed,false);
  assert.deepEqual(calls,["write","renderSettings","renderAll","history"]);
  fail=true;
  await assert.rejects(()=>context.updateAdvisorLifecycle("103","remove"),/Synthetic disk denial/);
  assert.equal(settings.advisors["103"].removed,false,"Failed write must not remove advisor in memory");
  assert.equal(settings.updatedAt,"after");
  assert.deepEqual(calls.slice(-1),["write"]);
});

test("autosave shows an error instead of leaving a green Saving badge after disk denial", async () => {
  const source=section("  let settingsAutosaveTimer=null;", "  async function updateAdvisorLifecycle(");
  let timer, fail=true, rendered=0;const failures=[];
  const chip={dataset:{},textContent:""};
  const ctx=vm.createContext({
    model:{root:{name:"Synthetic workspace"},settings:{schemaVersion:1}},
    ui:{settingsSaveStatus:chip},
    writeAuthority:{canWrite:true},
    now:()=>"2026-10-22T14:00:00.000Z",
    readSettingsInputs:()=>{},
    writeJson:async()=>{if(fail)throw new Error("Synthetic save failure");},
    addHistory:async()=>{},
    renderAll:()=>{rendered++;},
    Date,
    setTimeout:fn=>{timer=fn;return 1;},
    clearTimeout:()=>{},
    run:async fn=>{try{await fn();}catch(e){failures.push(e.message);}}
  });
  vm.runInContext(source+"\nthis.queueSettingsAutosave=queueSettingsAutosave;",ctx);
  ctx.queueSettingsAutosave();
  assert.equal(chip.dataset.saveState,"saving");
  await timer();
  assert.equal(chip.dataset.saveState,"error");
  assert.match(chip.textContent,/needs attention/);
  assert.equal(rendered,0);
  assert.deepEqual(failures,["Synthetic save failure"]);
  fail=false;
  ctx.queueSettingsAutosave();
  await timer();
  assert.equal(chip.dataset.saveState,"saved");
  assert.match(chip.textContent,/Saved/);
  assert.equal(rendered,1);
});

test("advisor settings have a full-width responsive layout and visible save states",()=>{
  assert.match(css,/#view-settings #settings-advisors\{grid-column:1\/-1/);
  assert.match(css,/#view-settings #settings-advisors \.advisor-participation label\{/);
  assert.match(css,/#view-settings #settingsSaveStatus\[data-save-state="error"\]/);
  assert.match(css,/@media\(max-width:740px\)/);
  new vm.Script(app);
});
