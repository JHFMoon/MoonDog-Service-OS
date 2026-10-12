"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const css=fs.readFileSync(path.join(root,"assets/experience-polish.css"),"utf8");
const app=fs.readFileSync(path.join(root,"assets/app.js"),"utf8");
const source=fs.readFileSync(path.join(root,"src/meeting-presenter.css"),"utf8");
const bundle=fs.readFileSync(path.join(root,"assets/meeting.css"),"utf8");

test("premium finish is part of the installed runtime, loaded after base and daily styles",()=>{
 const base=html.indexOf('href="assets/meeting.css"');
 const daily=html.indexOf('href="assets/daily-ops.css"');
 const finish=html.indexOf('href="assets/experience-polish.css"');
 const app=html.indexOf('src="assets/app.js"');
 assert.ok(base>=0&&daily>base&&finish>daily&&app>finish);
 assert.equal(html.split('href="assets/experience-polish.css"').length,2);
});
test("offline update includes the premium stylesheet in its explicit runtime catalog",()=>{
 assert.match(app,/const HANDOFF_RUNTIME_PATHS=\[[^;]*"assets\/experience-polish\.css"/);
});
test("meeting configuration remains real editable settings and other panels remain available",()=>{
 assert.match(html,/class="card settings-card meeting-config-premium"/);
 for(const id of ["meetingDay","meetingStart","meetingReset","grossMinimum","grossStretch","csiPeriodStart","meetingVoiceSurvey","settingsSaveStatus"]){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(css,/#view-settings \.meeting-config-premium>\.settings-grid/);
 assert.match(css,/#view-settings>\.customer-voice-manager/);
 assert.match(css,/html\[data-theme="dark"\]/);
});
test("TV changes are limited to the existing broadcast layout",()=>{
 for(const token of [".meeting-scoreboard-head",".meeting-presenter-controls",".arena-store .as-chart",".arena-store .as-bar.closed",".arena-store .as-bar.absent",".arena-store .as-challenge",".arena-advisor .aa-money",".arena-advisor .aa-next"]){
  assert.ok(css.includes(token),token);
 }
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/orientation:portrait/);
 assert.match(css,/max-height:800px/);
 assert.doesNotMatch(css,/@import|url\(\s*https?:|@font-face|fetch\(|XMLHttpRequest/);
});
test("canonical Arena-generated stylesheet is still identical to its source",()=>{
 const start="/* BEGIN GENERATED MEETING LAYOUT (see src/meeting-presenter.css) */";
 const end="/* END GENERATED MEETING LAYOUT */";
 assert.equal(bundle.split(start)[1].split(end)[0].trim(),source.trim());
});
