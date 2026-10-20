"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const root=path.resolve(__dirname,"..");
const app=fs.readFileSync(path.join(root,"assets/app.js"),"utf8");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const css=fs.readFileSync(path.join(root,"assets/worklist.css"),"utf8");
function production(start,end){
  const first=app.indexOf(start),last=app.indexOf(end,first+start.length);
  assert.ok(first>=0&&last>first,"production boundary "+start);
  return app.slice(first,last);
}
const deviceModule=production("  // BEGIN DEVICE START VIEW","  // END DEVICE START VIEW");
function harness(storage){
  const context=vm.createContext({localStorage:storage});
  vm.runInContext(deviceModule,context);
  return context.MoonDogDevicePreferences;
}
const plain=value=>JSON.parse(JSON.stringify(value));
const defaults={sort:"priority",density:"comfortable",attention:""};

test("Open RO first-run presentation is deterministic and separate from shared operational data",()=>{
  const actions=[],map=new Map(),store={
    getItem:key=>{actions.push(["get",key]);return map.get(key)||null;},
    setItem:(key,value)=>{actions.push(["set",key,value]);map.set(key,value);},
    removeItem:key=>{actions.push(["remove",key]);map.delete(key);}
  };
  const prefs=harness(store);
  assert.deepEqual(plain(prefs.readOpenRo()),defaults);
  assert.equal(prefs.writeOpenRo({sort:"longest",density:"compact",attention:"long-5"}),true);
  assert.deepEqual(plain(prefs.readOpenRo()),{sort:"longest",density:"compact",attention:"long-5"});
  assert.deepEqual(JSON.parse(map.get("moondog-device-open-ro-v1")),{sort:"longest",density:"compact",attention:"long-5"});
  assert.equal(actions.every(item=>item[1]==="moondog-device-open-ro-v1"),true,"no Workspace paths or RO fields in device preference accesses");
  assert.equal(prefs.writeOpenRo(defaults),true);
  assert.deepEqual(plain(prefs.readOpenRo()),defaults);
  assert.equal(map.size,0,"reset clears the only preference key");
  assert.equal(prefs.readLanding(),"home","new preference never alters existing start-page behavior");
});

test("preference API rejects unapproved fields, personal data and malformed stored values",()=>{
  const map=new Map(),store={
    getItem:key=>map.get(key)||null,
    setItem:(key,value)=>map.set(key,value),
    removeItem:key=>map.delete(key)
  };
  const prefs=harness(store);
  const invalid=[
    {sort:"VIN",density:"compact",attention:""},
    {sort:"priority",density:"tiny",attention:""},
    {sort:"priority",density:"comfortable",attention:"Advisor: Example"},
    {sort:"priority",density:"comfortable",attention:"",customer:"SYNTHETIC"}
  ];
  // Extraneous properties may be supplied by UI integrations, but are never persisted.
  assert.equal(prefs.writeOpenRo(invalid[3]),true);
  assert.equal(map.has("moondog-device-open-ro-v1"),false,"a default preference and extraneous personal fields are never stored");
  for(const candidate of invalid.slice(0,3)){
    assert.equal(prefs.writeOpenRo(candidate),false);
    assert.deepEqual(plain(prefs.readOpenRo()),defaults);
  }
  for(const damaged of ["{",JSON.stringify({sort:"ro",density:"comfortable",attention:"bad"}),JSON.stringify({sort:"ro"}),"42"]){
    map.set("moondog-device-open-ro-v1",damaged);
    assert.deepEqual(plain(prefs.readOpenRo()),defaults);
  }
});

test("storage blocked, missing or revoked never breaks the UI and never claims persistence",()=>{
  const denied={getItem(){throw Error("denied");},setItem(){throw Error("denied");},removeItem(){throw Error("denied");}};
  for(const store of [undefined,denied]){
    const prefs=harness(store);
    assert.deepEqual(plain(prefs.readOpenRo()),defaults);
    assert.equal(prefs.writeOpenRo({sort:"ro",density:"compact",attention:"reviewed"}),false);
  }
});

test("actual production sort helper honors manager-first default and never mutates records",()=>{
  const sortCode=production("  // Sorting is presentation-only; manager priorities remain the first-run default.","  function renderTable() {");
  const ctx=vm.createContext({
    clarificationFor:record=>Boolean(record.clarification),
    isClosedManagement:management=>management.status==="Closed",
    adminCloseoutState:()=>({overdue:false,needsCommitment:false,dueToday:false})
  });
  const {sortOpenRoRows}=vm.runInContext(sortCode+"\n({sortOpenRoRows})",ctx);
  const records=[
    {ro:"20",advisor:"Zed",daysOpen:1,management:{nextAction:"Call customer",reviewDate:"2026-10-26"}},
    {ro:"3",advisor:"Charlie",daysOpen:14,management:{nextAction:"Wait parts",reviewDate:"2026-10-26"}},
    {ro:"11",advisor:"Alex",daysOpen:5,management:{nextAction:"",reviewDate:"2026-10-26"}}
  ];
  const original=JSON.stringify(records),ids=(mode)=>sortOpenRoRows(records,"2026-10-18",mode).map(r=>r.ro).join(",");
  assert.equal(ids("priority"),"11,3,20","missing next action stays first by default");
  assert.equal(ids("longest"),"3,11,20");
  assert.equal(ids("advisor"),"11,3,20");
  assert.equal(ids("ro"),"3,11,20","numeric RO ordering");
  assert.equal(ids("unknown"),"11,3,20","unrecognized sort fails to manager priority");
  assert.equal(JSON.stringify(records),original,"sorting operates on a view copy, not authoritative RO state");
});

