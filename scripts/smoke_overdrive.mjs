#!/usr/bin/env node
// Arena TV browser geometry proof, all synthetic, without operational Workspace access.
import {chromium} from "playwright";
import fs from "node:fs";import path from "node:path";import {pathToFileURL} from "node:url";
const launcher=process.argv[2],out=process.argv[3]||".clean-install-smoke/arena-proof";
if(!launcher)throw Error("usage: smoke_overdrive.mjs <launcher> [output]");
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
 for(const [width,height] of [[1920,1080],[1600,900],[1366,768]]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:width===1600?"no-preference":"reduce"});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve(launcher)).href,{waitUntil:"load",timeout:30000});
  await page.waitForURL(u=>u.protocol==="file:"&&u.pathname.endsWith("/index.html"),{timeout:15000});
  await page.waitForSelector("#view-meeting",{state:"attached",timeout:15000});
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
    await page.waitForTimeout(90);
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
    console.log("Repeated tab-navigation proof PASS",navigationTimes.length+" transitions",
      "max="+Math.max(...navigationTimes)+"ms","DOM reuse="+JSON.stringify(reuse));
  }
  if(errors.some(s=>/syntaxerror|referenceerror/i.test(s)))throw Error("Javascript browser exception "+errors.join(";"));
  console.log("Arena TV visual and 7-slide rotation proof PASS",width,height);
  await page.close();
 }
}finally{await browser.close()}
