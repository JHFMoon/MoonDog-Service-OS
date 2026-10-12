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
  const visibleFullscreen=await page.locator(".meeting-scoreboard-actions button").evaluateAll(buttons=>
    buttons.filter(b=>b.getClientRects().length&&getComputedStyle(b).display!=="none"&&/full screen/i.test(b.textContent)).length);
  if(visibleFullscreen!==1)throw Error("Expected one fullscreen control, got "+visibleFullscreen);
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
  // Same real Full screen button, now timed under a synthetic background
  // workload to catch accidental whole-dashboard stylesheet invalidation.
  if(await page.evaluate(()=>document.fullscreenEnabled)){
    await page.evaluate(()=>{
      const main=document.querySelector("main");
      const hidden=document.createElement("section");hidden.id="syntheticNonMeetingView";
      hidden.className="view";
      hidden.innerHTML=Array.from({length:1600},(_,i)=>'<article class="card"><strong>DEMO ITEM '+i+'</strong><span>SYNTHETIC BACKGROUND CONTENT</span></article>').join("");
      main.append(hidden);
    });
    await page.locator(".meeting-presenter-controls [data-fullscreen]").click();
    await page.waitForFunction(()=>Boolean(document.fullscreenElement),null,{timeout:2000});
    await page.waitForFunction(()=>Number.isFinite(globalThis.__serviceMeetingPresenter?.fullscreenTiming()?.frameMs),null,{timeout:2800});
    const entry=await page.evaluate(()=>({
      timing:globalThis.__serviceMeetingPresenter.fullscreenTiming(),
      globallyRestyled:document.body.classList.contains("meeting-fullscreen"),
      fullscreenView:document.fullscreenElement?.tagName,
      arenaBounds:(()=>{const r=document.querySelector("#view-meeting").getBoundingClientRect();return {top:r.top,left:r.left,width:r.width,height:r.height};})(),
      viewport:{width:innerWidth,height:innerHeight}
    }));
    if(entry.fullscreenView!=="HTML"||entry.globallyRestyled||
       Math.abs(entry.arenaBounds.left)>2||Math.abs(entry.arenaBounds.top)>2||
       Math.abs(entry.arenaBounds.width-entry.viewport.width)>3||
       Math.abs(entry.arenaBounds.height-entry.viewport.height)>3||
       entry.timing.failed||entry.timing.kind!=="enter"||
       entry.timing.eventMs>2200||entry.timing.frameMs>3300)
      throw Error("Fullscreen entry latency or global restyle "+width+"x"+height+": "+JSON.stringify(entry));
    await page.locator(".meeting-presenter-controls [data-fullscreen]").click();
    await page.waitForFunction(()=>!document.fullscreenElement,null,{timeout:2000});
    await page.waitForFunction(()=>{
      const m=globalThis.__serviceMeetingPresenter?.fullscreenTiming();
      return m?.kind==="exit"&&Number.isFinite(m.restoredMs)&&
        !document.fullscreenElement;
    },null,{timeout:4300});
    const exit=await page.evaluate(()=>globalThis.__serviceMeetingPresenter.fullscreenTiming());
    if(exit.failed||exit.eventMs>2200||exit.frameMs>3300||exit.restoredMs>4300)
      throw Error("Fullscreen exit repaint latency "+width+"x"+height+": "+JSON.stringify(exit));
    // The failure reported in Edge is the tab becoming unresponsive *after* Exit.
    // Prove the next user interaction is handled before accepting exit success.
    const beforeNext=await page.locator(".meeting-presenter-controls [data-slide-label]").textContent();
    await page.locator(".meeting-presenter-controls [data-next]").click({timeout:3000});
    const afterNext=await page.locator(".meeting-presenter-controls [data-slide-label]").textContent();
    if(afterNext===beforeNext)throw Error("Presenter is unresponsive after leaving fullscreen");
    // Repeat fullscreen exit with animations enabled and synthetic offscreen
    // content still mounted. Regression must not emerge on the second exit.
    if(width===1600){
      for(let retry=0;retry<2;retry++){
        await page.locator(".meeting-presenter-controls [data-fullscreen]").click();
        await page.waitForFunction(()=>Boolean(document.fullscreenElement),null,{timeout:2200});
        await page.locator(".meeting-presenter-controls [data-fullscreen]").click();
        await page.waitForFunction(()=>{
          const m=globalThis.__serviceMeetingPresenter?.fullscreenTiming();
          return !document.fullscreenElement&&m?.kind==="exit"&&Number.isFinite(m.restoredMs);
        },null,{timeout:4300});
        const repeat=await page.evaluate(()=>globalThis.__serviceMeetingPresenter.fullscreenTiming());
        if(repeat.failed||repeat.restoredMs>4300)
          throw Error("Repeat fullscreen exit slow or staged content stuck: "+JSON.stringify(repeat));
      }
    }
    console.log("Fullscreen latency proof",width,height,
      "enter",entry.timing.eventMs+"ms event / "+entry.timing.frameMs+"ms frame",
      "exit",exit.eventMs+"ms event / "+exit.frameMs+"ms frame / "+exit.restoredMs+"ms restored");
    await page.evaluate(()=>document.getElementById("syntheticNonMeetingView")?.remove());
  }
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

  // Stress the browser case from the actual user screenshot: a maximized
  // ~1000px Edge window repeatedly returning from presentation fullscreen.
  // Measure event-loop stalls, not only fullscreenchange and the next frame.
  const repeatExitCycles=8;
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
  for(let repeat=0;repeat<repeatExitCycles;repeat++){
    await page.locator(".meeting-presenter-controls [data-fullscreen]").click({timeout:5000});
    await page.waitForFunction(()=>!!document.fullscreenElement,null,{timeout:2800});
    if(repeat===3){
      await page.setViewportSize({width:1600,height:900});
      await page.waitForTimeout(60);
      await page.setViewportSize({width:1000,height:950});
    }
    await page.locator(".meeting-presenter-controls [data-fullscreen]").click({timeout:5000});
    await page.waitForFunction(()=>{
      const t=globalThis.__serviceMeetingPresenter?.fullscreenTiming();
      return !document.fullscreenElement&&t?.kind==="exit"&&Number.isFinite(t.restoredMs);
    },null,{timeout:4000});
    const timing=await page.evaluate(()=>globalThis.__serviceMeetingPresenter.fullscreenTiming());
    if(timing.failed||timing.restoredMs>4000)
      throw Error("Repeated fullscreen exit hung on round "+repeat+": "+JSON.stringify(timing));
    if(await page.evaluate(()=>document.getElementById("view-meeting").classList.contains("arena-exiting-fullscreen")))
      throw Error("Staged exit class resurrected");
  }
  const heartbeat=await page.evaluate(()=>{
    const hb=globalThis.__arenaHeartbeat;
    clearInterval(hb.handle);
    return {maxDrift:Math.round(hb.maxDrift),samples:hb.samples};
  });
  // A main thread blocked for seconds is the user's actual failure mode.
  if(heartbeat.maxDrift>1900||heartbeat.samples<7)
    throw Error("Main thread stalled during repeated fullscreen exit "+JSON.stringify(heartbeat));
  console.log("Repeated exit and Edge-window heartbeat",width,height,JSON.stringify(heartbeat));
  await page.setViewportSize({width,height});
  if(width===1600){
    // Edge repro: after exiting native fullscreen, the WHOLE dashboard must still navigate.
    const navigationStarted=Date.now();
    await page.locator('.nav-item[data-view="home"]').click({timeout:3500});
    await page.waitForFunction(()=>document.getElementById("view-home").classList.contains("active"),null,{timeout:3500});
    await page.locator('.nav-item[data-view="meeting"]').click({timeout:3500});
    await page.waitForFunction(()=>document.getElementById("view-meeting").classList.contains("active"),null,{timeout:3500});
    if(Date.now()-navigationStarted>6500)throw Error("Dashboard navigation stalled after fullscreen exit");
    console.log("Post-exit dashboard navigation proof PASS",Date.now()-navigationStarted+"ms");
  }
  if(errors.some(s=>/syntaxerror|referenceerror/i.test(s)))throw Error("Javascript browser exception "+errors.join(";"));
  console.log("Arena TV visual and 7-slide rotation proof PASS",width,height);
  await page.close();
 }
}finally{await browser.close()}
