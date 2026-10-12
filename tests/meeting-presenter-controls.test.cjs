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
test("only one accessible fullscreen control, with native success and failure handling",()=>{
 assert.match(source,/legacy\.hidden=true/);
 assert.match(source,/legacy\.tabIndex=-1/);
 assert.match(source,/legacy\.setAttribute\("aria-hidden","true"\)/);
 assert.match(source,/current\.requestFullscreen\(\)/);
 assert.match(source,/document\.exitFullscreen\(\)/);
 assert.match(source,/button\.disabled=true/);
 assert.match(source,/finally\{button\.disabled=false;syncFullscreenLabel\(\);\}/);
 assert.match(source,/document\.addEventListener\("fullscreenchange",syncFullscreenLabel\)/);
 assert.match(css,/#view-meeting\.meeting-scoreboard \.meeting-scoreboard-actions #meetingFullscreen\[hidden\]/);
});
test("full/embedded progress ring does not wrap its percentage or lose priority",()=>{
 assert.match(css,/\.arena-advisor \.aa-circle b\{[\s\S]*?white-space:nowrap!important/);
 assert.match(css,/\.arena-advisor \.aa-circle\{[\s\S]*?min-width:128px/);
 assert.match(css,/\.arena-advisor \.aa-daily strong\{[\s\S]*?white-space:nowrap/);
 assert.match(css,/\.arena-advisor \.aa-next>span,\.arena-advisor \.aa-next>strong\{[\s\S]*?text-shadow:none!important/);
});
test("browser proof physically exercises presentation controls and percent bounds",()=>{
 for(const term of ['[data-pause]','[data-next]','[data-fullscreen]','__arenaDomMoves','percentFits','fullscreenEnabled','document.fullscreenElement']){
  assert.ok(browser.includes(term),term);
 }
 for(const size of ["1920,1080","1600,900","1366,768"])assert.ok(browser.includes(size),size);
});
