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
try{
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
    const visitedTimes=[];
    let initialTableRow=null;
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
      const row=await page.locator("#roTable tr[data-id]").first().evaluate(el=>{
        el.dataset.syntheticNavigationProof ||= "preserve";
        return el.dataset.id;
      });
      if(!row)throw Error("Synthetic Open RO rows were not rendered");
      const preserved=await page.locator("#roTable tr[data-synthetic-navigation-proof='preserve']").count();
      if(repeat>0&&preserved!==1)
        throw Error("Open RO DOM was unnecessarily rebuilt after unchanged tab navigation");
      initialTableRow ||= row;
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
  if(errors.some(s=>/syntaxerror|referenceerror/i.test(s)))throw Error("Javascript browser exception "+errors.join(";"));
  console.log("Arena TV visual and 7-slide rotation proof PASS",width,height);
  await page.close();
 }
}finally{await browser.close()}
