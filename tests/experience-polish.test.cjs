"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const app=fs.readFileSync(path.join(root,"assets/app.js"),"utf8");
const stylesheet=fs.readFileSync(path.join(root,"assets/daily-ops.css"),"utf8");
const start="/* BEGIN PREMIUM EXPERIENCE FINISH */";
const end="/* END PREMIUM EXPERIENCE FINISH */";
const css=stylesheet.split(start)[1]?.split(end)[0]||"";
const source=fs.readFileSync(path.join(root,"src/meeting-presenter.css"),"utf8");
const bundle=fs.readFileSync(path.join(root,"assets/meeting.css"),"utf8");

test("premium finish loads from existing, Stable-restorable offline runtime CSS",()=>{
 const meeting=html.indexOf('href="assets/meeting.css"');
 const daily=html.indexOf('href="assets/daily-ops.css"');
 const application=html.indexOf('src="assets/app.js"');
 assert.ok(meeting>=0&&daily>meeting&&application>daily);
 assert.ok(css.length>12000,"Premium design rules must be present");
 assert.doesNotMatch(html,/experience-polish\.css/);
 assert.match(app,/const HANDOFF_RUNTIME_PATHS=\[[^;]*"assets\/daily-ops\.css"/);
 assert.doesNotMatch(app,/HANDOFF_RUNTIME_PATHS=\[[^;]*experience-polish\.css/);
});
test("meeting configuration remains editable and customer voice controls survive",()=>{
 assert.match(html,/class="card settings-card meeting-config-premium"/);
 for(const id of ["meetingDay","meetingStart","meetingReset","grossMinimum","grossStretch","csiPeriodStart","meetingVoiceSurvey","settingsSaveStatus"]){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(css,/#view-settings \.meeting-config-premium>\.settings-grid/);
 assert.match(css,/#view-settings>\.customer-voice-manager/);
 assert.match(css,/html\[data-theme="dark"\]/);
});
test("TV polish is limited to the original Arena and preserves unavailable/closed distinction",()=>{
 for(const token of [".meeting-scoreboard-head",".meeting-presenter-controls",".arena-store .as-chart",".arena-store .as-bar.closed",".arena-store .as-bar.absent",".arena-store .as-challenge",".arena-advisor .aa-money",".arena-advisor .aa-next"]){
  assert.ok(css.includes(token),token);
 }
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/orientation:portrait/);
 assert.match(css,/max-height:800px/);
 assert.doesNotMatch(css,/@import|url\(\s*https?:|@font-face|fetch\(|XMLHttpRequest/);
});
test("canonical Arena-generated stylesheet remains byte-mirrored to its source",()=>{
 const genStart="/* BEGIN GENERATED MEETING LAYOUT (see src/meeting-presenter.css) */";
 const genEnd="/* END GENERATED MEETING LAYOUT */";
 assert.equal(bundle.split(genStart)[1].split(genEnd)[0].trim(),source.trim());
});
