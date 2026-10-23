"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const source=fs.readFileSync(path.join(root,"src/meeting-presenter.js"),"utf8");
const runtime=fs.readFileSync(path.join(root,"assets/daily-ops.js"),"utf8");
const css=fs.readFileSync(path.join(root,"assets/daily-ops.css"),"utf8");
const browser=fs.readFileSync(path.join(root,"scripts/smoke_overdrive.mjs"),"utf8");

test("installed presenter code exactly mirrors its canonical source",()=>{
 const start="// BEGIN GENERATED MEETING PRESENTER (see src/meeting-presenter.js)";
 const end="// END GENERATED MEETING PRESENTER";
 assert.equal(runtime.split(start)[1].split(end)[0].trim(),source.trim());
});
test("Next and Pause never reappend every advisor card",()=>{
 const paint=source.slice(source.indexOf("  function paint(){"),source.indexOf("  function next(){"));
 assert.doesNotMatch(paint,/\.append\(|\.insertBefore\(|\.replaceChildren\(|\.innerHTML\s*=/);
 assert.match(source,/if\(changed\)\{/);
 assert.match(source,/state\.cardHost=parent;state\.cardNodes=ordered;/);
 assert.match(source,/if\(card\.dataset\.slideActive!==active\)card\.dataset\.slideActive=active;/);
 assert.match(source,/state\.seconds\*1000/);
});
test("visible presentation control never invokes the native Fullscreen API",()=>{
 const app=fs.readFileSync(path.join(root,"assets/app.js"),"utf8");
 assert.match(source,/legacy\.hidden=true/);
 assert.match(source,/legacy\.tabIndex=-1/);
 assert.match(source,/data-presentation>Present<\/button>/);
 assert.match(source,/setPresentationMode\(!state\.presentationMode\)/);
 assert.match(source,/event\.key==="Escape"&&state\.presentationMode/);
 assert.match(source,/view\.classList\.toggle\("presentation-overlay",enabled\)/);
 assert.match(source,/view\.style\.setProperty\(property,value,"important"\)/);
 assert.match(source,/view\.style\.removeProperty\(property\)/);
 assert.match(source,/document\.body\.classList\.toggle\("moondog-presentation-mode",enabled\)/);
 assert.doesNotMatch(source,/\.requestFullscreen\(|\.exitFullscreen\(/);
 assert.doesNotMatch(app,/async function toggleMeetingFullscreen\(\).*requestFullscreen\(/);
 assert.match(app,/function toggleMeetingFullscreen\(\) \{ return globalThis\.__serviceMeetingPresenter\?\.togglePresentation\?\.\(\); \}/);
 assert.match(css,/#view-meeting\.meeting-scoreboard \.meeting-scoreboard-actions #meetingFullscreen\[hidden\]/);
});
test("full/embedded progress ring does not wrap its percentage or lose priority",()=>{
 assert.match(css,/\.arena-advisor \.aa-circle b\{[\s\S]*?white-space:nowrap!important/);
 assert.match(css,/\.arena-advisor \.aa-circle\{[\s\S]*?min-width:128px/);
 assert.match(css,/\.arena-advisor \.aa-daily strong\{[\s\S]*?white-space:nowrap/);
 assert.match(css,/\.arena-advisor \.aa-next>span,\.arena-advisor \.aa-next>strong\{[\s\S]*?text-shadow:none!important/);
});
test("browser proof exercises real presentation controls, geometry and seven slides",()=>{
 for(const term of ['[data-pause]','[data-next]','[data-presentation]','__arenaDomMoves','percentFits','repeatPresentationCycles','__arenaHeartbeat']){
  assert.ok(browser.includes(term),term);
 }
 for(const size of ["1920,1080","1600,900","1366,768"])assert.ok(browser.includes(size),size);
});
test("safe overlay uses a fixed viewport and leaves all dashboard navigation intact",()=>{
 const app=fs.readFileSync(path.join(root,"assets/app.js"),"utf8");
 const meetingCss=fs.readFileSync(path.join(root,"assets/meeting.css"),"utf8");
 assert.match(meetingCss,/#view-meeting\.meeting-scoreboard\.presentation-active\.presentation-overlay\.active/);
 assert.match(meetingCss,/position:fixed!important;inset:0!important/);
 assert.match(meetingCss,/height:auto!important;min-height:0!important;max-height:none!important/);
 assert.match(source,/presentationTiming:\(\)=>/);
 assert.match(source,/requestAnimationFrame\(\(\)=>/);
 assert.doesNotMatch(source,/document\.addEventListener\("fullscreenchange"/);
 assert.doesNotMatch(app,/function toggleMeetingFullscreen\(\)[^\n]*exitFullscreen/);
 assert.match(browser,/Post-exit dashboard navigation proof PASS/);
});
test("legacy staged fullscreen restoration remains absent",()=>{
 assert.doesNotMatch(source,/arena-exiting-fullscreen|restoreArenaAfterExit|content-visibility/);
 assert.doesNotMatch(css,/arena-exiting-fullscreen|content-visibility:hidden!important/);
 assert.doesNotMatch(source,/await new Promise\(resolve=>requestAnimationFrame\(resolve\)\)/);
 assert.match(css,/contain:size layout style paint/);
 assert.match(css,/\.arena-advisor \.aa-next:before/);
});
test("browser stress covers repeated safe exits, Edge-sized pane and event loop stalls",()=>{
 assert.match(browser,/repeatPresentationCycles/);
 assert.match(browser,/__arenaHeartbeat/);
 assert.match(browser,/1000,height:950/);
 assert.match(browser,/maxDrift/);
 assert.match(browser,/__arenaNativeCalls/);
 assert.match(browser,/document\.fullscreenElement/);
});
