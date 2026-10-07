const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"..","assets","freshness.js"),"utf8");
const context=vm.createContext({Date,Intl});
vm.runInContext(source,context);
const R=context.ServiceRefreshIntelligence;
const plain=v=>JSON.parse(JSON.stringify(v));
const at="2026-10-06T15:00:00.000Z";

test("Known sources have local instructions without store identity",()=>{
  assert.equal(R.catalog.performance.label,"SAPR");
  assert.match(R.catalog.performance.location,/DealerCentral/);
  assert.equal(R.catalog.csi.facts.includes("Dealer NPS"),true);
  assert.deepEqual(R.plan([{source:"unknown",description:"missing"}],R.empty(),{at,today:"2026-10-06"}),[]);
});
test("One source provides one compact request even if repeated",()=>{
  const requests=[
    {source:"performance",period:"2026-10-05",description:"Pull SAPR to Oct 5",rank:5},
    {source:"performance",period:"2026-10-05",description:"Pull same SAPR",rank:5},
    {source:"csi",description:"Pull CSI responses",rank:8}
  ];
  const p=plain(R.plan(requests,R.empty(),{at,today:"2026-10-06"}));
  assert.equal(p.length,2);assert.equal(p[0].label,"SAPR");assert.equal(p[0].range,"2026-10-05");
  assert.deepEqual(p[0].facts,["gross","ELR","RO counts","advisor production","working days"]);
});
test("Not now snoozes a refresh without pretending it is complete",()=>{
  const history=R.learn(R.empty(),"performance","not-now",{at});
  assert.equal(plain(R.plan([{source:"performance"}],history,{at,today:"2026-10-06"})).length,0);
  assert.equal(plain(R.plan([{source:"performance"}],history,{at:"2026-10-06T17:01:00.000Z",today:"2026-10-06"})).length,1);
  assert.equal(history.sources.performance.observations.length,0);
});
test("A verified import resets snooze and learns at most one observation per date",()=>{
  let h=R.learn(R.empty(),"performance","not-now",{at});
  h=R.learn(h,"performance","imported",{at,periodEnd:"2026-10-05",hour:8});
  h=R.learn(h,"performance","imported",{at:"2026-10-06T16:00:00Z",periodEnd:"2026-10-05",hour:9});
  assert.equal(h.sources.performance.observations.length,1);
  assert.equal(h.sources.performance.observations[0].hour,9);
  assert.equal(h.sources.performance.notNowUntil,"");
});
test("Learning adapts slowly instead of taking one late upload as a schedule",()=>{
  let h=R.empty();
  h=R.learn(h,"performance","imported",{at:"2026-09-01T15:00:00Z",periodEnd:"2026-09-01",hour:8});
  assert.equal(R.typicalHour(R.sourceRecord(h,"performance")),null);
  for(let d=2;d<=5;d++)h=R.learn(h,"performance","imported",{
    at:`2026-09-0${d}T15:00:00Z`,periodEnd:`2026-09-0${d}`,hour:9
  });
  assert.equal(R.typicalHour(R.sourceRecord(h,"performance")),9);
});
test("Safety-critical Open RO requests ignore the learned gentle snooze",()=>{
  const h=R.learn(R.empty(),"open-ro","not-now",{at});
  const p=R.plan([{source:"open-ro",rank:1}],h,{at,today:"2026-10-06"});
  assert.equal(p.length,1);
});
test("SAPR halfway point uses half a day only for the in-progress source date",()=>{
  const s={saprDaysCompleted:9,saprTotalDays:22,periodEnd:"2026-10-06"};
  const p=R.workingProgress(s,{today:"2026-10-06",hour:14});
  assert.equal(p.daysWorked,8.5);assert.equal(p.inProgress,true);
  assert.equal(R.workingProgress(s,{today:"2026-10-06",hour:19}).daysWorked,9);
  assert.equal(R.workingProgress(s,{today:"2026-10-07",hour:14}).daysWorked,9);
});
test("YoY matches closest verified SAPR workday and rejects materially unmatched days",()=>{
  const current={periodEnd:"2026-10-06",saprDaysCompleted:9,saprTotalDays:22};
  const old=[{periodEnd:"2025-10-09",saprDaysCompleted:8,saprTotalDays:23},
             {periodEnd:"2025-10-10",saprDaysCompleted:9,saprTotalDays:23}];
  const result=R.matchPriorYear(current,old,{today:"2026-10-06",hour:13});
  assert.equal(result.status,"comparable");
  assert.equal(result.prior.periodEnd,"2025-10-10");
  assert.equal(result.workingDayGap,0.5);
  const missing=R.matchPriorYear(current,[{periodEnd:"2025-10-01",saprDaysCompleted:1,saprTotalDays:23}],{today:"2026-10-06",hour:13});
  assert.equal(missing.status,"needs-history");
  assert.equal(missing.periodStart,"2025-10-01");
  assert.equal(missing.estimatedEnd,"2025-10-10");
});
test("Home picks at most five non-duplicate actionable tasks and excludes reports",()=>{
  const tasks=[
    {id:"import:sapr",type:"import:performance",rank:1},
    {id:"ro:a",recordId:"a",type:"ro",rank:2,age:8},
    {id:"ro:a2",recordId:"a",type:"ro",rank:2,age:7},
    ...Array.from({length:8},(_,i)=>({id:`task:${i}`,type:"coaching",advisor:String(i),rank:i+3}))
  ];
  const got=R.topFive(tasks,[],{eligible:t=>t.id!=="task:1"});
  assert.equal(got.length,5);
  assert.equal(got.filter(t=>t.recordId==="a").length,1);
  assert.equal(got.some(t=>t.id==="import:sapr"),false);
  assert.equal(got.some(t=>t.id==="task:1"),false);
});
test("New presentation and refresh logic is included in runtime",()=>{
  const index=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
  const daily=fs.readFileSync(path.join(__dirname,"..","assets","daily-ops.js"),"utf8");
  const presenter=daily;
  assert.match(index,/assets\/refresh-intelligence.js/);
  assert.match(index,/assets\/meeting-presenter.js/);
  assert.match(index,/assets\/meeting-presenter.css/);
  assert.match(app,/recordRefreshLearning/);
  assert.match(app,/writeJson\(SETTINGS_PATH, nextSettings\)/);
  assert.match(daily,/renderOtherPriorities/);
  assert.match(daily,/renderRefreshStrip/);
  assert.match(presenter,/setInterval/);
  assert.match(presenter,/meeting-v3-advisor/);
});

