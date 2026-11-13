"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(relative) {
  const code = fs.readFileSync(path.resolve(__dirname, "..", relative), "utf8");
  const context = vm.createContext({Date, Intl});
  vm.runInContext(code, context);
  return context.ServiceRefreshIntelligence;
}

for (const relative of ["src/refresh-intelligence.js", "assets/freshness.js"]) {
  const R = load(relative);
  test(relative + ": late import preserves a newer user snooze without mutating the original", () => {
    const deferAt = "2026-11-08T14:00:00Z";
    const prior = R.learn(R.empty(), "performance", "not-now", {at:deferAt});
    const until = prior.sources.performance.notNowUntil;
    const original = JSON.stringify(prior);
    const after = R.learn(prior, "performance", "imported",
      {at:"2026-11-08T10:00:00Z", periodEnd:"2026-11-07", hour:8});
    assert.equal(JSON.stringify(prior), original, "prior state remains unmodified");
    assert.equal(after.sources.performance.notNowUntil, until);
    assert.equal(after.sources.performance.observations.length, 1,
      "a valid late arrival is still recorded with its verified report period");
    assert.equal(R.plan([{source:"performance",rank:1}], after,
      {at:"2026-11-08T14:10:00Z", today:"2026-11-08"}).length, 0);
    const newer = R.learn(after, "performance", "imported",
      {at:"2026-11-08T15:00:00Z", periodEnd:"2026-11-07", hour:15});
    assert.equal(newer.sources.performance.notNowUntil, "",
      "a genuinely newer verified arrival may clear the snooze");
  });
  test(relative + ": stale duplicate cannot replace a newer same-day source observation", () => {
    let history = R.learn(R.empty(), "performance", "imported",
      {at:"2026-11-08T15:00:00Z", periodEnd:"2026-11-07", hour:15});
    history = R.learn(history, "performance", "imported",
      {at:"2026-11-08T10:00:00Z", periodEnd:"2026-11-07", hour:8});
    assert.equal(history.sources.performance.observations.length, 1);
    assert.equal(history.sources.performance.observations[0].hour, 15);
    assert.equal(history.sources.performance.observations[0].at,
      "2026-11-08T15:00:00Z");
  });
  test(relative + ": out-of-order distinct report periods stay ordered by import event time", () => {
    let history = R.learn(R.empty(), "performance", "imported",
      {at:"2026-11-08T15:00:00Z", periodEnd:"2026-11-08", hour:15});
    history = R.learn(history, "performance", "imported",
      {at:"2026-11-08T09:00:00Z", periodEnd:"2026-11-07", hour:9});
    assert.deepEqual(Array.from(history.sources.performance.observations, x=>x.day),
      ["2026-11-07","2026-11-08"]);
  });
  test(relative + ": chronological imports still update the latest observation and clear snooze", () => {
    let history = R.learn(R.empty(), "performance", "not-now",
      {at:"2026-11-08T10:00:00Z"});
    history = R.learn(history, "performance", "imported",
      {at:"2026-11-08T11:00:00Z", periodEnd:"2026-11-07", hour:11});
    assert.equal(history.sources.performance.notNowUntil, "");
    history = R.learn(history, "performance", "imported",
      {at:"2026-11-08T12:00:00Z", periodEnd:"2026-11-07", hour:12});
    assert.equal(history.sources.performance.observations.length, 1);
    assert.equal(history.sources.performance.observations[0].hour, 12);
  });
  test(relative + ": delayed manager request retains latest request time", () => {
    const later="2026-11-12T15:00:00Z";
    const before=R.learn(R.empty(),"performance","requested",{at:later});
    const immutable=JSON.stringify(before);
    const after=R.learn(before,"performance","requested",{at:"2026-11-12T10:00:00Z"});
    assert.equal(after.sources.performance.lastRequested,later);
    assert.equal(JSON.stringify(before),immutable);
    const next=R.learn(after,"performance","requested",{at:"2026-11-12T16:00:00Z"});
    assert.equal(next.sources.performance.lastRequested,"2026-11-12T16:00:00Z");
  });
  test(relative + ": delayed deferral cannot evict newer bounded source history", () => {
    const priorDeferrals=Array.from({length:24},(_,hour)=>({
      at:"2026-11-10T"+String(hour).padStart(2,"0")+":00:00Z",hour
    }));
    const before={schemaVersion:1,sources:{performance:{
      observations:[],deferrals:priorDeferrals,notNowUntil:"2026-11-12T18:00:00Z"
    }}};
    const original=JSON.stringify(before);
    const after=R.learn(before,"performance","not-now",{at:"2026-11-09T00:00:00Z"});
    assert.equal(JSON.stringify(before),original,"prior history must not be mutated");
    assert.equal(after.sources.performance.deferrals.length,24);
    assert.deepEqual(Array.from(after.sources.performance.deferrals,x=>x.at),
      priorDeferrals.map(x=>x.at),"late extra event must not evict a newer event");
    assert.equal(after.sources.performance.notNowUntil,"2026-11-12T18:00:00.000Z");
  });
  test(relative + ": hydrated source history ignores invalid elements and preserves valid records", () => {
    const valid={at:"2026-11-08T14:00:00Z",day:"2026-11-08",hour:14};
    const deferred={at:"2026-11-08T10:00:00Z",hour:10};
    const before={schemaVersion:1,sources:{performance:{
      observations:[null,false,[],valid],deferrals:[null,42,[],deferred],notNowUntil:""
    }}};
    const original=JSON.stringify(before);
    const observed=R.sourceRecord(before,"performance");
    assert.equal(observed.observations.length,1);
    assert.equal(observed.observations[0].at,valid.at);
    assert.equal(observed.deferrals.length,1);
    assert.equal(observed.deferrals[0].at,deferred.at);
    const planned=R.plan([{source:"performance"}],before,{
      at:"2026-11-08T16:00:00Z",today:"2026-11-08"});
    assert.equal(planned.length,1,"malformed old history must not crash planner");
    const imported=R.learn(before,"performance","imported",{
      at:"2026-11-08T15:00:00Z",periodEnd:"2026-11-08",hour:15});
    assert.equal(imported.sources.performance.observations.length,1);
    assert.equal(imported.sources.performance.observations[0].hour,15);
    assert.equal(imported.sources.performance.deferrals.length,1);
    assert.equal(JSON.stringify(before),original,"stored history is never changed in-place");
  });
  test(relative + ": legacy unsorted history retains newest event before limiting to 24", () => {
    const newest={at:"2026-11-12T15:00:00Z",hour:15};
    const older=Array.from({length:24},(_,index)=>({
      at:"2026-11-12T10:"+String(index).padStart(2,"0")+":00Z",hour:10
    }));
    const before={schemaVersion:1,sources:{performance:{
      observations:[],deferrals:[newest,...older],notNowUntil:"2026-11-12T17:00:00Z"
    }}};
    const original=JSON.stringify(before);
    const recent=R.sourceRecord(before,"performance");
    assert.equal(recent.deferrals.length,24);
    assert.equal(recent.deferrals.at(-1).at,newest.at,
      "newest deferral must survive old unsorted 25-event history");
    const after=R.learn(before,"performance","imported",{
      at:"2026-11-12T13:00:00Z",periodEnd:"2026-11-11",hour:13
    });
    assert.equal(after.sources.performance.notNowUntil,"2026-11-12T17:00:00Z",
      "older import must not clear the dropped-latest user snooze");
    assert.equal(JSON.stringify(before),original);
    const newestObservation={at:"2026-11-12T15:00:00Z",day:"2026-11-12",hour:15};
    const oldObservations=Array.from({length:24},(_,index)=>{
      const day="2026-10-"+String(index+1).padStart(2,"0");
      return {at:day+"T12:00:00Z",day,hour:12};
    });
    const recovered=R.sourceRecord({schemaVersion:1,sources:{performance:{
      observations:[newestObservation,...oldObservations],deferrals:[]
    }}},"performance");
    assert.equal(recovered.observations.length,24);
    assert.equal(recovered.observations.at(-1).day,"2026-11-12",
      "verified newest observation must survive unsorted legacy hydration");
  });
  test(relative + ": planner skips empty restored request slots without crashing", () => {
    const requests=[null,{source:"performance",rank:2},undefined,
      {source:"unknown",rank:4},{source:"csi",rank:5}];
    const original=requests.slice();
    const result=R.plan(requests,R.empty(),{
      at:"2026-11-12T16:00:00Z",today:"2026-11-12"
    });
    assert.deepEqual(Array.from(result,entry=>entry.source),["performance","csi"]);
    assert.deepEqual(requests,original,"original request list must not be mutated");
  });
  test(relative + ": invalid imported history cannot fabricate a learned report hour", () => {
    const malformed=[
      {day:"2026-11-01",at:"not-a-time-1",hour:9},
      {day:"2026-11-02",at:"not-a-time-2",hour:9},
      {day:"2026-11-03",at:"not-a-time-3",hour:9},
      {day:"2026-11-04",at:"not-a-time-4",hour:9}
    ];
    const before={schemaVersion:1,sources:{performance:{
      observations:malformed,deferrals:[],notNowUntil:""
    }}};
    const original=JSON.stringify(before);
    const record=R.sourceRecord(before,"performance");
    assert.equal(R.typicalHour(record),null,
      "unverified imported event timestamps cannot establish a regular report hour");
    const plan=R.plan([{source:"performance",rank:7}],before,{
      at:"2026-11-12T15:00:00Z",today:"2026-11-12"
    });
    assert.equal(plan[0].learnedHour,null,
      "Home must not display a fabricated learned import schedule");
    const valid=Array.from({length:4},(_,index)=>({
      day:"2026-11-"+String(index+6).padStart(2,"0"),
      at:"2026-11-"+String(index+6).padStart(2,"0")+"T14:00:00Z",
      hour:14
    }));
    const mixed=R.sourceRecord({schemaVersion:1,sources:{performance:{
      observations:[...malformed,...valid],deferrals:[],notNowUntil:""
    }}},"performance");
    assert.equal(R.typicalHour(mixed),14,
      "only verified observations should contribute to learned arrival hour");
    assert.equal(JSON.stringify(before),original,"legacy history remains immutable");
  });
}
