"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const app=fs.readFileSync(path.join(root,"assets/app.js"),"utf8");
const start=app.indexOf("  function showMeetingPanel(panel) {");
const end=app.indexOf("  function toggleMeetingFullscreen()",start);
assert.ok(start>=0&&end>start,"Review production meeting panel switch if its source moves");
const source=app.slice(start,end);
function button(){
  const attrs=new Map();
  return {attrs,classList:{active:false,toggle(name,active){assert.equal(name,"active");this.active=active;}},
    setAttribute(name,value){attrs.set(name,value);},
    getAttribute(name){return attrs.get(name)??null;}};
}
function synthetic(){
  const ui={
    meetingSapr:button(),meetingCsi:button(),
    meetingSaprPanel:{hidden:false,dataset:{period:"Synthetic SAPR period"}},
    meetingCsiPanel:{hidden:true,dataset:{period:"Synthetic CSI period"}},
    meetingPeriod:{textContent:""}
  };
  const toggle=new Function("ui",source+";return showMeetingPanel;")(ui);
  return {ui,toggle};
}
test("initial native meeting view buttons declare their selection and controlled panels",()=>{
  const sapr=html.match(/<button id="meetingSapr"[^>]*>/)?.[0];
  const csi=html.match(/<button id="meetingCsi"[^>]*>/)?.[0];
  assert.ok(sapr&&csi,"The two original navigation buttons remain present");
  assert.match(sapr,/type="button"/);
  assert.match(sapr,/aria-pressed="true"/);
  assert.match(sapr,/aria-controls="meetingSaprPanel"/);
  assert.match(csi,/type="button"/);
  assert.match(csi,/aria-pressed="false"/);
  assert.match(csi,/aria-controls="meetingCsiPanel"/);
  assert.match(html,/id="meetingSaprPanel"/);
  assert.match(html,/id="meetingCsiPanel"/);
});
test("switching from SAPR to CSI updates visual, content and accessible selection together",()=>{
  const {ui,toggle}=synthetic();
  toggle("csi");
  assert.equal(ui.meetingSaprPanel.hidden,true);
  assert.equal(ui.meetingCsiPanel.hidden,false);
  assert.equal(ui.meetingSapr.classList.active,false);
  assert.equal(ui.meetingCsi.classList.active,true);
  assert.equal(ui.meetingSapr.getAttribute("aria-pressed"),"false");
  assert.equal(ui.meetingCsi.getAttribute("aria-pressed"),"true");
  assert.equal(ui.meetingPeriod.textContent,"Synthetic CSI period");
});
test("returning to SAPR restores accessible state and original report period",()=>{
  const {ui,toggle}=synthetic();
  toggle("csi");
  toggle("sapr");
  assert.equal(ui.meetingSaprPanel.hidden,false);
  assert.equal(ui.meetingCsiPanel.hidden,true);
  assert.equal(ui.meetingSapr.classList.active,true);
  assert.equal(ui.meetingCsi.classList.active,false);
  assert.equal(ui.meetingSapr.getAttribute("aria-pressed"),"true");
  assert.equal(ui.meetingCsi.getAttribute("aria-pressed"),"false");
  assert.equal(ui.meetingPeriod.textContent,"Synthetic SAPR period");
});
test("reselecting active report is safe and does not invent or erase a report",()=>{
  const {ui,toggle}=synthetic();
  toggle("sapr");toggle("sapr");
  assert.equal(ui.meetingSapr.getAttribute("aria-pressed"),"true");
  assert.equal(ui.meetingCsi.getAttribute("aria-pressed"),"false");
  assert.equal(ui.meetingPeriod.textContent,"Synthetic SAPR period");
  assert.match(source,/ui\.meetingSaprPanel\.dataset\.period/);
  assert.match(source,/ui\.meetingCsiPanel\.dataset\.period/);
});
