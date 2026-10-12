#!/usr/bin/env node
// Synthetic-only browser proof. This test never opens an operational Workspace.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const launcher = process.argv[2], output = process.argv[3] || ".clean-install-smoke/overdrive-proof";
if (!launcher) throw new Error("usage: smoke_overdrive.mjs <launcher.html> [outputDir]");
fs.mkdirSync(output,{recursive:true});
const browser = await chromium.launch({headless:true});
try {
  for (const [width,height] of [[1920,1080],[1600,900],[1366,768]]) {
    const page = await browser.newPage({viewport:{width,height},reducedMotion:"reduce"});
    const errors=[];
    page.on("pageerror",err=>errors.push(err.message));
    await page.goto(pathToFileURL(path.resolve(launcher)).href,{waitUntil:"load",timeout:30000});
    await page.waitForURL(url=>url.protocol==="file:"&&url.pathname.endsWith("/index.html"),{timeout:15000});
    await page.waitForSelector("#view-meeting",{timeout:15000});

    await page.evaluate(()=>{
      const view=document.querySelector("#view-meeting");
      view.className="view active meeting-view meeting-v3 meeting-scoreboard";
      view.hidden=false;
      // Synthetic fixture only; neither identities nor local reports are accessed.
      const metric=(n)=>'<article class="tv-metric met"><span>PERFORMANCE '+n+
        '</span><strong>'+String(70+n)+'%</strong><small>Verified demonstration</small></article>';
      const card=(n)=>'<article class="meeting-v3-advisor tv-ready" data-advisor-code="demo-'+n+'"><h3>DEMO ADVISOR '+n+'</h3>'+
        '<section class="advisor-tv" aria-label="Synthetic advisor performance">'+
        '<div class="tv-top"><div class="tv-month"><span class="tv-kicker">01 / MONTH-TO-DATE GROSS</span>'+
        '<div class="tv-month-number"><strong>$23.1K</strong><span>demonstration benchmark</span></div>'+
        '<div class="tv-track"><i style="width:55%"></i></div>'+
        '<div class="tv-month-foot"><span>55% COMPLETE</span><strong>$18.8K REMAINING</strong></div>'+
        '<div class="tv-pace-signal">RUN RATE · $41.9K PROJECTED</div><small class="tv-source">SYNTHETIC REPORT COVERAGE</small></div>'+
        '<div class="tv-side"><div class="tv-need"><span class="tv-kicker">02 / REQUIRED DAILY PACE</span>'+
        '<strong>$1,200</strong><small>Several workdays remain</small></div>'+
        '<div class="tv-week"><span class="tv-kicker">03 / LAST 7 DAYS</span>'+
        '<strong class="pending">UNVERIFIED</strong><small>Coverage incomplete</small></div></div></div>'+
        '<section class="tv-scorecard"><div class="tv-signal-header"><strong>PERFORMANCE TELEMETRY</strong><span>8 MEASURES VERIFIED</span></div>'+
        '<div class="tv-metrics" data-metric-count="8">'+Array.from({length:8},(_,i)=>metric(i+1)).join("")+'</div></section>'+
        '<section class="tv-focus"><span class="tv-kicker">04 / YOUR NEXT MOVE</span>'+
        '<strong>TEST OPPORTUNITY</strong><b>One measurable step</b><small>BY NEXT MEETING</small></section></section></article>';
      view.innerHTML='<header class="meeting-scoreboard-head"><div><h2>Advisor Meeting</h2><span>SERVICE TEAM</span></div>'+
        '<div class="meeting-scoreboard-period"><strong>DEMONSTRATION</strong><span>LAST 7 DAYS</span><small>SYNTHETIC ONLY</small></div>'+
        '<div class="meeting-scoreboard-actions"></div></header>'+
        '<section class="meeting-team-story">'+
        '<article class="meeting-gross-story overdrive-partial"><div class="overdrive-store-mtd"><span>VERIFIED MONTH-TO-DATE</span><strong>$85.3K</strong><small>TEST SOURCE</small><em>5 / 6 OPERATING DAYS COVERED · WEEKLY TOTAL WITHHELD</em></div></article>'+
        '<article class="meeting-daily-story"><span>DAILY CLOSED GROSS</span><div class="meeting-daily-bars">'+
        Array.from({length:7},(_,i)=>'<div class="meeting-daily-bar"><b>$'+(i+1)*4+'.1K</b><i style="height:'+(15+i*10)+'%"></i><span>DAY '+(i+1)+'</span></div>').join("")+
        '</div></article>'+
        '<article class="meeting-health-story"><span>STORE HEALTH</span><div class="meeting-health-grid">'+
        Array.from({length:4},(_,i)=>'<article><span>MEASURE '+(i+1)+'</span><strong>'+(80+i)+'%</strong><small>Verified test</small></article>').join("")+
        '</div></article></section>'+
        '<section class="meeting-scoreboard-voice"></section>'+
        '<section class="meeting-action-band"><article><h3>MOMENTUM</h3><strong>Strong week</strong></article><article><h3>FOCUS</h3><strong>Improve follow-up</strong></article><article><h3>NEXT</h3><strong>One key move</strong></article></section>'+
        '<section class="meeting-scoreboard-advisors" id="meetingV3Advisors">'+
        Array.from({length:6},(_,i)=>card(i+1)).join("")+'</section>';
      document.querySelector("main")?.classList?.add("overdrive-proof");
      globalThis.__serviceMeetingPresenter?.activate();
    });
    await page.waitForTimeout(130);
    const store=await page.evaluate(()=>{
      const view=document.querySelector("#view-meeting");
      const visible=selector=>[...view.querySelectorAll(selector)].filter(el=>getComputedStyle(el).display!=="none");
      const board=visible(".meeting-team-story>article");
      const actions=visible(".meeting-action-band>*");
      const rect=el=>el.getBoundingClientRect();
      return {slide:view.dataset.presenterSlide,board:board.length,actions:actions.length,
        voice:getComputedStyle(view.querySelector(".meeting-scoreboard-voice")).display,
        horizontal:board.every((el,i)=>i===0||rect(board[i-1]).right<=rect(el).left+3),
        inside:board.every(el=>rect(el).bottom<=rect(view).bottom+3)};
    });
    if(store.slide!=="store"||store.board!==3||store.actions!==3||store.voice!=="none"||!store.horizontal||!store.inside)
      throw new Error("Store layout "+width+"x"+height+": "+JSON.stringify(store));
    await page.screenshot({path:path.join(output,"store-"+width+".png")});
    await page.evaluate(()=>globalThis.__serviceMeetingPresenter?.next());
    await page.waitForTimeout(130);
    const advisor=await page.evaluate(()=>{
      const view=document.querySelector("#view-meeting"),card=view.querySelector('.meeting-v3-advisor[data-slide-active="true"]');
      const rect=el=>el?.getBoundingClientRect();
      if(!card)return {failed:"no selected live advisor"};
      const blocks=[card.querySelector(".tv-top"),card.querySelector(".tv-scorecard"),card.querySelector(".tv-focus")];
      const outer=rect(card.querySelector(".advisor-tv"));
      return {slide:view.dataset.presenterSlide,metric:card.querySelectorAll(".tv-metric").length,
        stacked:blocks.every((el,i)=>i===0||rect(blocks[i-1]).bottom<=rect(el).top+4),
        inside:blocks.every(el=>rect(el).left>=outer.left-4&&rect(el).right<=outer.right+4&&rect(el).bottom<=outer.bottom+4),
        text:card.querySelector("h3")?.textContent};
    });
    if(advisor.slide!=="advisor"||advisor.metric!==8||!advisor.stacked||!advisor.inside)
      throw new Error("Advisor layout "+width+"x"+height+": "+JSON.stringify(advisor));
    await page.screenshot({path:path.join(output,"advisor-"+width+".png")});
    // Six advisors + Store must rotate through seven positions without losing order.
    const cycle=await page.evaluate(()=>{
      let count=0;
      for(let i=0;i<6;i++){globalThis.__serviceMeetingPresenter?.next();count++;}
      return {count,slide:document.querySelector("#view-meeting")?.dataset.presenterSlide,
        label:document.querySelector("[data-slide-label]")?.textContent};
    });
    if(cycle.slide!=="store"||cycle.count!==6)throw new Error("Rotation regression: "+JSON.stringify(cycle));
    if(errors.some(e=>/syntaxerror|referenceerror/i.test(e)))throw new Error("Runtime error: "+errors.join("; "));
    console.log("Overdrive synthetic browser proof passed",width,height,store,advisor.text);
    await page.close();
  }
}finally{await browser.close()}
