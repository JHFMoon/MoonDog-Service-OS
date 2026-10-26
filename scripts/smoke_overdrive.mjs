#!/usr/bin/env node
// Arena TV browser geometry proof, all synthetic, without operational Workspace access.
import {createRequire} from "node:module";
const {chromium}=createRequire(import.meta.url)("playwright");
import fs from "node:fs";import path from "node:path";import {pathToFileURL} from "node:url";
import {summarizeNavigationMs} from "./navigation-metrics.mjs";
const launcher=process.argv[2],out=process.argv[3]||".clean-install-smoke/arena-proof";
if(!launcher)throw Error("usage: smoke_overdrive.mjs <launcher> [output]");
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.env.MOONDOG_BROWSER_CHANNEL||undefined});
let packagedAppPath=null,packagedAppOriginal=null;
try{
 // Expose the unmodified production renderer only in the temporary extracted
 // clean-install copy, so the DOM benchmark can invoke it deterministically.
 packagedAppPath=path.join(path.dirname(path.resolve(launcher)),"System Files","assets","app.js");
 packagedAppOriginal=fs.readFileSync(packagedAppPath,"utf8");
 const renderBridgeMarker="globalThis.__moondogDaily = Object.freeze({";
 if(packagedAppOriginal.split(renderBridgeMarker).length!==2)
   throw Error("Production Manager Home renderer bridge location is not unique");
 fs.writeFileSync(packagedAppPath,
   packagedAppOriginal.replace(renderBridgeMarker,
     "globalThis.__moondogManagerHomeRenderProbe=renderAll;\n"+renderBridgeMarker));

 for(const [width,height] of [[1920,1080],[1600,900],[1366,768]]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:width===1600?"no-preference":"reduce"});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  // Repeated synthetic file:// launcher-to-shell timings in an already-running
  // browser process. These measure app/tab startup, not process-cold device startup.
  const launcherToShellSamples=[];
  for(let sample=0;sample<5;sample++){
    const launcherStarted=performance.now();
    await page.goto(pathToFileURL(path.resolve(launcher)).href,{waitUntil:"load",timeout:30000});
    await page.waitForURL(u=>u.protocol==="file:"&&u.pathname.endsWith("/index.html"),{timeout:15000});
    await page.waitForSelector("#view-meeting",{state:"attached",timeout:15000});
    launcherToShellSamples.push(Math.round(performance.now()-launcherStarted));
  }
  const launcherStartup=summarizeNavigationMs(launcherToShellSamples);
  const launcherToShellAttachedMs=launcherStartup.p50;
  console.log("Synthetic file:// launcher-to-shell startup",
    JSON.stringify({scope:"5 app/tab launches; browser process already running; shell attachment only; no connected folder/filesystem latency",
      samples:launcherToShellSamples,...launcherStartup}));
  // Measure browser navigation shell activation under packaged file://.
  // This stops at the active-view DOM state and excludes connected Workspace reads,
  // deferred report rendering, and installed-device or OneDrive latency.
  const navigationViews = ["overview", "tools", "arrivals", "assign-next", "performance", "meeting", "open-ro", "imports", "settings", "home"];
  await page.evaluate(() => {
    globalThis.__moondogNavigationSamples = [];
    document.addEventListener("click", event => {
      const button = event.target?.closest?.(".nav-item[data-view]");
      if (!button) return;
      const view = button.dataset.view;
      const started = performance.now();
      const target = document.getElementById("view-" + view);
      let finished = false;
      const observer = new MutationObserver(() => {
        if (!finished && target?.classList.contains("active")) {
          finished = true;
          globalThis.__moondogNavigationSamples.push({ view, ms: performance.now() - started });
          observer.disconnect();
        }
      });
      observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
      setTimeout(() => observer.disconnect(), 5000);
    }, true);
  });
  for (let cycle = 0; cycle < 5; cycle += 1) {
    for (const view of navigationViews) {
      const expected = await page.evaluate(() => globalThis.__moondogNavigationSamples.length + 1);
      await page.locator('.nav-item[data-view="' + view + '"]').evaluate(button => {
        if (!button.isConnected) throw new Error("Navigation button is detached: " + button.dataset.view);
        // Secondary destinations are intentionally hidden in this UI. Invoke
        // the real control's click handler without changing shipped visibility.
        button.click();
      });
      await page.waitForFunction(({ view, expected }) => {
        return document.getElementById("view-" + view)?.classList.contains("active") &&
          globalThis.__moondogNavigationSamples?.length >= expected;
      }, { view, expected }, { timeout: 5000 });
    }
  }
  const rawNavigation = await page.evaluate(() => globalThis.__moondogNavigationSamples);
  const navigationMetrics = Object.fromEntries(navigationViews.map(view => {
    const samples = rawNavigation.filter(sample => sample.view === view).map(sample => Math.round(sample.ms));
    if (samples.length !== 5) throw new Error("Expected five navigation samples for " + view + ", got " + samples.length);
    return [view, { samples, ...summarizeNavigationMs(samples) }];
  }));
  console.log("Synthetic file:// navigation shell activation", JSON.stringify({
    scope: "5 activations per main tab; no connected Workspace; ends at active-view DOM state; excludes deferred rendering and data reads",
    views: navigationMetrics
  }));

  await page.evaluate(()=>{
   const v=document.querySelector("#view-meeting");
   v.className="view active meeting-view meeting-v3 meeting-scoreboard arena-ready";v.hidden=false;
   const score=(n)=>'<span class="aa-item good"><b>MEASURE '+n+'</b><strong>'+(80+n)+'%</strong><small>ON GOAL</small></span>';
   const lane=(label,tone,offset)=>'<div class="aa-lane '+tone+'"><span class="aa-lane-title">'+label+'</span><div class="aa-lane-items">'+score(offset)+score(offset+1)+'</div></div>';
   const card=(n)=>'<article class="meeting-v3-advisor tv-ready" data-advisor-code="demo-'+n+'"><h3>DEMO ADVISOR '+n+'</h3>'+
    '<section class="advisor-tv arena-advisor ahead">'+
      '<div class="aa-lead"><div class="aa-earnings">'+
        '<span class="aa-kicker">MONTH TO DATE <i>/ OCT 11</i></span>'+
        '<div class="aa-money">$23.1K</div>'+ 
        '<div class="aa-goal"><b>'+String(55)+'% COMPLETE</b><span>MONTHLY BENCHMARK</span></div>'+
        '<div class="aa-race-line"><i style="width:55%"></i><b></b></div>'+
        '<div class="aa-race-caption">ON PACE<small>EXPECTED MONTHLY PRODUCTION</small></div>'+
       '</div><div class="aa-target"><div class="aa-circle"><svg viewBox="0 0 220 220"><circle cx="110" cy="110" r="86" class="aa-ring-bg"/><circle cx="110" cy="110" r="86" class="aa-ring-value" stroke-dasharray="297 540.35" transform="rotate(-90 110 110)"/></svg><span><b>55%</b><small>COMPLETE</small></span></div>'+
       '<div class="aa-daily"><span>NEEDED EACH WORKDAY</span><strong>$1,200</strong><small>SEVERAL WORKDAYS LEFT</small></div>'+
       '<div class="aa-week">LAST 7 DAYS: WAITING FOR OCT 10</div></div></div>'+
      '<div class="aa-bottom"><div class="aa-pulse">'+lane("WINNING","good",1)+lane("ROOM TO GROW","low",3)+lane("LAST REPORTED","past",5)+'</div>'+
      '<div class="aa-next"><span>NEXT WIN ↗</span><strong>ALIGNMENTS</strong><div><b>1 MORE SALE</b><small>BY NEXT MEETING</small></div></div></div></section></article>';
   const bars=Array.from({length:7},(_,i)=>'<div class="as-bar '+(i===5?"absent":"present")+'"><b>'+(i===5?"—":"$"+(i+1)+"K")+'</b><div><i style="height:'+(i===5?2:(20+i*9))+'%"></i></div><span>DAY '+(i+1)+'</span></div>').join("");
   v.innerHTML='<header class="meeting-scoreboard-head"><div><h2>MOONDOG <em>LIVE</em></h2><span>SERVICE TEAM</span></div>'+
    '<div class="meeting-scoreboard-period"><strong>DEMO WEEK</strong><span>LAST 7 DAYS</span><small>SYNTHETIC DATA</small></div><div class="meeting-scoreboard-actions"><button id="meetingFullscreen">Enter full screen</button></div></header>'+
    '<section class="arena-store"><div class="as-upper"><div class="as-tally"><span class="as-eyebrow">THE STORE · THIS MONTH</span><strong>$85.3K</strong><small>UPDATED OCT 11</small><div class="as-week">WAITING FOR OCT 10</div></div>'+
    '<div class="as-chart"><div class="as-chart-title"><span>THE WEEK AT A GLANCE</span><small>DAILY CLOSED GROSS</small></div><div class="as-bars">'+bars+'</div></div></div>'+
    '<div class="as-lower"><div class="as-story"><span>OUR STRONGEST DAY</span><strong>MONDAY</strong><small>$19K CLOSED</small></div>'+
    '<div class="as-signal-bank"><span>TEAM NUMBERS</span><div><span class="as-signal"><b>VEHICLE INSPECTIONS</b><strong>86%</strong><small>CURRENT</small></span></div></div>'+
    '<div class="as-challenge"><span>OUR NEXT WIN ↗</span><strong>ALIGNMENTS</strong><b>ONE MORE SALE</b></div></div></section>'+
    '<section class="meeting-team-story"><article></article><article></article><article></article></section>'+
    '<section class="meeting-scoreboard-voice"></section>'+
    '<footer class="meeting-action-band"><article></article><article></article><article></article></footer>'+
    '<section class="meeting-scoreboard-advisors" id="meetingV3Advisors">'+Array.from({length:6},(_,i)=>card(i+1)).join("")+'</section>';
   globalThis.__serviceMeetingPresenter?.activate();
  });
  await page.waitForTimeout(180);
  const geom=()=>page.evaluate(()=>{
   const v=document.querySelector("#view-meeting"),r=e=>e.getBoundingClientRect();
   const inside=(a,b,tol=5)=>r(a).left>=r(b).left-tol&&r(a).right<=r(b).right+tol&&r(a).top>=r(b).top-tol&&r(a).bottom<=r(b).bottom+tol;
   const overlap=(a,b)=>Math.min(r(a).right,r(b).right)-Math.max(r(a).left,r(b).left)>8 && Math.min(r(a).bottom,r(b).bottom)-Math.max(r(a).top,r(b).top)>8;
   const store=v.querySelector(".arena-store"),slide=v.dataset.presenterSlide;
   if(slide==="store"){
     const upper=store.querySelector(".as-upper"),lower=store.querySelector(".as-lower"),tally=store.querySelector(".as-tally"),chart=store.querySelector(".as-chart");
     return {slide,visible:getComputedStyle(store).display!=="none",inside:inside(upper,store)&&inside(lower,store),
       separated:!overlap(upper,lower)&&!overlap(tally,chart),text:store.innerText.slice(0,100)};
   }
   const card=v.querySelector('.meeting-v3-advisor[data-slide-active="true"]');
   if(!card)return {slide,error:"selected advisor missing"};
   const area=card.querySelector(".arena-advisor"),top=area.querySelector(".aa-lead"),bottom=area.querySelector(".aa-bottom");
   const stage=area.querySelector(".aa-earnings"),pace=area.querySelector(".aa-target"),pulse=area.querySelector(".aa-pulse"),next=area.querySelector(".aa-next");
   const ring=area.querySelector(".aa-circle"),percent=ring.querySelector("b");
   const fits=inside(percent,ring,3)&&getComputedStyle(percent).whiteSpace==="nowrap"&&
     percent.getBoundingClientRect().height<=ring.getBoundingClientRect().height/2;
   return {slide,visible:getComputedStyle(area).display!=="none",inside:inside(top,area)&&inside(bottom,area),
     separated:!overlap(top,bottom)&&!overlap(stage,pace)&&!overlap(pulse,next),
     percentFits:fits,text:card.querySelector("h3").innerText};
  });
  const store=await geom();
  if(store.slide!=="store"||!store.visible||!store.inside||!store.separated)
    throw Error("Store TV geometry "+width+"x"+height+": "+JSON.stringify(store));
  await page.screenshot({path:path.join(out,"store-"+width+".png")});
  const visiblePresentation=await page.locator(".meeting-scoreboard-actions button").evaluateAll(buttons=>
    buttons.filter(b=>b.getClientRects().length&&getComputedStyle(b).display!=="none"&&/^present$/i.test(b.textContent.trim())).length);
  if(visiblePresentation!==1)throw Error("Expected one safe presentation control, got "+visiblePresentation);
  await page.evaluate(()=>{
    globalThis.__arenaDomMoves=0;
    const host=document.getElementById("meetingV3Advisors");
    new MutationObserver(mutations=>{
      globalThis.__arenaDomMoves+=mutations.filter(m=>m.type==="childList").length;
    }).observe(host,{childList:true});
  });
  await page.locator(".meeting-presenter-controls [data-pause]").click();
  if((await page.locator(".meeting-presenter-controls [data-pause]").textContent()).trim()!=="Resume")
    throw Error("Pause button did not switch to Resume");
  await page.locator(".meeting-presenter-controls [data-next]").click();
  await page.waitForTimeout(130);
  const advisor=await geom();
  if(advisor.slide!=="advisor"||!advisor.visible||!advisor.inside||!advisor.separated||!advisor.percentFits)
    throw Error("Advisor TV geometry / percentage "+width+"x"+height+": "+JSON.stringify(advisor));
  await page.screenshot({path:path.join(out,"advisor-"+width+".png")});
  await page.locator(".meeting-presenter-controls [data-next]").click();
  if((await page.evaluate(()=>globalThis.__arenaDomMoves))!==0)
    throw Error("Next/Pause caused unnecessary advisor DOM reordering");
  await page.locator(".meeting-presenter-controls [data-pause]").click();
  if((await page.locator(".meeting-presenter-controls [data-pause]").textContent()).trim()!=="Pause")
    throw Error("Resume button did not restart presentation");
  // Guard against the exact API responsible for the repeated Windows Edge freeze.
  // The application's safe Present control must never call either method.
  await page.evaluate(()=>{
    globalThis.__arenaNativeCalls=0;
    Object.defineProperty(document.documentElement,"requestFullscreen",{configurable:true,
      value:()=>{globalThis.__arenaNativeCalls++;throw Error("Native fullscreen must not be used");}});
    Object.defineProperty(document,"exitFullscreen",{configurable:true,
      value:()=>{globalThis.__arenaNativeCalls++;throw Error("Native fullscreen exit must not be used");}});
    const main=document.querySelector("main"),hidden=document.createElement("section");
    hidden.id="syntheticNonMeetingView";hidden.className="view";
    hidden.innerHTML=Array.from({length:1600},(_,i)=>'<article class="card"><strong>DEMO ITEM '+i+'</strong><span>SYNTHETIC BACKGROUND CONTENT</span></article>').join("");
    main.append(hidden);
  });
  async function presentationAction(entering){
    const started=performance.now();
    await page.locator(".meeting-presenter-controls [data-presentation]").click({timeout:2500});
    await page.waitForFunction(expected=>{
      const v=document.getElementById("view-meeting");
      return v.classList.contains("presentation-overlay")===expected&&
        document.body.classList.contains("moondog-presentation-mode")===expected;
    },entering,{timeout:1000});
    // Judge click-to-interactive, including a rendered animation frame.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));
    const elapsed=Math.round(performance.now()-started);
    if(elapsed>500)throw Error("Safe presentation toggle exceeded 500ms: "+elapsed+"ms");
    if(await page.evaluate(()=>globalThis.__arenaNativeCalls)!==0)
      throw Error("The safe presentation invoked the native Fullscreen API");
    return elapsed;
  }
  const openMs=await presentationAction(true);
  const overlay=await page.evaluate(()=>{
    const v=document.getElementById("view-meeting"),r=v.getBoundingClientRect();
    const probe=document.createElement("div");
    probe.style.cssText="position:fixed;inset:0 auto auto 0;width:1px;height:100dvh;pointer-events:none";
    document.body.append(probe);
    const cssDvh=probe.getBoundingClientRect().height;
    probe.remove();
    const computed=getComputedStyle(v),heightRules=[];
    function walkRules(rules,sheet){
      for(const rule of rules){
        if(rule.selectorText&&rule.style?.length){
          try{
            if(v.matches(rule.selectorText)&&(rule.style.height||rule.style.minHeight))
              heightRules.push({sheet,selector:rule.selectorText,height:rule.style.height,
                heightPriority:rule.style.getPropertyPriority("height"),minHeight:rule.style.minHeight});
          }catch(_){}
        }else if(rule.cssRules){
          try{if(!rule.conditionText||matchMedia(rule.conditionText).matches)walkRules(rule.cssRules,sheet);}catch(_){}
        }
      }
    }
    for(const sheet of document.styleSheets){
      try{walkRules(sheet.cssRules,sheet.href?.split("/").at(-1)||"inline");}catch(_){}
    }
    return {top:r.top,left:r.left,width:r.width,height:r.height,heightRules:heightRules.slice(-22),
      vw:innerWidth,vh:innerHeight,cssDvh,
      computedHeight:computed.height,computedMinHeight:computed.minHeight,
      inlineHeight:v.style.height,matchedOverlay:v.matches(".presentation-overlay.active"),
      visualViewport:window.visualViewport?.height,
      position:computed.position,
      native:Boolean(document.fullscreenElement),
      topElement:document.elementFromPoint(innerWidth/2,innerHeight/2)?.closest("#view-meeting")===v};
  });
  if(Math.abs(overlay.top)>2||Math.abs(overlay.left)>2||
     Math.abs(overlay.width-overlay.vw)>3||Math.abs(overlay.height-overlay.vh)>3||
     overlay.position!=="fixed"||overlay.native||!overlay.topElement)
    throw Error("Safe presentation is not a true interactive viewport overlay "+JSON.stringify(overlay));
  await page.screenshot({path:path.join(out,"presentation-"+width+".png")});
  const exitMs=await presentationAction(false);
  const restoredInlineStyles=await page.evaluate(()=>{
    const style=document.getElementById("view-meeting").style;
    return !style.height&&!style.minHeight&&!style.maxHeight;
  });
  if(!restoredInlineStyles)throw Error("Safe presentation left inline viewport sizing behind");
  const beforeNext=await page.locator(".meeting-presenter-controls [data-slide-label]").textContent();
  await page.locator(".meeting-presenter-controls [data-next]").click({timeout:1500});
  const afterNext=await page.locator(".meeting-presenter-controls [data-slide-label]").textContent();
  if(afterNext===beforeNext)throw Error("Next was unresponsive after safe presentation exit");
  for(let i=0;i<6;i++)await page.evaluate(()=>globalThis.__serviceMeetingPresenter.next());
  // Escape is an independent, keyboard-only exit. No native fullscreen event.
  await presentationAction(true);
  await page.keyboard.press("Escape");
  await page.waitForFunction(()=>!document.body.classList.contains("moondog-presentation-mode"),null,{timeout:1000});
  if(await page.evaluate(()=>globalThis.__arenaNativeCalls)!==0)throw Error("Escape called native fullscreen");
  console.log("Safe presentation viewport proof",width,height,"enter",openMs+"ms","exit",exitMs+"ms");
  await page.evaluate(()=>document.getElementById("syntheticNonMeetingView")?.remove());
  for(let i=0;i<5;i++)await page.evaluate(()=>globalThis.__serviceMeetingPresenter?.next());
  const cycle=await geom();
  if(cycle.slide!=="store")throw Error("Seven-slide rotation did not return to Store "+JSON.stringify(cycle));
  // Moving from a wide monitor into an ~830px Edge Split Screen pane must
  // reflow the entire stage without clipping the Store cards or breaking controls.
  await page.setViewportSize({width:830,height:820});
  await page.waitForTimeout(110);
  const narrowStore=await page.evaluate(()=>{
    const view=document.querySelector("#view-meeting"),store=view.querySelector(".arena-store");
    const lower=store.querySelector(".as-lower"),bounds=e=>e.getBoundingClientRect();
    return {windowWidth:innerWidth,viewportWidth:bounds(view).width,overflow:getComputedStyle(view).overflow,
      lowerInside:bounds(lower).bottom<=bounds(view).bottom+7,
      horizontalOverflow:document.documentElement.scrollWidth>innerWidth+9};
  });
  if(narrowStore.viewportWidth>narrowStore.windowWidth+8||!narrowStore.lowerInside||narrowStore.horizontalOverflow)
    throw Error("Split-pane Store is clipped: "+JSON.stringify(narrowStore));
  await page.locator(".meeting-presenter-controls [data-next]").click();
  await page.waitForTimeout(100);
  const narrowAdvisor=await page.evaluate(()=>{
    const view=document.querySelector("#view-meeting"),card=view.querySelector('.meeting-v3-advisor[data-slide-active="true"]'),
      ring=card?.querySelector(".aa-circle"),pct=ring?.querySelector("b"),next=card?.querySelector(".aa-next");
    if(!pct||!next)return {error:"Advisor stage did not render after resize"};
    const r=e=>e.getBoundingClientRect();
    return {pctText:pct.textContent,pctOneLine:getComputedStyle(pct).whiteSpace==="nowrap",
      pctWithinRing:r(pct).left>=r(ring).left-4&&r(pct).right<=r(ring).right+4,
      nextVisible:r(next).width>120,
      nextBelowTop:r(next).top>=r(card).top,
      horizontalOverflow:document.documentElement.scrollWidth>innerWidth+9};
  });
  if(!narrowAdvisor.pctOneLine||!narrowAdvisor.pctWithinRing||!narrowAdvisor.nextVisible||
      !narrowAdvisor.nextBelowTop||narrowAdvisor.horizontalOverflow)
    throw Error("Split-pane Advisor geometry "+JSON.stringify(narrowAdvisor));
  await page.setViewportSize({width,height});
  await page.waitForTimeout(90);
  const wideAgain=await geom();
  if(wideAgain.slide!=="advisor"||!wideAgain.percentFits||!wideAgain.separated)
    throw Error("Return-to-wide-monitor geometry failed "+JSON.stringify(wideAgain));

  // Stress a 1000px Edge-sized window with repeated CSS-only presentation exits.
  const repeatPresentationCycles=8;
  await page.setViewportSize({width:1000,height:950});
  await page.evaluate(()=>{
    const hb={last:performance.now(),maxDrift:0,samples:0,handle:null};
    hb.handle=setInterval(()=>{
      const now=performance.now();
      hb.maxDrift=Math.max(hb.maxDrift,now-hb.last-75);
      hb.last=now;
      hb.samples++;
    },75);
    globalThis.__arenaHeartbeat=hb;
  });
  for(let repeat=0;repeat<repeatPresentationCycles;repeat++){
    await presentationAction(true);
    if(repeat===3){
      await page.setViewportSize({width:1600,height:900});
      await page.waitForTimeout(60);
      await page.setViewportSize({width:1000,height:950});
    }
    await presentationAction(false);
    const responsive=await page.evaluate(()=>!document.body.classList.contains("moondog-presentation-mode")&&
      !document.getElementById("view-meeting").classList.contains("presentation-overlay"));
    if(!responsive)throw Error("Dashboard remained blocked after safe presentation exit "+repeat);
  }
  const heartbeat=await page.evaluate(()=>{
    const hb=globalThis.__arenaHeartbeat;
    clearInterval(hb.handle);
    return {maxDrift:Math.round(hb.maxDrift),samples:hb.samples};
  });
  // A main thread blocked for seconds is the user's actual failure mode.
  if(heartbeat.maxDrift>1200||heartbeat.samples<7)
    throw Error("Main thread stalled during repeated fullscreen exit "+JSON.stringify(heartbeat));
  console.log("Repeated exit and Edge-window heartbeat",width,height,JSON.stringify(heartbeat));
  await page.setViewportSize({width,height});
  if(width===1600){
    // Edge repro: after exiting safe presentation, every dashboard view must still navigate.
    const navigationStarted=Date.now();
    await page.locator('.nav-item[data-view="home"]').click({timeout:3500});
    await page.waitForFunction(()=>document.getElementById("view-home").classList.contains("active"),null,{timeout:3500});
    await page.locator('.nav-item[data-view="performance"]').click({timeout:3500});
    await page.waitForFunction(()=>document.getElementById("view-performance").classList.contains("active"),null,{timeout:3500});
    await page.locator('.nav-item[data-view="meeting"]').click({timeout:3500});
    await page.waitForFunction(()=>document.getElementById("view-meeting").classList.contains("active"),null,{timeout:3500});
    if(Date.now()-navigationStarted>6500)throw Error("Dashboard navigation stalled after fullscreen exit");
    console.log("Post-exit dashboard navigation proof PASS",Date.now()-navigationStarted+"ms");
    // A successful one-time switch hides repeat-navigation stalls and DOM churn.
    // Exercise actual installed code with data unchanged, tracking the same
    // Meeting/Performance DOM nodes across 12 complete tab-switching cycles.
    // Give both reports one verified first render before pinning their DOM.
    await page.locator('.nav-item[data-view="performance"]').click({timeout:3500});
    await page.waitForTimeout(120);
    await page.locator('.nav-item[data-view="meeting"]').click({timeout:3500});
    await page.waitForTimeout(120);
    const originalNodes=await page.evaluate(()=>{
      const advisor=document.querySelector("#meetingV3Advisors .meeting-v3-advisor");
      const performance=document.querySelector("#performanceChart > *");
      if(!advisor||!performance)throw Error("Performance/Meeting report elements missing from smoke proof");
      advisor.setAttribute("data-navigation-stability-proof","meeting");
      performance.setAttribute("data-navigation-stability-proof","performance");
      return true;
    });
    if(!originalNodes)throw Error("Navigation DOM proof unavailable");
    const navigationTimes=[];
    for(let repeat=0;repeat<12;repeat++){
      for(const destination of ["home","performance","meeting"]){
        const started=Date.now();
        await page.locator('.nav-item[data-view="'+destination+'"]').click({timeout:3500});
        await page.waitForFunction(view=>document.getElementById("view-"+view).classList.contains("active"),destination,{timeout:3500});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));
        const elapsed=Date.now()-started;
        navigationTimes.push(elapsed);
        if(elapsed>850)throw Error("Repeated navigation blocked after Meeting: "+destination+" "+elapsed+"ms");
      }
    }
    const reuse=await page.evaluate(()=>({
      meeting:!!document.querySelector('#meetingV3Advisors .meeting-v3-advisor[data-navigation-stability-proof="meeting"]'),
      performance:!!document.querySelector('#performanceChart > [data-navigation-stability-proof="performance"]')
    }));
    if(!reuse.meeting||!reuse.performance)
      throw Error("Repeated navigation unnecessarily rebuilt unchanged report DOM "+JSON.stringify(reuse));
    const baseline=summarizeNavigationMs(navigationTimes);
    const responsiveness=await page.evaluate(()=>{
      const evidence=globalThis.__moondogResponsiveness?.snapshot?.();
      return evidence?{longTasks:evidence.longTasks,maxLongTaskMs:evidence.maxLongTaskMs}:null;
    });
    const benchmark={schemaVersion:1,dataset:"synthetic-clean-install",
      viewport:{width,height},startupMs:{launcherToShellAttached:launcherToShellAttachedMs},navigationMs:baseline,responsiveness};
    fs.writeFileSync(path.join(out,"navigation-baseline.json"),JSON.stringify(benchmark,null,2)+"\n");
    console.log("Repeated tab-navigation proof PASS",baseline.count+" transitions",
      "p50="+baseline.p50+"ms","p95="+baseline.p95+"ms",
      "max="+baseline.max+"ms","DOM reuse="+JSON.stringify(reuse));
    // Reproduce the user's complete sequence: all five top navigation tabs,
    // Tools > configuration > the small "‹ Tools" back button. Exercise
    // hundreds of synthetic open ROs so this also catches table DOM churn.
    await page.evaluate(()=>{
      const model=globalThis.__moondogDaily?.model;
      if(!model?.state)throw Error("Synthetic RO navigation proof has no model");
      model.state.records=Array.from({length:413},(_,i)=>({
        id:"synthetic-ro-"+i,ro:String(900000+i),advisor:"Demo Advisor",
        advisorCode:"100",customer:"Synthetic Test "+i,
        vehicle:"Synthetic Vehicle",sourceStatus:"Open",daysOpen:i%8,
        management:{status:"Waiting Dispatch",nextAction:"Review synthetic task",
          reviewDate:"2026-10-14",communication:"Updated"}
      }));
    });
    // #58-01 partial baseline: measure warm activation of the production Home tab while
    // 413 synthetic ROs are loaded in memory. This measures tab switching to a frame;
    // it does not claim Home repaint, folder-picker, workspace read, OneDrive, or cache timing.
    const homeActivationMs=[];
    for(let sample=0;sample<9;sample++){
      await page.locator('.nav-item[data-view="performance"]').click({timeout:3500});
      await page.waitForFunction(()=>document.getElementById("view-performance").classList.contains("active"),null,{timeout:3500});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));
      const measured=await page.evaluate(async()=>{
        const started=performance.now();
        document.querySelector('.nav-item[data-view="home"]').click();
        await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
        const home=document.getElementById("view-home");
        const needs=document.getElementById("moondogNeeds");
        return {elapsedMs:performance.now()-started,active:home?.classList.contains("active"),
          managerNeedsAvailable:!!needs};
      });
      if(!measured.active||!measured.managerNeedsAvailable)
        throw Error("Synthetic Home was not usable after navigation: "+JSON.stringify(measured));
      homeActivationMs.push(measured.elapsedMs);
    }
    const homeBaseline=summarizeNavigationMs(homeActivationMs);
    console.log("Synthetic Home warm-tab activation baseline",
      JSON.stringify({scope:"warm production Home tab activation to animation frame; 413 synthetic ROs in memory; excludes Home repaint, connection and filesystem latency",
        viewport:{width,height},...homeBaseline}));
    // #58-01 browser DOM baseline: measure the production renderAll() function with
    // 413 synthetic in-memory Open ROs. The temporary test-only bridge exposes the
    // unchanged renderer only in this extracted copy and is restored in finally.
    // No durable folder connection, browser-cold startup, or OneDrive/device latency is claimed.
    const managerHomeDomMs=[];
    for(let sample=0;sample<9;sample++){
      await page.locator('.nav-item[data-view="performance"]').click({timeout:3500});
      await page.waitForFunction(()=>document.getElementById("view-performance")?.classList.contains("active"),null,{timeout:3500});
      await page.evaluate(()=>{
        const metric=document.getElementById("metricOpen");
        const overview=document.querySelector('.nav-item[data-view="overview"]');
        if(!metric||!overview)throw new Error("Synthetic Manager Home DOM probe is unavailable");
        metric.textContent="__synthetic_home_pending__";
        const render=globalThis.__moondogManagerHomeRenderProbe;
        if(typeof render!=="function")throw new Error("Production Manager Home renderer probe is unavailable");
        globalThis.__moondogManagerHomeStarted=performance.now();
        overview.click();
        render();
      });
      await page.waitForFunction(()=>{
        const view=document.getElementById("view-overview");
        const metric=document.getElementById("metricOpen");
        return view?.classList.contains("active")&&metric?.textContent!=="__synthetic_home_pending__";
      },null,{timeout:5000});
      const rendered=await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>{
        const view=document.getElementById("view-overview");
        const metric=document.getElementById("metricOpen");
        const needs=document.getElementById("moondogNeeds");
        const bounds=view?.getBoundingClientRect();
        return resolve({
          elapsedMs:performance.now()-globalThis.__moondogManagerHomeStarted,
          active:view?.classList.contains("active"),
          visible:!!bounds&&bounds.width>0&&bounds.height>0,
          openCount:Number((metric?.textContent||"").replace(/[^0-9]/g,"")),
          managerContentReady:!!needs&&needs.textContent.trim().length>0
        });
      })));
      if(!rendered.active||!rendered.visible||rendered.openCount!==413||!rendered.managerContentReady)
        throw new Error("Synthetic Manager Home did not render verified in-memory workload: "+JSON.stringify(rendered));
      managerHomeDomMs.push(rendered.elapsedMs);
    }
    const managerHomeDom=summarizeNavigationMs(managerHomeDomMs);
    console.log("Synthetic Manager Home DOM render baseline",JSON.stringify({
      scope:"9 file:// browser samples; production renderAll() invoked in the temporary extracted-copy test harness; 413 synthetic in-memory Open ROs; no durable folder connection or OneDrive timing",
      rowCount:413,viewport:{width,height},...managerHomeDom
    }));
    const navigationArtifact=path.join(out,"navigation-baseline.json");
    const navigationReport=JSON.parse(fs.readFileSync(navigationArtifact,"utf8"));
    navigationReport.managerHomeDom={
      dataset:"synthetic-in-memory-manager-home",
      scope:"Actual production renderAll() DOM after tab activation and explicit render; test-only bridge in the extracted copy; no durable folder connection or OneDrive timing",
      rowCount:413,sampleCount:managerHomeDom.count,viewport:{width,height},
      p50Ms:managerHomeDom.p50,p95Ms:managerHomeDom.p95,maxMs:managerHomeDom.max
    };
    fs.writeFileSync(navigationArtifact,JSON.stringify(navigationReport,null,2)+"\n");
    // The fixture updates model memory directly; refresh the cached table once
    // before timing navigation so the first circuit starts with all 413 synthetic rows.
    await page.locator('.nav-item[data-view="open-ro"]').click({timeout:3500});
    await page.locator("#searchInput").evaluate(input=>{
      input.value="";
      input.dispatchEvent(new Event("input",{bubbles:true}));
    });
    await page.waitForFunction(()=>document.querySelectorAll("#roTable tr[data-id]").length===413,null,{timeout:5000});
    const initialTableRow=await page.locator("#roTable tr[data-id]").first().evaluate(el=>{
      el.dataset.syntheticNavigationProof="preserve";
      return el.dataset.id;
    });
    if(!initialTableRow)throw Error("Synthetic Open RO rows were not rendered before navigation");
    const visitedTimes=[];
    for(let repeat=0;repeat<8;repeat++){
      for(const destination of ["open-ro","assign-next","performance","meeting","tools"]){
        const started=Date.now();
        await page.locator('.nav-item[data-view="'+destination+'"]').click({timeout:3500});
        await page.waitForFunction(view=>document.getElementById("view-"+view).classList.contains("active"),destination,{timeout:3500});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
        visitedTimes.push(Date.now()-started);
      }
      await page.locator('#dailyTools button').filter({hasText:"Change how Service Operations Dashboard works"}).click({timeout:3500});
      await page.waitForFunction(()=>document.getElementById("dailyTools").dataset.category==="settings",null,{timeout:1500});
      const backStarted=Date.now();
      await page.getByRole('button',{name:"‹ Tools"}).click({timeout:3500});
      await page.waitForFunction(()=>document.getElementById("dailyTools").dataset.category==="",null,{timeout:1500});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
      const backMs=Date.now()-backStarted;
      visitedTimes.push(backMs);
      if(backMs>1250)throw Error("Tools back button stalled after full tab circuit: "+backMs+"ms");
      await page.locator('.nav-item[data-view="open-ro"]').click({timeout:3500});
      await page.waitForFunction(()=>document.querySelectorAll("#roTable tr[data-id]").length===413,null,{timeout:5000});
      const row=await page.locator("#roTable tr[data-id]").first().evaluate(el=>({
        id:el.dataset.id,
        marker:el.dataset.syntheticNavigationProof||""
      }));
      if(row.id!==initialTableRow||row.marker!=="preserve")
        throw Error("Open RO first-row DOM identity changed after unchanged navigation: "+JSON.stringify({initialTableRow,row}));
    }
    const routeBaseline=summarizeNavigationMs(visitedTimes);
    if(routeBaseline.count!==48)throw Error("Five-tab and Tools-back timing sample count changed: "+routeBaseline.count);
    console.log("Five-tab and Tools-back proof PASS",
      JSON.stringify({scope:"synthetic 413-row fixture; 5 tabs plus Tools settings/back; click to animation frame",
        ...routeBaseline,rows:413,domReuse:true}));

    // #58-01 partial Open RO workload baseline: synthetic search and editor-open only.
    // No fields are changed or saved; this excludes connection, filesystem, and OneDrive latency.
    const searchOpenMs=[],editorOpenMs=[];
    for(let sample=0;sample<9;sample++){
      const search=await page.evaluate(async()=>{
        const input=document.getElementById("searchInput");
        const started=performance.now();
        input.value="900312";
        input.dispatchEvent(new Event("input",{bubbles:true}));
        await new Promise(resolve=>requestAnimationFrame(resolve));
        return {elapsedMs:performance.now()-started,
          rows:document.querySelectorAll("#roTable tr[data-id]").length,
          id:document.querySelector("#roTable tr[data-id]")?.dataset.id};
      });
      if(search.rows!==1||search.id!=="synthetic-ro-312")
        throw Error("Synthetic Open RO search did not isolate the expected row: "+JSON.stringify(search));
      searchOpenMs.push(search.elapsedMs);
      const editor=await page.evaluate(async()=>{
        const row=document.querySelector('#roTable tr[data-id="synthetic-ro-312"]');
        const button=row?.querySelector("button[data-id]");
        if(!button)throw Error("Synthetic Open RO edit action is missing");
        const started=performance.now();button.click();
        await new Promise(resolve=>requestAnimationFrame(resolve));
        const dialog=document.getElementById("editDialog");
        return {elapsedMs:performance.now()-started,open:dialog?.open,
          title:document.getElementById("dialogTitle")?.textContent};
      });
      if(!editor.open||editor.title!=="RO 900312")
        throw Error("Synthetic Open RO editor did not open the selected row: "+JSON.stringify(editor));
      editorOpenMs.push(editor.elapsedMs);
      await page.locator("#editDialog .dialog-close").first().click({timeout:1500});
      await page.evaluate(()=>{
        const input=document.getElementById("searchInput");input.value="";
        input.dispatchEvent(new Event("input",{bubbles:true}));
      });
      await page.waitForFunction(()=>document.querySelectorAll("#roTable tr[data-id]").length===413,null,{timeout:3500});
    }
    console.log("Synthetic Open RO search/edit timing baseline",
      JSON.stringify({scope:"9 synthetic 413-row fixture samples; search to one result and editor open to animation frame; no edits saved",
        search:summarizeNavigationMs(searchOpenMs),editorOpen:summarizeNavigationMs(editorOpenMs)}));

    // Report manager visual regression: actual packaged file:// runtime, same
    // 928px Edge viewport from James's screenshots, plus reflow/zoom checks.
    await page.locator('.nav-item[data-view="tools"]').click({timeout:3500});
    await page.locator('#dailyTools button').filter({hasText:"Import or refresh data"}).click({timeout:3500});
    await page.waitForFunction(()=>document.getElementById("dailyTools")?.dataset.category==="imports",null,{timeout:3500});
    if(!await page.locator('[data-report-group="now"]').count())throw Error("Report action planner did not render");
    // Synthetic long instructions exercise the same class names without
    // importing any operational or customer data into browser tests.
    await page.evaluate(()=>{
      const host=document.querySelector('.daily-report-dashboard');
      const article=document.createElement('article');article.className='daily-source-row';article.id='synthetic-report-reflow';
      const header=document.createElement('div');header.className='daily-report-head';
      header.innerHTML='<strong>Next Appointments synthetic long report example</strong><span class="daily-report-state">Optional history</span>';
      const content=document.createElement('div');content.className='daily-report-primary';
      const text=document.createElement('div');text.className='daily-report-period';
      text.textContent='Run Next Appointments for 2026-10-01 through 2026-10-12, using a verified report period — optional historical evidence only.';
      const button=document.createElement('button');button.className='daily-report-import';button.textContent='Import Next Appointments';
      content.append(text,button);
      const details=document.createElement('details');details.className='daily-report-details';details.open=true;
      const summary=document.createElement('summary');summary.textContent='Detailed historical coverage';
      const list=document.createElement('ol');
      for(let i=1;i<=10;i++){const li=document.createElement('li');li.textContent='Optional dated report October '+i+' with approved substitute and From/To evidence';list.append(li);}
      details.append(summary,list);article.append(header,content,details);host.append(article);
    });
    for(const size of [928,768,390,320]){
      await page.setViewportSize({width:size,height:860});
      for(const theme of ["dark","light"]){
        await page.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme);
        const metrics=await page.evaluate(()=>{
          const host=document.querySelector('#dailyTools'),bounds=host.getBoundingClientRect();
          const cards=Array.from(host.querySelectorAll('.daily-source-row')).filter(e=>e.getBoundingClientRect().height>0);
          return {hostWidth:bounds.width,hostLeft:bounds.left,hostRight:bounds.right,
            cards:cards.map(card=>{
              const r=card.getBoundingClientRect();
              const heading=card.querySelector('.daily-report-head');
              const text=heading?.getBoundingClientRect();
              return {width:r.width,left:r.left,right:r.right,
                headerWidth:text?.width||0,height:r.height,visible:!!text};
            }),viewport:window.innerWidth};
        });
        if(!metrics.cards.length)throw Error("No visible report cards at "+size+"px");
        if(metrics.cards.some(x=>x.width<170||(x.visible&&x.headerWidth<170)||x.left<metrics.hostLeft-4||x.right>metrics.hostRight+4))
          throw Error("Collapsed report columns at "+size+"px "+theme+" "+JSON.stringify(metrics));
        if(metrics.cards.find(x=>x.height>2500))
          throw Error("Report card excessively tall at "+size+"px "+theme);
        const screenshot=path.join(out,"reports-"+size+"-"+theme+".png");
        await page.screenshot({path:screenshot,fullPage:false});
      }
    }
    await page.setViewportSize({width:1366,height:768});
    const optional=page.locator('[data-report-group="optional"]');
    if(!await optional.count())throw Error("Optional report disclosure missing");
    await optional.locator('summary').first().click();
    await page.locator('[data-report-section="availability"]>summary').click();
    if(!await page.locator('.daily-report-cadence-control select').count())
      throw Error("Report availability controls missing");
    console.log("Report manager file-mode reflow proof PASS", "928/768/390/320px","dark/light","synthetic long report");

    // Universal Paste & Learn must operate under the packaged file:// launcher.
    // The browser uses 300 wholly synthetic ROs; this proof NEVER clicks Commit.
    await page.locator('.nav-item[data-view="tools"]').click({timeout:3500});
    await page.locator('#dailyTools button').filter({hasText:"Paste & Learn"}).click({timeout:3500});
    await page.waitForFunction(()=>document.getElementById("dailyTools")?.dataset.category==="paste",null,{timeout:3500});
    await page.evaluate(()=>{globalThis.__moondogDaily.model.root={name:"SYNTHETIC TEST ONLY"};});
    const initialProgress=await page.locator('.daily-paste-progress').evaluate(el=>({hidden:el.hidden,display:getComputedStyle(el).display}));
    if(!initialProgress.hidden||initialProgress.display!=="none")
      throw Error("Idle paste progress must be hidden: "+JSON.stringify(initialProgress));
    const synthetic=await page.evaluate(()=>{
      const lines=["CDK","Repair Orders","RO #","All: 300 Open: 300 Working: 0 On Hold: 0 Closed: 0"];
      for(let n=0;n<300;n++)lines.push(String(930000+n),"Open","Synthetic Customer",
        "1HGBH41J"+"XMN109186","2022 Synthetic Vehicle","TAG"+n,"110","225",
        "10/12/2026","08:30 AM","10/13/2026","09:00 AM","[C] Synthetic Service");
      return lines.join("\n");
    });
    const prefill=await page.locator('#dailyPasteInput').evaluate(el=>{
      const r=el.getBoundingClientRect(),style=getComputedStyle(el),parents=[];
      for(let p=el;p&&parents.length<8;p=p.parentElement){
        const st=getComputedStyle(p);parents.push({id:p.id,className:String(p.className||"").slice(0,100),
          display:st.display,visibility:st.visibility,hidden:p.hidden,width:p.getBoundingClientRect().width,
          height:p.getBoundingClientRect().height});
      }
      return{rect:{top:r.top,left:r.left,width:r.width,height:r.height},
        disabled:el.disabled,readonly:el.readOnly,display:style.display,visibility:style.visibility,parents};
    });
    console.log("Paste input geometry diagnostic",JSON.stringify(prefill));
    if(prefill.disabled||prefill.readonly||prefill.visibility==="hidden"||
      prefill.rect.height<10||prefill.rect.width<100||
      prefill.parents.some(x=>x.display==="none"||x.visibility==="hidden"||x.hidden))
      throw Error("Paste interface is not visible: "+JSON.stringify(prefill));
    // Verify an ordinary editable text area, then isolate parser timing from
    // Playwright's expensive 40k-character typing/fill action in CI.
    await page.locator('#dailyPasteInput').fill('Sample text',{timeout:10000});
    await page.locator('#dailyPasteInput').evaluate((el,payload)=>{
      el.value=payload;el.dispatchEvent(new Event('input',{bubbles:true}));
    },synthetic);
    const pasteStarted=Date.now();
    await page.getByRole('button',{name:"Understand Text"}).click({timeout:5000});
    await page.waitForFunction(()=>document.querySelector('.daily-paste-status')?.textContent?.includes("Analysis complete"),null,{timeout:18000});
    const pasteMs=Date.now()-pasteStarted;
    const preview=await page.locator('.daily-paste-preview').innerText();
    if(!preview.includes("CDK Repair Orders")||!preview.includes("Records detected: 300")||
       !await page.getByRole('button',{name:"Import Verified Data"}).count())
      throw Error("CDK paste preview did not recognize 300 records: "+preview.slice(0,800));
    if(pasteMs>12000)throw Error("300-record paste preview took "+pasteMs+"ms");
    for(const size of [928,320]){
      await page.setViewportSize({width:size,height:820});
      const geom=await page.locator('#dailyPasteInput').evaluate(el=>{
        const r=el.getBoundingClientRect();return{width:r.width,left:r.left,right:r.right,windowWidth:innerWidth};
      });
      if(geom.width<250||geom.left<0||geom.right>geom.windowWidth+6)
        throw Error("Paste input responsive geometry invalid: "+JSON.stringify(geom));
    }
    await page.setViewportSize({width:1366,height:768});

    const inertCheck=await page.evaluate(()=>{
      globalThis.__pasteHtmlDidExecute=false;
      const hostile='<table><tr><th>RO</th><th>Status</th></tr><tr><td>synthetic</td><td>Open</td></tr></table>'+
        '<script>globalThis.__pasteHtmlDidExecute=true</'+'script>'+
        '<img src="data:," onerror="globalThis.__pasteHtmlDidExecute=true">';
      const out=globalThis.MoonDogPasteLearn.capture('',hostile);
      return{executed:globalThis.__pasteHtmlDidExecute,out};
    });
    if(inertCheck.executed||!inertCheck.out.includes('RO\tStatus')||inertCheck.out.includes('<script'))
      throw Error("HTML-only paste failed inert extraction safety proof");

    console.log("Paste & Learn file-mode proof PASS","300 synthetic ROs",pasteMs+"ms","928/320px");



  }

  // #58-01 synthetic browser proof: exercise the actual packaged file://
  // connector with a memory-only File System Access-compatible folder.
  // This is never the owner's native folder/OneDrive, and cannot measure it.
  if(width===1366){
    const scenarios=[["empty",0,0],["large",2100,0],["large-slow-read",2100,25]];
    for(const [scenario,recordCount,readDelayMs] of scenarios){
      const connectionSamples=[],launcherSamples=[];
      const firstTabSamples={},repeatTabSamples={};
      const connectedEditSamples={search:[],editor:[],noteReveal:[],durableSave:[]};
      const uxTaskSamples=[];
      let uxBrowserErrorCount=0;
      for(let sample=0;sample<9;sample++){
        let connectedPage=null,uxMetrics=null,sampleFailure=null;
        const browserErrors=[];
        try{
          connectedPage=await browser.newPage({viewport:{width:1366,height:768}});
          connectedPage.on("pageerror",error=>browserErrors.push(error.message));
          const launcherStarted=performance.now();
          await connectedPage.goto(pathToFileURL(path.resolve(launcher)).href,{waitUntil:"load",timeout:30000});
          await connectedPage.waitForURL(u=>u.protocol==="file:"&&u.pathname.endsWith("/index.html"),{timeout:15000});
          await connectedPage.waitForFunction(()=>Boolean(globalThis.__moondogDaily?.model&&globalThis.__moondogDailyUI?.renderHome),null,{timeout:15000});
          const launcherToShellMs=performance.now()-launcherStarted;
          const outcome=await connectedPage.evaluate(async ({count,readDelay})=>{
            const api=globalThis.__moondogDaily,model=api.model;
            const notFound=()=>Object.assign(new Error("Synthetic entry missing"),{name:"NotFoundError"});
            const mismatch=()=>Object.assign(new Error("Synthetic kind mismatch"),{name:"TypeMismatchError"});
            const encode=async value=>{
              if(typeof value==="string")return new TextEncoder().encode(value);
              if(value instanceof Blob)return new Uint8Array(await value.arrayBuffer());
              if(value instanceof ArrayBuffer)return new Uint8Array(value);
              if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
              throw Error("Unexpected synthetic file write payload");
            };
            const makeFile=name=>{
              let bytes=new Uint8Array();
              const handle={kind:"file",name,
                queryPermission:async()=>"granted",requestPermission:async()=>"granted",
                isSameEntry:async other=>other===handle,
                async getFile(){
                  const copy=bytes.slice();
                  return {name,size:copy.length,lastModified:Date.now(),
                    text:async()=>{if(readDelay&&/\.json$/.test(name))await new Promise(resolve=>setTimeout(resolve,readDelay));return new TextDecoder().decode(copy);},
                    arrayBuffer:async()=>copy.slice().buffer};
                },
                async createWritable({keepExistingData=false}={}){
                  let draft=keepExistingData?bytes.slice():new Uint8Array(),cursor=0;
                  return {
                    async write(value){
                      if(value&&typeof value==="object"&&value.type==="truncate"){
                        const next=new Uint8Array(value.size||0);next.set(draft.subarray(0,next.length));draft=next;return;
                      }
                      if(value&&typeof value==="object"&&value.type==="seek"){cursor=value.position||0;return;}
                      const operation=value&&typeof value==="object"&&value.type==="write";
                      const data=await encode(operation?value.data:value);
                      const position=operation?(value.position??cursor):cursor;
                      const next=new Uint8Array(Math.max(draft.length,position+data.length));
                      next.set(draft);next.set(data,position);draft=next;cursor=position+data.length;
                    },
                    async truncate(size){const next=new Uint8Array(size);next.set(draft.subarray(0,size));draft=next;},
                    async seek(position){cursor=position;},
                    async close(){bytes=draft.slice();},async abort(){}
                  };
                }
              };
              return handle;
            };
            const makeDirectory=name=>{
              const children=new Map();
              const handle={kind:"directory",name,
                queryPermission:async()=>"granted",requestPermission:async()=>"granted",
                isSameEntry:async other=>other===handle,
                async resolve(other){
                  if(other===handle)return [];
                  for(const [key,child] of children){
                    if(child===other)return [key];
                    if(child.kind==="directory"){
                      const descendant=await child.resolve(other);
                      if(descendant)return [key,...descendant];
                    }
                  }
                  return null;
                },
                async getDirectoryHandle(key,{create=false}={}){
                  let child=children.get(key);
                  if(!child&&create){child=makeDirectory(key);children.set(key,child);}
                  if(!child)throw notFound();
                  if(child.kind!=="directory")throw mismatch();
                  return child;
                },
                async getFileHandle(key,{create=false}={}){
                  let child=children.get(key);
                  if(!child&&create){child=makeFile(key);children.set(key,child);}
                  if(!child)throw notFound();
                  if(child.kind!=="file")throw mismatch();
                  return child;
                },
                async removeEntry(key,{recursive=false}={}){
                  const child=children.get(key);
                  if(!child)throw notFound();
                  if(child.kind==="directory"&&child.children?.size&&!recursive)
                    throw Object.assign(new Error("Not empty"),{name:"InvalidModificationError"});
                  children.delete(key);
                },
                get children(){return children;},
                async *entries(){for(const entry of children)yield entry;},
                async *keys(){for(const [name] of children)yield name;},
                async *values(){for(const [,value] of children)yield value;},
                [Symbol.asyncIterator](){return this.entries();}
              };
              return handle;
            };
            const root=makeDirectory("Synthetic Browser Folder");
            const set=async(parts,value)=>{
              let parent=root;
              for(const part of parts.slice(0,-1))parent=await parent.getDirectoryHandle(part,{create:true});
              const file=await parent.getFileHandle(parts.at(-1),{create:true});
              const stream=await file.createWritable();
              await stream.write(JSON.stringify(value)+"\n");
              await stream.close();
            };
            const settings=JSON.parse(JSON.stringify(model.settings));
            settings.schemaVersion=5;
            settings.advisors={};
            settings.setup={...(settings.setup||{}),completedAt:"2026-10-25T12:00:00.000Z"};
            const records=Array.from({length:count},(_,i)=>({
              id:"synthetic-browser-ro-"+i,ro:String(900000+i),advisor:"Synthetic Advisor",
              advisorCode:"100",customer:i===0?"LONG SYNTHETIC CUSTOMER ".repeat(8):"Synthetic Customer",vehicle:i===0?"LONG SYNTHETIC VEHICLE DESCRIPTION ".repeat(5):"Synthetic Vehicle",
              sourceStatus:"Open",daysOpen:i%8,
              sourceFields:{"RO Number":String(900000+i),"Source Status":"Open","Synthetic Marker":"source-"+i},
              management:{status:"Being Repaired",owner:"Synthetic Existing Owner",
                nextAction:i===0?"LONG SYNTHETIC FOLLOW-UP ACTION ".repeat(6):"Synthetic next step",reviewDate:"2026-10-25",communication:"Updated",
                note:"Synthetic existing note",manualAnnotation:"preserve-"+i}
            }));
            const snapshots=[
              ["settings.json",settings],
              ["current-state.json",{...JSON.parse(JSON.stringify(model.state)),records,closedRecords:[],source:null}],
              ["appointments.json",JSON.parse(JSON.stringify(model.appointments))],
              ["advisor-performance.json",JSON.parse(JSON.stringify(model.performance))],
              ["operational-metrics.json",JSON.parse(JSON.stringify(model.operationalMetrics))],
              ["meeting-cycle.json",JSON.parse(JSON.stringify(model.meetingCycle))],
              ["assign-next.json",{schemaVersion:3,days:{},currentOpenRo:{synthetic:true}}],
              ["auto-import.json",{seen:{}}],
              ["recovery.json",JSON.parse(JSON.stringify(model.recovery))]
            ];
            await set(["System Files","Workspace","data","store-revision.json"],{schemaVersion:1,revision:4});
            for(const [filename,data] of snapshots)await set(["System Files","Workspace","data",filename],data);
            Object.defineProperty(window,"showDirectoryPicker",{configurable:true,value:async()=>root});
            const started=performance.now();
            await api.connect();
            const daily=globalThis.__moondogDailyUI;
            const deadline=performance.now()+8000;
            while((daily.state.loadedRoot!==model.root||daily.state.loading)&&performance.now()<deadline)
              await new Promise(resolve=>setTimeout(resolve,16));
            await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
            const home=document.getElementById("view-home");
            const open=document.getElementById("metricOpen");
            const homeTask=document.getElementById("dailyTask");
            const homeTaskText=homeTask?.textContent||"";
            const homeTaskReady=Boolean(home?.contains(homeTask)&&daily.state.loadedRoot===model.root&&
              !daily.state.loading&&!/Loading your saved work|Connect Service Operations Dashboard|Connecting working folder/.test(homeTaskText)&&
              (homeTask.querySelector(".daily-main-priority")||count===0));
            return {
              connectionToFrameMs:performance.now()-started,
              committed:model.workspaceConnectionCommittedRoot===model.root,
              connected:!!model.root,records:model.state.records.length,
              homeActive:!!home?.classList.contains("active"),
              openCount:Number(open?.textContent),
              homeTaskReady,homeTaskVisibleText:homeTaskText.slice(0,180)
            };
          },{count:recordCount,readDelay:readDelayMs});
          const launcherToFrameMs=launcherToShellMs+outcome.connectionToFrameMs;
          if(!outcome.committed||!outcome.connected||!outcome.homeActive||
             outcome.records!==recordCount||outcome.openCount!==recordCount||!outcome.homeTaskReady)
            throw Error("Synthetic browser connected Home is not verified: "+JSON.stringify(outcome));
          if(browserErrors.length)throw Error("Synthetic browser connection page errors: "+browserErrors.join("; "));
          connectionSamples.push(outcome.connectionToFrameMs);
          launcherSamples.push(launcherToFrameMs);
          // #58-03: measure first-open and repeat navigation on the same
          // committed synthetic Workspace, after the verified Home frame.
          if(scenario==="large"){
            const views=["open-ro","assign-next","performance","meeting","arrivals","home"];
            for(let pass=0;pass<2;pass++){
              for(const view of views){
                const measurement=await connectedPage.evaluate(async v=>{
                  const tab=document.querySelector('.nav-item[data-view="'+v+'"]');
                  if(!tab)throw Error("Missing synthetic tab "+v);
                  const started=performance.now();
                  tab.click();
                  // Navigation activates the shell immediately; expensive
                  // Open RO/Performance/Meeting builds are deferred through
                  // rAF + setTimeout. Time the activation frame separately,
                  // then wait for queued render work before the next tab.
                  await new Promise(resolve=>requestAnimationFrame(resolve));
                  const ms=performance.now()-started;
                  await new Promise(resolve=>setTimeout(resolve,80));
                  await new Promise(resolve=>requestAnimationFrame(resolve));
                  const target=document.getElementById("view-"+v);
                  const rows=v==="open-ro"?document.querySelectorAll("#roTable tr[data-id]").length:null;
                  const performanceSourceText=document.getElementById("performanceSource")?.textContent?.trim()||"";
                  // The unrendered HTML shell says "Connect the working
                  // folder to begin". renderPerformance() replaces it with
                  // either a safe no-report state or verified SAPR provenance.
                  const performanceReady=v!=="performance"||Boolean(
                    performanceSourceText&&performanceSourceText!=="Connect the working folder to begin");
                  const meetingFreshness=document.getElementById("meetingV3Freshness")?.textContent?.trim()||"";
                  const meetingComparison=document.getElementById("meetingV3GrossPrior")?.textContent?.trim()||"";
                  // The shell starts as WAITING FOR VERIFIED SOURCES / PRIOR 7
                  // DAYS UNAVAILABLE. Only completed renderMeetingV3Accurate()
                  // changes both to these safe rendered source/no-source labels.
                  const meetingReady=v!=="meeting"||Boolean(
                    meetingFreshness.startsWith("UPDATED THROUGH ")&&
                    meetingComparison.startsWith("Previous 7"));
                  return {ms,active:!!target?.classList.contains("active"),rows,performanceReady,meetingReady};
                },view);
                if(!measurement.active||(view==="open-ro"&&measurement.rows<1)||!measurement.performanceReady||!measurement.meetingReady)
                  throw Error("Synthetic connected tab was not usable: "+JSON.stringify({view,pass,...measurement}));
                const slot=pass===0?firstTabSamples:repeatTabSamples;
                (slot[view==="home"?(pass===0?"homeFirstReturn":"homeRepeatReturn"):view]||=[]).push(measurement.ms);
              }
            }
            // #58-04: measure the real packaged Open RO search, editor, and
            // durable save/read-back path with connected synthetic Workspace data.
            await connectedPage.evaluate(()=>{
              const probe={startedAt:performance.now(),clicks:0,fieldEntries:0,scrollDistancePx:0,previous:new WeakMap()};
              document.addEventListener("click",()=>probe.clicks++,true);
              document.addEventListener("input",event=>{
                if(event.target?.matches?.("input,textarea,select"))probe.fieldEntries++;
              },true);
              document.addEventListener("scroll",event=>{
                const target=event.target===document?document.scrollingElement:event.target;
                if(!target||typeof target.scrollTop!=="number")return;
                const previous=probe.previous.get(target);
                probe.scrollDistancePx+=Math.abs(target.scrollTop-(previous??0));
                probe.previous.set(target,target.scrollTop);
              },true);
              globalThis.__moondogUxTaskProbe=probe;
            });
            const editCycle=await connectedPage.evaluate(async()=>{
              const api=globalThis.__moondogDaily;
              const openTab=document.querySelector('.nav-item[data-view="open-ro"]');
              if(!openTab)throw Error("Open RO navigation control is missing");
              openTab.click();
              const renderDeadline=performance.now()+5000;
              while(document.querySelectorAll("#roTable tr[data-id]").length!==2100&&performance.now()<renderDeadline)
                await new Promise(resolve=>setTimeout(resolve,16));
              await new Promise(resolve=>requestAnimationFrame(resolve));
              const openView=document.getElementById("view-open-ro");
              const visibleRow=document.querySelector('#roTable tr[data-id="synthetic-browser-ro-0"]');
              const viewBounds=openView?.getBoundingClientRect(),rowBounds=visibleRow?.getBoundingClientRect();
              if(!openView?.classList.contains("active")||!viewBounds?.width||!rowBounds?.width||
                document.querySelectorAll("#roTable tr[data-id]").length!==2100)
                throw Error("Connected synthetic Open RO table is not active, visible, and complete before search measurement");
              const search=document.getElementById("searchInput");
              const searchStarted=performance.now();
              search.value="900312";
              search.dispatchEvent(new Event("input",{bubbles:true}));
              await new Promise(resolve=>requestAnimationFrame(resolve));
              const row=document.querySelector('#roTable tr[data-id="synthetic-browser-ro-312"]');
              const rows=document.querySelectorAll("#roTable tr[data-id]");
              const searchMs=performance.now()-searchStarted;
              if(rows.length!==1||!row)throw Error("Synthetic exact Open RO search did not isolate the expected record");
              const button=row.querySelector("button[data-id]");
              if(!button)throw Error("Connected synthetic Open RO edit action is missing");
              const editorStarted=performance.now();
              button.click();
              await new Promise(resolve=>requestAnimationFrame(resolve));
              const dialog=document.getElementById("editDialog");
              const dialogBounds=dialog?.getBoundingClientRect();
              const editorMs=performance.now()-editorStarted;
              if(!dialog?.open||!dialogBounds?.width||!dialogBounds?.height||
                document.getElementById("dialogTitle")?.textContent!=="RO 900312")
                throw Error("Connected synthetic search did not open the matching editor");
              const before=await api.readJson("data/current-state.json");
              const prior=before.records.find(item=>item.id==="synthetic-browser-ro-312");
              if(!prior)throw Error("Selected synthetic record is absent from durable state");
              globalThis.__moondogSearchEditSaveStarted=performance.now();
              return {searchMs,editorMs,sourceFields:prior.sourceFields,
                manualAnnotation:prior.management.manualAnnotation};
            });
            await connectedPage.locator("#editOwner").fill("Synthetic Roundtrip Owner");
            await connectedPage.locator("#editNextAction").fill("Synthetic roundtrip action");
            await connectedPage.locator("#editReviewDate").fill("2026-10-27");
            const noteDisclosure=connectedPage.locator("#editNote").locator("xpath=ancestor::details[1]");
            const disclosureLabel=(await noteDisclosure.locator("summary").textContent()||"").trim();
            if(disclosureLabel!=="Add note")throw Error("Synthetic note editor disclosure label changed: "+disclosureLabel);
            const noteRevealStarted=await connectedPage.evaluate(()=>performance.now());
            await noteDisclosure.locator("summary").click({timeout:3500});
            await connectedPage.locator("#editNote").scrollIntoViewIfNeeded();
            await connectedPage.locator("#editNote").waitFor({state:"visible",timeout:3500});
            const noteRevealMs=await connectedPage.evaluate(started=>performance.now()-started,noteRevealStarted);
            const noteVisible=await connectedPage.locator("#editNote").evaluate(el=>el.checkVisibility?.()??false);
            if(!noteVisible)throw Error("Synthetic note field remained hidden after expanding Add note");
            await connectedPage.locator("#editNote").fill("Synthetic roundtrip note",{timeout:3500});
            // The timer starts after editor entry and field updates, isolating
            // verified persistence and dialog completion from automation typing.
            await connectedPage.evaluate(()=>{globalThis.__moondogSearchEditSaveStarted=performance.now();});
            const beforeSave=await connectedPage.locator("#editForm").evaluate(form=>({
              status:form.querySelector("#editStatus")?.value||"",
              statusDetail:form.querySelector("#editStatusDetail")?.value||"",
              communication:form.querySelector("#editCommunication")?.value||"",
              nextAction:form.querySelector("#editNextAction")?.value||"",
              reviewDate:form.querySelector("#editReviewDate")?.value||"",
              note:form.querySelector("#editNote")?.value||""
            }));
            if(!beforeSave.status||!beforeSave.nextAction||!beforeSave.reviewDate||
              beforeSave.note!=="Synthetic roundtrip note")
              throw Error("Synthetic Open RO form was incomplete before save: "+JSON.stringify(beforeSave));
            await connectedPage.locator("#saveRecordClose").click({timeout:3500});
            let saveWaitError="";
            try{
              await connectedPage.waitForFunction(()=>{
                const dialog=document.getElementById("editDialog"),validation=document.getElementById("editValidation");
                return !dialog?.open||Boolean(validation&&!validation.hidden&&validation.textContent.trim());
              },null,{timeout:15000});
            }catch(error){saveWaitError=String(error);}
            const saveOutcome=await connectedPage.evaluate(()=>({
              dialogOpen:Boolean(document.getElementById("editDialog")?.open),
              validation:document.getElementById("editValidation")?.textContent?.trim()||"",
              status:document.getElementById("editStatus")?.value||"",
              statusDetail:document.getElementById("editStatusDetail")?.value||"",
              communication:document.getElementById("editCommunication")?.value||"",
              connection:document.getElementById("status")?.textContent?.trim()||""
            }));
            if(saveOutcome.validation)
              throw Error("Production Open RO editor rejected the synthetic save: "+JSON.stringify({beforeSave,...saveOutcome}));
            if(saveWaitError)
              throw Error("Timed out waiting for production Open RO save completion: "+JSON.stringify({
                beforeSave,...saveOutcome,waitError:saveWaitError,browserErrors
              }));
            if(saveOutcome.dialogOpen)
              throw Error("Production Open RO save remained pending without validation or dialog completion: "+JSON.stringify({beforeSave,...saveOutcome,browserErrors}));
            const saved=await connectedPage.evaluate(async()=>{
              const elapsedMs=performance.now()-globalThis.__moondogSearchEditSaveStarted;
              const state=await globalThis.__moondogDaily.readJson("data/current-state.json");
              const record=state?.records?.find(item=>item.id==="synthetic-browser-ro-312");
              return {elapsedMs,record};
            });
            if(!saved.record||saved.record.management.owner!=="Synthetic Roundtrip Owner"||
              saved.record.management.nextAction!=="Synthetic roundtrip action"||
              saved.record.management.reviewDate!=="2026-10-27"||
              saved.record.management.note!=="Synthetic roundtrip note"||
              saved.record.management.communication!=="Updated"||
              JSON.stringify(saved.record.sourceFields)!==JSON.stringify(editCycle.sourceFields)||
              saved.record.management.manualAnnotation!==editCycle.manualAnnotation)
              throw Error("Synthetic Open RO edit/read-back lost or changed source/manual data: "+JSON.stringify({
                owner:saved.record?.management?.owner,action:saved.record?.management?.nextAction,
                reviewDate:saved.record?.management?.reviewDate,note:saved.record?.management?.note,
                communication:saved.record?.management?.communication,
                sourceFieldsPreserved:JSON.stringify(saved.record?.sourceFields)===JSON.stringify(editCycle.sourceFields),
                manualAnnotationPreserved:saved.record?.management?.manualAnnotation===editCycle.manualAnnotation
              }));
            uxMetrics=await connectedPage.evaluate(()=>{
              const probe=globalThis.__moondogUxTaskProbe;
              if(!probe)throw Error("Open RO UX task instrumentation was lost");
              return {elapsedMs:performance.now()-probe.startedAt,clickCount:probe.clicks,
                fieldEntryCount:probe.fieldEntries,scrollDistancePx:probe.scrollDistancePx};
            });
            if(browserErrors.length)throw Error("Connected browser page errors: "+browserErrors.join("; "));

            if(sample===8){
              // #60 responsive/keyboard audit on the real packaged file:// app.
              // The connected folder is an in-memory synthetic Workspace only.
              const standardViewports=[
                {label:"320x568",width:320,height:568},{label:"390x844",width:390,height:844},
                {label:"768x1024",width:768,height:1024},{label:"900x1600",width:900,height:1600},
                {label:"1080x1920",width:1080,height:1920},{label:"1280x720",width:1280,height:720},
                {label:"1366x768",width:1366,height:768},{label:"1600x900",width:1600,height:900},
                {label:"1920x1080",width:1920,height:1080},{label:"2560x1440",width:2560,height:1440}
              ];
              // Desktop browser zoom reduces the effective CSS viewport. These
              // test resulting responsive dimensions, not native browser zoom.
              const zoomViewports=[
                {label:"1280x720 at 125%",width:1024,height:576},
                {label:"1280x720 at 150%",width:853,height:480},
                {label:"1366x768 at 125%",width:1093,height:614},
                {label:"1366x768 at 150%",width:911,height:512}
              ];
              const allViews=["overview","tools","arrivals","assign-next","performance","meeting","open-ro","imports","settings","home"];
              const routeResults=[],zoomResults=[],longTextResults=[],failures=[];
              await connectedPage.evaluate(()=>{
                const search=document.getElementById("searchInput");
                if(search){search.value="";search.dispatchEvent(new Event("input",{bubbles:true}));}
              });
              await connectedPage.waitForFunction(()=>document.querySelectorAll("#roTable tr[data-id]").length===2100,null,{timeout:10000});
              async function measureRoute(viewport,view,kind){
                await connectedPage.setViewportSize({width:viewport.width,height:viewport.height});
                await connectedPage.evaluate(async v=>{
                  const tab=document.querySelector('.nav-item[data-view="'+v+'"]');
                  if(!tab)throw Error("Responsive matrix route missing: "+v);
                  tab.click();
                  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
                },view);
                await connectedPage.waitForFunction(v=>document.getElementById("view-"+v)?.classList.contains("active"),view,{timeout:5000});
                await connectedPage.waitForTimeout(35);
                const result=await connectedPage.evaluate(({view,label,kind})=>{
                  const active=document.getElementById("view-"+view);
                  const root=document.scrollingElement||document.documentElement;
                  const visible=el=>{
                    const r=el.getBoundingClientRect(),s=getComputedStyle(el);
                    return r.width>0&&r.height>0&&s.display!=="none"&&s.visibility!=="hidden"&&s.opacity!=="0"&&!el.closest("[hidden]");
                  };
                  const name=el=>{
                    const labelled=el.getAttribute("aria-labelledby")?.split(/\\s+/).map(id=>document.getElementById(id)?.textContent||"").join(" ").trim();
                    const alt=el.querySelector("img[alt]")?.getAttribute("alt")||"";
                    const text=(el.innerText||el.textContent||"").trim();
                    const inputValue=/^(button|submit|reset)$/i.test(el.type||"")?el.value:"";
                    return el.getAttribute("aria-label")||labelled||el.labels?.length||el.getAttribute("title")||alt||inputValue||text;
                  };
                  const controls=[...document.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"]')].filter(visible);
                  const unnamed=controls.filter(el=>!String(name(el)||"").trim()).map(el=>({tag:el.tagName,id:el.id,role:el.getAttribute("role"),type:el.type||null}));
                  const overflowPx=Math.max(0,root.scrollWidth-innerWidth);
                  const viewOverflowPx=active?Math.max(0,active.getBoundingClientRect().right-innerWidth):null;
                  let longText=null;
                  if(view==="open-ro"){
                    const row=document.querySelector('tr[data-id="synthetic-browser-ro-0"]');
                    const cells=row?[...row.cells].filter(cell=>/LONG SYNTHETIC (CUSTOMER|VEHICLE|FOLLOW-UP ACTION)/.test(cell.textContent||"")):[];
                    const clipped=cells.filter(cell=>[cell,...cell.querySelectorAll("*")].some(el=>{
                      const style=getComputedStyle(el);
                      const ellipsis=style.textOverflow==="ellipsis"&&(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1);
                      const clamp=style.webkitLineClamp!=="none"&&style.webkitLineClamp!=="0"&&style.webkitLineClamp!==""&&el.scrollHeight>el.clientHeight+1;
                      return ellipsis||clamp;
                    }));
                    longText={rowFound:!!row,visibleCells:cells.filter(visible).length,expectedCells:3,clippedCells:clipped.length};
                  }
                  return {label,kind,view,width:innerWidth,height:innerHeight,active:!!active?.classList.contains("active"),
                    documentHorizontalOverflowPx:overflowPx,viewRightOverflowPx:viewOverflowPx,
                    visibleControlCount:controls.length,unnamedControlCount:unnamed.length,unnamedControls:unnamed.slice(0,12),longText};
                },{view,label:viewport.label,kind});
                const key=kind+"/"+viewport.label+"/"+view;
                if(!result.active||result.width!==viewport.width||result.height!==viewport.height)
                  failures.push({case:key,reason:"route or viewport did not match",result});
                if(result.documentHorizontalOverflowPx>4||result.viewRightOverflowPx>4)
                  failures.push({case:key,reason:"horizontal page overflow",result});
                if(result.unnamedControlCount>0)
                  failures.push({case:key,reason:"visible controls lack accessible names",result});
                if(view==="open-ro"){
                  longTextResults.push({case:key,...result.longText});
                  if(!result.longText?.rowFound||result.longText.visibleCells!==3||result.longText.clippedCells>0)
                    failures.push({case:key,reason:"long synthetic Open RO text is missing or clipped",longText:result.longText});
                }
                return result;
              }
              for(const viewport of standardViewports)
                for(const view of allViews)routeResults.push(await measureRoute(viewport,view,"standard"));
              const zoomRoutes=["home","open-ro","meeting"];
              for(const viewport of zoomViewports)
                for(const view of zoomRoutes)zoomResults.push(await measureRoute(viewport,view,"zoom-equivalent-css-viewport"));
              await connectedPage.setViewportSize({width:1280,height:720});
              await connectedPage.evaluate(()=>{
                document.querySelector('.nav-item[data-view="home"]')?.click();
                document.activeElement?.blur?.();
              });
              await connectedPage.waitForFunction(()=>document.getElementById("view-home")?.classList.contains("active"),null,{timeout:5000});
              await connectedPage.keyboard.press("Tab");
              const keyboardFocus=await connectedPage.evaluate(()=>{
                const el=document.activeElement,s=getComputedStyle(el),r=el.getBoundingClientRect();
                return {tag:el.tagName,id:el.id||null,accessibleName:el.getAttribute("aria-label")||el.innerText?.trim()||el.textContent?.trim()||null,
                  visible:r.width>0&&r.height>0&&s.display!=="none"&&s.visibility!=="hidden",
                  keyboardFocusVisible:el.matches(":focus-visible"),
                  focusIndicator:(s.outlineStyle!=="none"&&parseFloat(s.outlineWidth)>0)||s.boxShadow!=="none"};
              });
              if(!keyboardFocus.visible||!keyboardFocus.keyboardFocusVisible||!keyboardFocus.focusIndicator)
                failures.push({case:"keyboard focus",reason:"Tab did not expose a visible focus indicator",keyboardFocus});
              const successfulTasks=[...uxTaskSamples.filter(item=>item.success),{success:true,...uxMetrics}];
              const metric=key=>successfulTasks.length?summarizeNavigationMs(successfulTasks.map(item=>item[key])):null;
              const report={schemaVersion:1,dataset:"synthetic-clean-install",
                scope:"Packaged file:// Chromium, in-memory synthetic Workspace, 2,100 synthetic ROs; zoom cases use equivalent CSS viewport dimensions, not native browser zoom or physical displays.",
                routes:allViews,standardViewportCount:standardViewports.length,standardRouteSampleCount:routeResults.length,
                zoomEquivalentViewportCount:zoomViewports.length,zoomEquivalentRouteSampleCount:zoomResults.length,
                routeResults,zoomEquivalentResults:zoomResults,longTextResults,keyboardFocus,
                openRoTaskEffort:{scenario:"search, edit, add note, save, and verify durable read-back",attemptedSamples:uxTaskSamples.length+1,
                  completedSamples:successfulTasks.length,failedSamples:uxTaskSamples.filter(item=>!item.success).length,
                  taskDurationMs:metric("elapsedMs"),clickCount:metric("clickCount"),fieldEntryCount:metric("fieldEntryCount"),scrollDistancePx:metric("scrollDistancePx")},
                failures};
              fs.writeFileSync(path.join(out,"responsive-ux-matrix.json"),JSON.stringify(report,null,2)+"\n");
              if(failures.length)throw Error("Synthetic responsive/accessibility matrix failed: "+JSON.stringify(failures.slice(0,12)));
              console.log("60 responsive, zoom-equivalent, keyboard, long-text, and task-effort evidence",
                JSON.stringify({standardRoutes:routeResults.length,zoomEquivalentRoutes:zoomResults.length,keyboardFocus,
                  longTextSamples:longTextResults.length,openRoTaskEffort:report.openRoTaskEffort}));
            }

            connectedEditSamples.search.push(editCycle.searchMs);
            connectedEditSamples.editor.push(editCycle.editorMs);
            connectedEditSamples.noteReveal.push(noteRevealMs);
            connectedEditSamples.durableSave.push(saved.elapsedMs);
          }
        }catch(error){
          sampleFailure=error;
        }finally{
          try{await connectedPage?.close();}
          catch(error){sampleFailure??=error;}
        }
        uxBrowserErrorCount+=browserErrors.length;
        if(sampleFailure){
          uxTaskSamples.push({sample:sample+1,success:false,errorName:sampleFailure?.name||"Error",
            error:String(sampleFailure?.message||sampleFailure).slice(0,240),browserErrorCount:browserErrors.length});
        }else{
          uxTaskSamples.push({sample:sample+1,success:true,...uxMetrics,browserErrorCount:browserErrors.length});
        }
      }
      if(scenario!=="large"){
        const failedScenarioSamples=uxTaskSamples.filter(sample=>!sample.success);
        if(failedScenarioSamples.length)
          throw Error("Synthetic connected browser scenario failed: "+JSON.stringify({
            scenario,attemptedSamples:uxTaskSamples.length,failedSamples:failedScenarioSamples
          }));
      }
      if(scenario==="large"){
        const completedUxTasks=uxTaskSamples.filter(sample=>sample.success);
        const failedUxTasks=uxTaskSamples.filter(sample=>!sample.success);
        const summarizeUxMetric=key=>completedUxTasks.length
          ?summarizeNavigationMs(completedUxTasks.map(sample=>sample[key])):null;
        const uxWorkflow={schemaVersion:1,dataset:"synthetic-clean-install",
          scenario:"Open RO search, edit, add note, save, and verify durable read-back",records:2100,
          attemptedSamples:uxTaskSamples.length,completedSamples:completedUxTasks.length,
          failedSamples:failedUxTasks.length,errorRate:uxTaskSamples.length
            ?failedUxTasks.length/uxTaskSamples.length:1,
          taskDurationMs:summarizeUxMetric("elapsedMs"),
          clickCount:summarizeUxMetric("clickCount"),
          fieldEntryCount:summarizeUxMetric("fieldEntryCount"),
          scrollDistancePx:summarizeUxMetric("scrollDistancePx"),
          browserErrorCount:uxBrowserErrorCount,sampleResults:uxTaskSamples};
        fs.writeFileSync(path.join(out,"open-ro-workflow-metrics.json"),JSON.stringify(uxWorkflow,null,2)+"\n");
        if(uxTaskSamples.length!==9||failedUxTasks.length!==0||uxBrowserErrorCount!==0||
          completedUxTasks.some(sample=>sample.clickCount!==4||sample.fieldEntryCount<5||
            !Number.isFinite(sample.scrollDistancePx)||sample.scrollDistancePx<0))
          throw Error("Open RO UX task evidence incomplete: "+JSON.stringify(uxWorkflow));
        console.log("60-10 synthetic Open RO task metrics",JSON.stringify(uxWorkflow));
        const summarizeTabs=samples=>Object.fromEntries(
          Object.entries(samples).map(([view,values])=>[view,summarizeNavigationMs(values)]));
        console.log("58-03 synthetic connected Chromium first/repeat tab activation",
          JSON.stringify({records:recordCount,firstVisitOrHomeReturn:summarizeTabs(firstTabSamples),
            repeatVisit:summarizeTabs(repeatTabSamples),
            scope:"9 connected browser page starts, 6 views x 2 passes; activation to first rAF timed, deferred tab render given 80ms plus next rAF before checking usable DOM and advancing; Home measurements are returns after verified initial Home, not first open; not installed Edge timings"}));
        console.log("58-04 synthetic connected Open RO search/editor/durable save",
          JSON.stringify({records:2100,samples:connectedEditSamples.search.length,
            search:summarizeNavigationMs(connectedEditSamples.search),
            editor:summarizeNavigationMs(connectedEditSamples.editor),
            noteReveal:summarizeNavigationMs(connectedEditSamples.noteReveal),
            durableSave:summarizeNavigationMs(connectedEditSamples.durableSave),
            scope:"packaged file:// Chromium, connected memory-only File System Access-compatible Workspace; exact search to rendered result, production editor open to frame, visible Add note disclosure expansion, production save to verified durable read-back; sourceFields and manager manual annotation preserved; synthetic-only"}));
      }
      console.log("58-01 synthetic Chromium first verified Home",
        JSON.stringify({scenario,records:recordCount,syntheticReadDelayMs:readDelayMs,
          connectionToFirstFrame:summarizeNavigationMs(connectionSamples),
          launcherShellPlusVerifiedConnect:summarizeNavigationMs(launcherSamples),
          scope:"packaged file:// Chromium with in-memory File System Access-compatible folder; nine page starts; composite launcher-shell plus connected-Home-frame timings exclude synthetic fixture construction; browser process warm; no physical device, native picker, network or OneDrive latency"}));
    }
  }
  if(errors.some(s=>/syntaxerror|referenceerror/i.test(s)))throw Error("Javascript browser exception "+errors.join(";"));
  console.log("Arena TV visual and 7-slide rotation proof PASS",width,height);
  await page.close();
 }
}finally{
 try{if(packagedAppPath&&packagedAppOriginal!==null)fs.writeFileSync(packagedAppPath,packagedAppOriginal);}
 finally{await browser.close();}
}
