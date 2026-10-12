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
  const page=await browser.newPage({viewport:{width,height},reducedMotion:"reduce"});
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
    '<div class="meeting-scoreboard-period"><strong>DEMO WEEK</strong><span>LAST 7 DAYS</span><small>SYNTHETIC DATA</small></div><div class="meeting-scoreboard-actions"></div></header>'+
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
   return {slide,visible:getComputedStyle(area).display!=="none",inside:inside(top,area)&&inside(bottom,area),
     separated:!overlap(top,bottom)&&!overlap(stage,pace)&&!overlap(pulse,next),
     text:card.querySelector("h3").innerText};
  });
  const store=await geom();
  if(store.slide!=="store"||!store.visible||!store.inside||!store.separated)
    throw Error("Store TV geometry "+width+"x"+height+": "+JSON.stringify(store));
  await page.screenshot({path:path.join(out,"store-"+width+".png")});
  await page.evaluate(()=>globalThis.__serviceMeetingPresenter?.next());
  await page.waitForTimeout(130);
  const advisor=await geom();
  if(advisor.slide!=="advisor"||!advisor.visible||!advisor.inside||!advisor.separated)
    throw Error("Advisor TV geometry "+width+"x"+height+": "+JSON.stringify(advisor));
  await page.screenshot({path:path.join(out,"advisor-"+width+".png")});
  for(let i=0;i<6;i++)await page.evaluate(()=>globalThis.__serviceMeetingPresenter?.next());
  const cycle=await geom();
  if(cycle.slide!=="store")throw Error("Seven-slide rotation did not return to Store "+JSON.stringify(cycle));
  if(errors.some(s=>/syntaxerror|referenceerror/i.test(s)))throw Error("Javascript browser exception "+errors.join(";"));
  console.log("Arena TV visual and 7-slide rotation proof PASS",width,height);
  await page.close();
 }
}finally{await browser.close()}
