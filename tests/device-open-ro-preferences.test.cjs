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
  assert.match(app,/ui\.clearFilters\.addEventListener\("click",saveRoDeviceView\)/);
  assert.match(app,/sortOpenRoRows\(exactRos\.length\?exactRos:/);
  assert.match(css,/tbody\.ro-density-compact/);
  assert.doesNotMatch(html,/src="assets\/device-preferences\.js"/);
});