test("view controls are in shipped HTML and operate without a new runtime file",()=>{
  for(const id of ["openRoSort","openRoDensity","openRoPreferenceReset","openRoPreferenceFeedback"])assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(app,/MoonDogDevicePreferences\?\.readOpenRo\(\)/);
  assert.match(app,/MoonDogDevicePreferences\?\.writeOpenRo\(/);
  const clearStart=app.indexOf('ui.clearFilters.addEventListener("click", () => {');
  const clearEnd=app.indexOf("});",clearStart);
  assert.ok(clearStart>=0&&clearEnd>clearStart,"actual clear handler exists");
  const clearHandler=app.slice(clearStart,clearEnd);
  assert.ok(clearHandler.indexOf('ui.attentionFilter.value = "";')>=0,"clear resets visible follow-up");
  assert.ok(clearHandler.indexOf("saveRoDeviceView();")>clearHandler.indexOf('ui.attentionFilter.value = "";'),"reset must be persisted after the filter clears");
  assert.ok(clearHandler.indexOf("renderTable();")>clearHandler.indexOf("saveRoDeviceView();"),"render reflects the persisted choice");
  assert.match(app,/sortOpenRoRows\(exactRos\.length\?exactRos:/);
  assert.match(css,/tbody\.ro-density-compact/);
  assert.doesNotMatch(html,/src="assets\/device-preferences\.js"/);
});


function filterStore(){
  const map=new Map(),events=[];
  return {map,events,
    getItem(key){events.push(["get",key]);return map.get(key)||null;},
    setItem(key,value){events.push(["set",key,value]);map.set(key,value);},
    removeItem(key){events.push(["remove",key]);map.delete(key);}
  };
}
const filterKey="moondog-device-open-ro-filter-choice-v1";

test("privacy-safe selections survive reload without storing advisor or status names",()=>{
  const store=filterStore(),prefs=harness(store);
  const advisor=["","Alex Smith","Zoe Example"];
  const sources=["","Verified","Missing"];
  const management=["","Needs plan","Updated"];
  assert.equal(prefs.writeOpenRoFilter("advisor",advisor,"Zoe Example"),true);
  assert.equal(prefs.writeOpenRoFilter("sourceStatus",sources,"Missing"),true);
  assert.equal(prefs.writeOpenRoFilter("managementStatus",management,"Needs plan"),true);
  const saved=store.map.get(filterKey);
  assert.ok(saved,"browser-only selection record persisted");
  for(const word of ["Alex","Zoe","Example","Verified","Missing","Needs plan","Updated"]){
    assert.equal(saved.includes(word),false,"operational labels must not be serialized: "+word);
  }
  assert.equal(store.map.size,1,"only one device-scoped storage key");
  const reread=harness(store);
  assert.equal(reread.readOpenRoFilter("advisor",advisor),"Zoe Example");
  assert.equal(reread.readOpenRoFilter("sourceStatus",sources),"Missing");
  assert.equal(reread.readOpenRoFilter("managementStatus",management),"Needs plan");
  assert.equal(reread.readOpenRoFilter("invalid",advisor),"");
});

test("changed available advisors or statuses fail closed instead of selecting a different record",()=>{
  const store=filterStore(),prefs=harness(store);
  assert.equal(prefs.writeOpenRoFilter("advisor",["","Alex","Zoe"],"Zoe"),true);
  assert.equal(prefs.readOpenRoFilter("advisor",["","Alex","Bob"]),"");
  assert.equal(prefs.readOpenRoFilter("advisor",["","Zoe","Alex"]),"");
  assert.equal(prefs.readOpenRoFilter("advisor",["","Alex"]),"");
  assert.equal(prefs.readOpenRoFilter("advisor",["","Alex","Zoe"]),"Zoe");
  assert.equal(prefs.writeOpenRoFilter("sourceStatus",["","Verified","Missing"],"Missing"),true);
  assert.equal(prefs.readOpenRoFilter("sourceStatus",["","Verified","Other"]),"");
  assert.equal(prefs.writeOpenRoFilter("managementStatus",["","Open","Closed"],"Closed"),true);
  assert.equal(prefs.readOpenRoFilter("managementStatus",["","Open","Changed"]),"");
});

test("invalid, denied and malformed browser filter preference data fails to safe defaults",()=>{
  const store=filterStore(),prefs=harness(store);
  const advisors=["","Alex","Zoe"];
  assert.equal(prefs.writeOpenRoFilter("advisor",advisors,"Not present"),false);
  assert.equal(prefs.writeOpenRoFilter("unknown",advisors,"Alex"),false);
  assert.equal(prefs.writeOpenRoFilter("advisor",["","x".repeat(300)],"x".repeat(300)),false);
  for(const bad of ["{","null","[]","42",JSON.stringify({advisor:{index:1000000,signature:"spoof"}})]){
    store.map.set(filterKey,bad);
    assert.equal(prefs.readOpenRoFilter("advisor",advisors),"");
  }
  const denied={getItem(){throw Error("denied");},setItem(){throw Error("denied");},removeItem(){throw Error("denied");}};
  const pDenied=harness(denied),pMissing=harness(undefined);
  for(const p of [pDenied,pMissing]){
    assert.equal(p.readOpenRoFilter("advisor",advisors),"");
    assert.equal(p.writeOpenRoFilter("advisor",advisors,"Alex"),false);
    assert.equal(p.clearOpenRoFilters(),false);
  }
});

test("clear/reset removes device filter selections without altering existing sort or Workspace data",()=>{
  const store=filterStore(),prefs=harness(store);
  const advisors=["","Alex"];
  assert.equal(prefs.writeOpenRoFilter("advisor",advisors,"Alex"),true);
  assert.equal(prefs.writeOpenRoFilter("advisor",advisors,""),true);
  assert.equal(store.map.has(filterKey),false,"clearing last individual filter deletes key");
  assert.equal(prefs.writeOpenRoFilter("advisor",advisors,"Alex"),true);
  assert.equal(prefs.writeOpenRo({sort:"longest",density:"compact",attention:"overdue"}),true);
  assert.equal(prefs.clearOpenRoFilters(),true);
  assert.equal(store.map.has(filterKey),false);
  assert.deepEqual(plain(prefs.readOpenRo()),{sort:"longest",density:"compact",attention:"overdue"});
  assert.equal(prefs.readOpenRoFilter("advisor",advisors),"");
});

test("production filter-render function restores device choices only against matching current options",()=>{
  const store=filterStore(),prefs=harness(store);
  const advisors=["","Alex","Zoe"],sources=["","Missing","Verified"],status=["","Open","Reviewed"];
  assert.equal(prefs.writeOpenRoFilter("advisor",advisors,"Zoe"),true);
  assert.equal(prefs.writeOpenRoFilter("sourceStatus",sources,"Missing"),true);
  assert.equal(prefs.writeOpenRoFilter("managementStatus",status,"Reviewed"),true);
  const makeSelect=()=>({value:"",options:[]});
  const ui={advisorFilter:makeSelect(),sourceStatusFilter:makeSelect(),managementStatusFilter:makeSelect()};
  const records=[
    {advisor:"Alex",sourceStatus:"Verified",management:{status:"Open"}},
    {advisor:"Zoe",sourceStatus:"Missing",management:{status:"Reviewed"}}
  ];
  const renderCode=production("  function renderFilters() {","  function renderTrendCoverageSummary(");
  const context=vm.createContext({
    ui,model:{root:{name:"fake"},state:{records}},
    renderAdvisorHandoff(){},
    statusForRecord(record){return record.management.status;},
    syncFilter(select,placeholder,values){
      const previous=select.value;
      select.options=[{value:""},...new Set(values.filter(Boolean))].sort((a,b)=>String(a.value||a).localeCompare(String(b.value||b))).map(x=>typeof x==="object"?x:{value:x});
      // Always retain the placeholder as the first choice.
      select.options=select.options.filter(item=>item.value!=="");
      select.options.unshift({value:""});
      select.value=select.options.some(item=>item.value===previous)?previous:"";
    },
    MoonDogDevicePreferences:prefs
  });
  vm.runInContext(renderCode+"\nthis.renderFilters=renderFilters;",context);
  context.renderFilters();
  assert.equal(ui.advisorFilter.value,"Zoe");
  assert.equal(ui.sourceStatusFilter.value,"Missing");
  assert.equal(ui.managementStatusFilter.value,"Reviewed");
  context.model.state.records=[
    {advisor:"Alex",sourceStatus:"Other",management:{status:"Open"}},
    {advisor:"Bob",sourceStatus:"Verified",management:{status:"Changed"}}
  ];
  context.renderFilters();
  assert.equal(ui.advisorFilter.value,"");
  assert.equal(ui.sourceStatusFilter.value,"");
  assert.equal(ui.managementStatusFilter.value,"");
});

test("actual event handlers persist all three presentation filters and both resets clear them",()=>{
  for(const field of ['["advisor",ui.advisorFilter]','["sourceStatus",ui.sourceStatusFilter]','["managementStatus",ui.managementStatusFilter]']){
    assert.ok(app.includes(field),field);
  }
  assert.match(app,/saveOpenRoFilter\(field,select\);renderTable\(\)/);
  assert.match(app,/ui\.clearFilters\.addEventListener\("click",\s*\(\)\s*=>\s*\{[^}]*clearSavedOpenRoFilters\(\)/);
  assert.match(app,/ui\.openRoPreferenceReset\.addEventListener\("click",\(\)=>\{[^}]*clearSavedOpenRoFilters\(\)/);
  assert.doesNotMatch(app,/writeJson\([^)]*DEVICE_OPEN_RO_FILTER_KEY/);
});
