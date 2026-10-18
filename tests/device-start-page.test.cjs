"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "assets/app.js"), "utf8");
const blockStart = appSource.indexOf("  // BEGIN DEVICE START VIEW");
const blockEnd = appSource.indexOf("  // END DEVICE START VIEW", blockStart);
assert.ok(blockStart >= 0 && blockEnd > blockStart, "actual production browser preference module exists");
const script = appSource.slice(blockStart, blockEnd);

function createHarness(store) {
  const context = { localStorage: store };
  vm.runInNewContext(script, context);
  return context.MoonDogDevicePreferences;
}

test("device start page is opt-in, allowlisted and never writes Workspace data", () => {
  const saved = new Map();
  const activity = [];
  const store = {
    getItem:key=>{activity.push(["read",key]);return saved.get(key)||null;},
    setItem:(key,value)=>{activity.push(["write",key,value]);saved.set(key,value);},
    removeItem:key=>{activity.push(["remove",key]);saved.delete(key);}
  };
  const prefs=createHarness(store);
  assert.equal(prefs.readLanding(),"home","manager Home remains the first-run default");
  assert.equal(prefs.writeLanding("open-ro"),true);
  assert.equal(prefs.readLanding(),"open-ro");
  assert.equal(prefs.writeLanding("performance"),true);
  assert.equal(prefs.readLanding(),"performance");
  assert.equal(prefs.writeLanding("data/current-state.json"),false);
  assert.equal(prefs.writeLanding("not-a-tab"),false);
  assert.equal(prefs.readLanding(),"performance","invalid choices must not overwrite the stored value");
  assert.equal(prefs.writeLanding("home"),true);
  assert.equal(prefs.readLanding(),"home","reset removes the preference");
  assert.equal(saved.size,0,"reset does not persist default or dealership data");
  const keys=activity.map(x=>x[1]);
  assert.ok(keys.every(key=>key==="moondog-device-start-view-v1"),"only the non-sensitive preference key can be read/written");
});

test("missing, disabled or corrupted browser storage fails safely to manager Home", () => {
  assert.equal(createHarness(undefined).readLanding(),"home");
  assert.equal(createHarness(undefined).writeLanding("open-ro"),false);
  const denied=createHarness({getItem(){throw Error("denied");},setItem(){throw Error("denied");},removeItem(){throw Error("denied");}});
  assert.equal(denied.readLanding(),"home");
  assert.equal(denied.writeLanding("arrivals"),false);
  const malformed=createHarness({getItem(){return "customer VIN 123";},setItem(){},removeItem(){}});
  assert.equal(malformed.readLanding(),"home");
  assert.equal(malformed.writeLanding("untrusted-view"),false);
});

test("installed runtime, Settings control and startup preference are wired together", () => {
  const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
  const app=fs.readFileSync(path.join(root,"assets/app.js"),"utf8");
  assert.match(html,/<select id="deviceStartPage">/);
  assert.match(html,/id="deviceStartPageReset" type="button"/);
  assert.match(html,/id="deviceStartPageFeedback" role="status"/);
  assert.doesNotMatch(html,/src="assets\/device-preferences\.js"/);
  assert.match(app,/const HANDOFF_RUNTIME_PATHS=\[[^;]+assets\/daily-ops\.css/);
  assert.doesNotMatch(app,/const HANDOFF_RUNTIME_PATHS=\[[^;]+assets\/device-preferences\.js/);
  assert.match(app,/querySelectorAll\("\.settings-card:not\(#settings-device-start-page\)"\)/);
  assert.match(html,/id="settings-device-start-page"/);
  assert.match(app,/MoonDogDevicePreferences\?\.readLanding\(\)/);
  assert.match(app,/MoonDogDevicePreferences\?\.writeLanding\(/);
  assert.match(app,/if\(ui\["view-home"\]\?\.classList\.contains\("active"\)\)/);
});
