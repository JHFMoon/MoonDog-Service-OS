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
 assert.match(source,/document\.documentElement\.requestFullscreen\(\)/);
 assert.match(source,/document\.exitFullscreen\(\)/);
 assert.match(source,/button\.disabled=true/);
 assert.match(source,/finally\{button\.disabled=false;button\.removeAttribute\("aria-busy"\);syncFullscreenLabel\(\);restartTimer\(\);\}/);
 assert.match(source,/document\.addEventListener\("fullscreenchange",onFullscreenChange\)/);
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

test("Arena fullscreen leaves entire dashboard CSS alone and keeps runtime diagnostics local",()=>{
 const app=fs.readFileSync(path.join(root,"assets/app.js"),"utf8");
 assert.match(app,/classList\.toggle\("meeting-fullscreen", document\.fullscreenElement === document\.documentElement && !arenaIsPresenting\)/);
 assert.doesNotMatch(app,/classList\.toggle\("meeting-fullscreen", active\)/);
 assert.match(css,/#view-meeting\.meeting-scoreboard\.presentation-active:fullscreen/);
 assert.match(css,/:root:fullscreen #view-meeting\.meeting-scoreboard\.presentation-active\.active/);
 assert.match(css,/contain:layout style paint/);
 assert.match(source,/fullscreenTiming:\(\)=>/);
 assert.match(source,/transition\.eventMs=Math\.round\(performance\.now\(\)-transition\.startedAt\)/);
 assert.match(source,/transition\.frameMs=Math\.round\(performance\.now\(\)-transition\.startedAt\)/);
 assert.match(source,/button\.textContent=entering\?"Opening…":"Exiting…"/);
});
test("Real Chrome smoke bounds enter/exit latency and tests with no-reduction motion",()=>{
 assert.match(browser,/syntheticNonMeetingView/);
 assert.match(browser,/entry\.globallyRestyled/);
 assert.match(browser,/timing\.eventMs>2200\|\|entry\.timing\.frameMs>3300/);
 assert.match(browser,/exit\.eventMs>2200\|\|exit\.frameMs>3300/);
 assert.match(browser,/reducedMotion:width===1600\?"no-preference":"reduce"/);
});

test("Unsafe Beta 44 staging is absent from current code and installed runtime",()=>{
 assert.doesNotMatch(source,/arena-exiting-fullscreen|restoreArenaAfterExit|content-visibility/);
 assert.doesNotMatch(css,/arena-exiting-fullscreen|content-visibility:hidden!important/);
 assert.match(source,/stopTimer\(\);\s*await document\.exitFullscreen\(\)/);
 assert.doesNotMatch(source,/await new Promise\(resolve=>requestAnimationFrame\(resolve\)\)/);
 assert.match(source,/finally\{button\.disabled=false;button\.removeAttribute\("aria-busy"\);syncFullscreenLabel\(\);restartTimer\(\);\}/);
 assert.match(css,/contain:size layout style paint/);
 assert.match(css,/\.arena-advisor \.aa-next:before/);
});
test("Browser stress covers repeated exits, restored narrow viewport and event-loop stalls",()=>{
 assert.match(source,/transition\.restoredMs=Math\.round\(performance\.now\(\)-transition\.startedAt\)/);
 assert.match(browser,/repeatExitCycles/);
 assert.match(browser,/__arenaHeartbeat/);
 assert.match(browser,/1000,height:950/);
 assert.match(browser,/maxDrift/);
 assert.match(browser,/document\.fullscreenElement/);
});