test("Packaged modules stay byte-for-byte synchronized with canonical source",()=>{
  const rootDir=path.join(__dirname,"..");
  const freshness=fs.readFileSync(path.join(rootDir,"assets/freshness.js"),"utf8");
  const daily=fs.readFileSync(path.join(rootDir,"assets/daily-ops.js"),"utf8");
  const meeting=fs.readFileSync(path.join(rootDir,"assets/meeting.css"),"utf8");
  const src=name=>fs.readFileSync(path.join(rootDir,"src",name),"utf8").trimEnd();
  const between=(text,start,end)=>text.split(start)[1]?.split(end)[0]?.trim();
  assert.equal(between(freshness,"// BEGIN GENERATED REFRESH INTELLIGENCE (see src/refresh-intelligence.js)","// END GENERATED REFRESH INTELLIGENCE"),
    src("refresh-intelligence.js").replace('  if(typeof module!=="undefined")module.exports=api;',"").trim());
  assert.equal(between(daily,"// BEGIN GENERATED MEETING PRESENTER (see src/meeting-presenter.js)","// END GENERATED MEETING PRESENTER"),
    src("meeting-presenter.js").trim());
  assert.equal(between(meeting,"/* BEGIN GENERATED MEETING LAYOUT (see src/meeting-presenter.css) */","/* END GENERATED MEETING LAYOUT */"),
    src("meeting-presenter.css").trim());
});
